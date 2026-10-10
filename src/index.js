import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from 'discord.js';
import {
  getCauldronAssignments,
  getCauldronPanel,
  getWowLinks,
  removeWowLink,
  saveWowLink,
  seedCauldronAssignments,
  setCauldronAssignment,
  setCauldronPanel
} from './database.js';
import {
  fetchGuildRoster,
  getUnlinkedMappedRosterMembers,
  getWowConfig,
  findGuildRosterCharacter,
  rankGuildRosterCandidates,
  synchronizeWowRoles,
} from './wow-sync.js';

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !guildId) throw new Error('Configura DISCORD_TOKEN y DISCORD_GUILD_ID en .env.');

const officerRoleIds = new Set((process.env.OFFICER_ROLE_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const pendingWowLinks = new Map();
const weekdays = [
  ['monday', 'Lunes'], ['tuesday', 'Martes'], ['wednesday', 'Miércoles'], ['thursday', 'Jueves']
];
const cauldronTypes = { potis: 'caldero de pociones', frascos: 'caldero de frascos' };

function isOfficer(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = interaction.member?.roles?.cache;
  return roles ? [...officerRoleIds].some((id) => roles.has(id)) : false;
}

function unauthorizedReply() {
  return {
    content: 'Este comando está reservado a oficiales (permiso **Gestionar servidor** o un rol de `OFFICER_ROLE_IDS`).',
    flags: MessageFlags.Ephemeral
  };
}

function confirmationRow(nonce) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wow-link-confirm:${nonce}`).setLabel('Confirmar como mi main').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`wow-link-cancel:${nonce}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
  );
}

function matchOptions(candidates) {
  return new StringSelectMenuBuilder()
    .setCustomId(`wow-link-choose:${candidates.nonce}`)
    .setPlaceholder('Elige tu main del roster de Blizzard')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(candidates.items.map((candidate, index) => ({
      label: `${candidate.name} · ${candidate.realm}`.slice(0, 100),
      description: `Parecido con tu nombre: ${Math.round(candidate.score * 100)}%`.slice(0, 100),
      value: String(index)
    })));
}

async function autoLink(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const roster = await fetchGuildRoster();
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const ranked = rankGuildRosterCandidates(roster, [member.displayName, interaction.user.globalName, interaction.user.username]);
  const best = ranked[0];
  if (!best || best.score < 0.62) {
    return interaction.editReply('No encuentro una coincidencia clara con tu nombre. Pide a un oficial que use `/wow-vincular usuario personaje reino`.');
  }

  const nonce = randomUUID();
  const closeMatches = ranked.filter((candidate) => candidate.score >= Math.max(0.62, best.score - 0.12)).slice(0, 25);
  const pending = {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    candidates: closeMatches,
    character: null,
    expiresAt: Date.now() + 5 * 60_000
  };
  pendingWowLinks.set(nonce, pending);
  for (const [key, value] of pendingWowLinks) if (value.expiresAt <= Date.now()) pendingWowLinks.delete(key);

  if (closeMatches.length === 1 && best.score >= 0.70) {
    pending.character = best;
    return interaction.editReply({
      content: `La coincidencia más clara es **${best.name}** · **${best.realm}** (${Math.round(best.score * 100)}%). Confirma que es tu main para vincularlo.`,
      components: [confirmationRow(nonce)]
    });
  }

  return interaction.editReply({
    content: 'Hay varias coincidencias posibles. Elige tu main y confirma en el siguiente paso; no se guarda nada antes de confirmar.',
    components: [new ActionRowBuilder().addComponents(matchOptions({ nonce, items: closeMatches }))]
  });
}

async function handleLinkComponent(interaction) {
  const [action, nonce] = interaction.customId.replace('wow-link-', '').split(':');
  const pending = pendingWowLinks.get(nonce);
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingWowLinks.delete(nonce);
    return interaction.update({ content: 'Esta propuesta ha caducado. Ejecuta `/wow-vincular-auto` para buscar de nuevo.', components: [] });
  }
  if (interaction.user.id !== pending.userId || interaction.guildId !== pending.guildId) {
    return interaction.reply({ content: 'Solo la persona que inició la búsqueda puede confirmar esta vinculación.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.isStringSelectMenu()) {
    const candidate = pending.candidates[Number(interaction.values[0])];
    if (!candidate) return interaction.update({ content: 'No reconozco esa opción. Ejecuta `/wow-vincular-auto` otra vez.', components: [] });
    pending.character = candidate;
    return interaction.update({
      content: `¿Confirmas **${candidate.name}** · **${candidate.realm}** como tu main?`,
      components: [confirmationRow(nonce)]
    });
  }
  if (action === 'cancel') {
    pendingWowLinks.delete(nonce);
    return interaction.update({ content: 'Vinculación cancelada; no se ha guardado ningún cambio.', components: [] });
  }
  if (action === 'confirm' && pending.character) {
    try {
      saveWowLink(pending.guildId, pending.userId, pending.character.name, pending.character.realm);
      pendingWowLinks.delete(nonce);
      return interaction.update({ content: `Vinculado **${pending.character.name}** · **${pending.character.realm}** como tu main.`, components: [] });
    } catch {
      pendingWowLinks.delete(nonce);
      return interaction.update({ content: 'No se pudo guardar. Puede que ese personaje ya esté vinculado a otra persona; pide a un oficial que lo revise.', components: [] });
    }
  }
  return interaction.update({ content: 'La propuesta ya no está disponible. Ejecuta `/wow-vincular-auto` para empezar de nuevo.', components: [] });
}

async function runSync(guild) {
  const linked = getWowLinks(guild.id);
  if (!linked.length) return { synced: 0, skipped: [] };
  return synchronizeWowRoles(guild, linked);
}

async function buildLinkReport(guild) {
  const linked = getWowLinks(guild.id);
  const pending = [...pendingWowLinks.entries()]
    .filter(([, item]) => item.guildId === guild.id && item.expiresAt > Date.now());
  for (const [nonce, item] of pendingWowLinks) {
    if (item.expiresAt <= Date.now()) pendingWowLinks.delete(nonce);
  }

  const config = getWowConfig();
  const roster = await fetchGuildRoster();
  const unlinkedMapped = getUnlinkedMappedRosterMembers(roster, linked, config.rankRoles);

  await guild.roles.fetch();
  const rankRoleEntries = Object.entries(config.rankRoles)
    .map(([rank, roleId]) => ({ rank: Number(rank), roleId, default: false }));
  const highestConfiguredRank = Math.max(-1, ...rankRoleEntries.map(({ rank }) => rank));
  rankRoleEntries.push({ rank: highestConfiguredRank + 1, roleId: config.defaultRankRoleId, default: true });
  const linkedWithCurrentRanks = await Promise.all(linked.map(async (link) => {
    let member = guild.members.cache.get(link.user_id);
    if (!member) {
      try { member = await guild.members.fetch(link.user_id); } catch { member = null; }
    }
    const currentRanks = member
      ? rankRoleEntries.filter(({ roleId }) => member.roles.cache.has(roleId))
        .sort((left, right) => left.rank - right.rank)
      : [];
    return { link, currentRanks, sortRank: currentRanks.length ? currentRanks[0].rank : highestConfiguredRank + 2 };
  }));
  linkedWithCurrentRanks.sort((left, right) => left.sortRank - right.sortRank || left.link.character_name.localeCompare(right.link.character_name));

  const lines = [`**Vinculaciones guardadas (${linked.length})**`];
  lines.push(...(linked.length
    ? linkedWithCurrentRanks.map(({ link, currentRanks }) => {
      const currentRoleText = currentRanks.length
        ? currentRanks.map(({ rank, roleId, default: isDefault }) => {
          const role = guild.roles.cache.get(roleId);
          return isDefault ? `${role ? `<@&${roleId}>` : 'Viajante'} (por defecto)` : `${role ? `<@&${roleId}>` : `rol no disponible`} (rango ${rank})`;
        }).join(', ')
        : 'sin rol de rango configurado';
      const raiderChannelText = link.raider_channel_id ? `canal Raider: <#${link.raider_channel_id}>` : 'sin canal Raider asociado';
      return `• <@${link.user_id}> — **${link.character_name}** · ${link.realm_slug} — ${currentRoleText} — ${raiderChannelText}`;
    })
    : ['• No hay vinculaciones guardadas.']));
  lines.push('', `**Roster con rango mapeado y sin vincular (${unlinkedMapped.length})**`);
  lines.push(...(unlinkedMapped.length
    ? unlinkedMapped.map((character) => `• **${character.name}** · ${character.realm} — rango ${character.rank}`)
    : ['• Todos los personajes con rango mapeado están vinculados.']));
  lines.push('', `**Pendientes de confirmación (${pending.length})**`);
  lines.push(...(pending.length
    ? pending.map(([, item]) => item.character
      ? `• <@${item.userId}> — debe confirmar **${item.character.name}** · ${item.character.realm}`
      : `• <@${item.userId}> — debe elegir entre ${item.candidates.length} personajes`)
    : ['• No hay propuestas pendientes.']));
  lines.push('', '_Las propuestas pendientes duran 5 minutos y desaparecen si se reinicia el bot._');
  return lines;
}

function splitReport(lines, maxLength = 1950) {
  const pages = [];
  let page = '';
  for (const line of lines) {
    const next = page ? `${page}\n${line}` : line;
    if (next.length > maxLength && page) {
      pages.push(page);
      page = line;
    } else {
      page = next;
    }
  }
  if (page) pages.push(page);
  return pages;
}

function renderCauldronSchedule(guildId) {
  const assignments = getCauldronAssignments(guildId);
  const byDay = new Map(assignments.map((item) => [`${item.weekday}:${item.cauldron_type}`, item.character_name]));
  const lines = ['📦 **REPARTO DE CALDEROS** 📦', '**@Alquimista**'];
  for (const [key, label] of weekdays) {
    lines.push('', `🗓️ **${label}**`);
    lines.push(`🧪 Potis: ${byDay.get(`${key}:potis`) || 'Sin asignar'}`);
    lines.push(`🧴 Frascos: ${byDay.get(`${key}:frascos`) || 'Sin asignar'}`);
  }
  lines.push('', '⚠️ Recordad tener los calderos preparados antes de la raid para evitar prisas de última hora. ¡Gracias por colaborar! 💜');
  return lines.join('\n');
}

async function updateCauldronPanel(guild) {
  const panel = getCauldronPanel(guild.id);
  if (!panel) return false;
  const channel = await guild.channels.fetch(panel.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return false;
  const content = renderCauldronSchedule(guild.id);
  let message = await channel.messages.fetch(panel.message_id).catch(() => null);
  if (message) {
    await message.edit({ content, allowedMentions: { parse: [] } });
    return true;
  }
  message = await channel.send({ content, allowedMentions: { parse: [] } });
  setCauldronPanel(guild.id, channel.id, message.id);
  return true;
}

function comparableCharacterName(name) {
  return String(name || '').normalize('NFC').toLocaleLowerCase('es-ES').replace(/\s+/g, '');
}

function findCauldronAssignee(guildId, characterName) {
  const key = comparableCharacterName(characterName);
  const matches = getWowLinks(guildId).filter((link) => comparableCharacterName(link.character_name) === key);
  return matches.length === 1 && matches[0].raider_channel_id ? matches[0] : null;
}

async function sendDailyCauldronReminders(guild, timeZone) {
  const today = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(new Date()).toLowerCase();
  const assignments = getCauldronAssignments(guild.id).filter((item) => item.weekday === today);
  const byUser = new Map();
  for (const assignment of assignments) {
    const link = findCauldronAssignee(guild.id, assignment.character_name);
    if (!link) {
      console.warn(`Aviso de caldero omitido: ${assignment.character_name} no tiene un vínculo único con canal Raider.`);
      continue;
    }
    const current = byUser.get(link.user_id) || { link, types: [] };
    current.types.push(cauldronTypes[assignment.cauldron_type] || `caldero de ${assignment.cauldron_type}`);
    byUser.set(link.user_id, current);
  }
  for (const { link, types } of byUser.values()) {
    const channel = await guild.channels.fetch(link.raider_channel_id).catch(() => null);
    if (!channel?.isTextBased()) {
      console.warn(`Aviso de caldero omitido para ${link.character_name}: no se encontró su canal Raider.`);
      continue;
    }
    const duty = types.join(' y ');
    await channel.send({
      content: `<@${link.user_id}> Hoy te toca llevar el ${duty}. Recuerda tenerlo preparado antes de la raid.`,
      allowedMentions: { users: [link.user_id] }
    });
  }
}

function nextDailyRun(hour, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const now = Date.now();
  const candidate = Math.floor(now / 60_000) * 60_000 + 60_000;
  for (let minute = 0; minute < 48 * 60; minute += 1) {
    const timestamp = candidate + minute * 60_000;
    const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(({ type, value }) => [type, value]));
    if (Number(parts.hour) === hour && Number(parts.minute) === 0) return timestamp;
  }
  throw new Error(`No se encontró la próxima ejecución para la zona horaria ${timeZone}.`);
}

function scheduleDailySync(readyClient, hour, timeZone) {
  const nextRun = nextDailyRun(hour, timeZone);
  console.log(`Próxima sincronización WoW: ${new Date(nextRun).toLocaleString('es-ES', { timeZone })} (${timeZone}).`);
  setTimeout(async () => {
    try {
      const guild = await readyClient.guilds.fetch(guildId);
      try {
        const report = await runSync(guild);
        console.log(`Sync WoW ${guildId}: ${report.synced} vinculaciones procesadas; ${report.skipped.length} omitidas.`);
      } catch (error) {
        console.error('Falló la sincronización automática WoW:', error.message);
      }
      try {
        await sendDailyCauldronReminders(guild, timeZone);
      } catch (error) {
        console.error('Falló el envío de avisos de calderos:', error.message);
      }
    } catch (error) {
      console.error('Falló la sincronización automática WoW:', error.message);
    } finally {
      scheduleDailySync(readyClient, hour, timeZone);
    }
  }, Math.max(0, nextRun - Date.now()));
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Whitebird WoW Role Sync conectado como ${readyClient.user.tag}`);
  seedCauldronAssignments(guildId, [
    { weekday: 'monday', type: 'potis', characterName: 'Asherrna' },
    { weekday: 'monday', type: 'frascos', characterName: 'Yaihy' },
    { weekday: 'tuesday', type: 'potis', characterName: 'Daphne' },
    { weekday: 'tuesday', type: 'frascos', characterName: 'TheAngel' },
    { weekday: 'wednesday', type: 'potis', characterName: 'Zness' },
    { weekday: 'wednesday', type: 'frascos', characterName: 'Sacelean' },
    { weekday: 'thursday', type: 'potis', characterName: 'Darkmur' },
    { weekday: 'thursday', type: 'frascos', characterName: 'TheAngel' }
  ]);
  const hour = Number.parseInt(process.env.WOW_SYNC_HOUR || '4', 10);
  const timeZone = process.env.WOW_SYNC_TIMEZONE || 'Europe/Madrid';
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('WOW_SYNC_HOUR debe ser un número entre 0 y 23.');
  scheduleDailySync(readyClient, hour, timeZone);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    const isLinkComponent = (interaction.isStringSelectMenu() && interaction.customId.startsWith('wow-link-choose:')) ||
      (interaction.isButton() && interaction.customId.startsWith('wow-link-'));
    if (isLinkComponent) return await handleLinkComponent(interaction);
    if (!interaction.isChatInputCommand()) return;
    if (interaction.guildId !== guildId) {
      return interaction.reply({ content: 'Este bot solo está configurado para su servidor de Whitebird.', flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === 'wow-vincular-auto') return await autoLink(interaction);
    if (interaction.commandName === 'wow-vincular') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const target = interaction.options.getUser('usuario', true);
      const name = interaction.options.getString('personaje', true).trim();
      const realm = interaction.options.getString('reino', true).trim();
      const roster = await fetchGuildRoster();
      const match = findGuildRosterCharacter(roster, name, realm);
      if (!match) return interaction.editReply(`No encuentro **${name}** · **${realm}** en el roster de la guild de Blizzard.`);
      saveWowLink(guildId, target.id, match.name, match.realm);
      return interaction.editReply(`Vinculado **${match.name}** · **${match.realm}** con <@${target.id}>.`);
    }

    if (interaction.commandName === 'wow-desvincular') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      const target = interaction.options.getUser('usuario', true);
      const removed = removeWowLink(guildId, target.id);
      return interaction.reply({
        content: removed ? `Se quitó la vinculación de WoW de <@${target.id}>.` : `<@${target.id}> no tenía un personaje vinculado.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
    }

    if (interaction.commandName === 'syncwow') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      if (!interaction.appPermissions?.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ content: 'El bot necesita el permiso **Gestionar roles**. No se ha modificado ningún rol.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const report = await runSync(interaction.guild);
      const lines = [
        `Sincronización terminada: **${report.synced}** vinculaciones procesadas.`,
        `Rangos comprobados: **${report.ranksChecked || 0}** · Rol por defecto aplicado: **${report.defaultRankApplied || 0}** · Profesiones comprobadas: **${report.professionsChecked || 0}**.`,
        `Fuera del roster de Blizzard: **${report.outsideRoster || 0}** · Devueltos a Viajante: **${report.outsideRosterDefaultApplied || 0}**.`
      ];
      if (report.rankDetails?.length) lines.push(`Detalle de rangos: ${report.rankDetails.slice(0, 8).join('; ')}`);
      lines.push(`Canales Raider renombrados: **${report.channelsRenamed || 0}**.`);
      if (report.channelDetails?.length) lines.push(`Detalle de canales: ${report.channelDetails.slice(0, 8).join('; ')}`);
      if (report.channelFailures?.length) lines.push(`Canales sin actualizar (${report.channelFailures.length}): ${report.channelFailures.slice(0, 5).join('; ')}`);
      if (report.skipped.length) lines.push(`Omitidas (${report.skipped.length}): ${report.skipped.slice(0, 8).join('; ')}`);
      if (report.failed?.length) lines.push(`Errores (${report.failed.length}): ${report.failed.slice(0, 8).join('; ')}`);
      return interaction.editReply(lines.join('\n').slice(0, 1950));
    }

    if (interaction.commandName === 'wow-vinculaciones') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const pages = splitReport(await buildLinkReport(interaction.guild));
      await interaction.editReply({ content: pages[0], allowedMentions: { parse: [] } });
      for (const page of pages.slice(1)) {
        await interaction.followUp({ content: page, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      }
      return;
    }

    if (interaction.commandName === 'wow-caldero-asignar') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      const weekday = interaction.options.getString('dia', true);
      const type = interaction.options.getString('tipo', true);
      const user = interaction.options.getUser('usuario', true);
      const link = getWowLinks(guildId).find((item) => item.user_id === user.id && item.raider_channel_id);
      if (!link) {
        return interaction.reply({
          content: `No encuentro una vinculación con canal Raider para ${user}. Comprueba que tenga su main vinculado y su canal asociado.`,
          flags: MessageFlags.Ephemeral
        });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      setCauldronAssignment(guildId, weekday, type, link.character_name);
      let panelUpdated = false;
      try { panelUpdated = await updateCauldronPanel(interaction.guild); } catch (error) {
        console.error('No se pudo actualizar el reparto público de calderos:', error.message);
      }
      const dayName = weekdays.find(([key]) => key === weekday)?.[1] || weekday;
      const typeName = type === 'potis' ? 'potis' : 'frascos';
      return interaction.editReply({
        content: `Asignación guardada: **${dayName}**, caldero de **${typeName}** → **${link.character_name}**.${panelUpdated ? ' El mensaje del canal ya está actualizado.' : ' No hay panel configurado; un oficial debe ejecutar `/wow-calderos-panel` en el canal de crafteos.'}`,
      });
    }

    if (interaction.commandName === 'wow-calderos-panel') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const channel = interaction.options.getChannel('canal', true);
      const existingPanel = getCauldronPanel(guildId);
      if (existingPanel?.channel_id === channel.id) {
        const updated = await updateCauldronPanel(interaction.guild);
        if (updated) return interaction.editReply(`El mensaje de reparto ya estaba en ${channel} y se ha actualizado.`);
      }
      const message = await channel.send({ content: renderCauldronSchedule(guildId), allowedMentions: { parse: [] } });
      setCauldronPanel(guildId, channel.id, message.id);
      return interaction.editReply(`He publicado el mensaje de reparto en ${channel}. Los cambios hechos con `/wow-caldero-asignar` actualizarán ese mensaje. Como el mensaje anterior lo escribió una persona, Discord no permite que el bot lo edite; podéis borrarlo manualmente.`);
    }

  } catch (error) {
    console.error('Error al procesar interacción:', error);
    const message = 'Ha ocurrido un error. Inténtalo de nuevo o avisa a un oficial.';
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.login(token);
