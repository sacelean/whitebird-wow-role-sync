import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from 'discord.js';
import { getWowLinks, removeWowLink, saveWowLink } from './database.js';
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
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const pendingWowLinks = new Map();

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
  let linked = getWowLinks(guild.id);
  await guild.channels.fetch();
  for (const link of linked) {
    if (link.raider_channel_id) continue;
    const raiderTopic = `whitebird-raider:${guild.id}:${link.user_id}`;
    const raiderChannel = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && channel.topic === raiderTopic);
    if (!raiderChannel) continue;
    saveWowLink(guild.id, link.user_id, link.character_name, link.realm_slug, raiderChannel.id);
  }
  linked = getWowLinks(guild.id);
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
      let raiderChannelText = `canal Raider: <#${link.raider_channel_id}>`;
      if (!link.raider_channel_id) {
        const expectedName = `raider-${cleanChannelName(link.character_name)}-${cleanChannelName(link.realm_slug)}`.slice(0, 100);
        const channel = guild.channels.cache.find((candidate) => candidate.type === ChannelType.GuildText && candidate.name === expectedName);
        const topic = `whitebird-raider:${guild.id}:${link.user_id}`;
        raiderChannelText = `${channel ? `canal ${channel}` : `canal esperado #${expectedName}`} — tema para copiar: \`${topic}\``;
      }
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

function splitReport(lines, maxLength = 1800) {
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

function cleanChannelName(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'recluta';
}

function autoLinkScore(rosterCharacter, member) {
  const normalize = (value) => String(value || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const normalizeIgnoringAccents = (value) => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const aliases = [member.displayName, member.user.globalName, member.user.username].map(normalize).filter(Boolean);
  const character = normalize(rosterCharacter.name);
  const realm = normalize(rosterCharacter.realm);
  return Math.max(0, ...aliases.flatMap((alias) => [character, `${character}${realm}`].map((candidate) => {
    if (alias === candidate) return 1;
    if (normalizeIgnoringAccents(alias) === normalizeIgnoringAccents(candidate)) return 0;
    const left = [...alias];
    const right = [...candidate];
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let row = 1; row <= left.length; row += 1) {
      let diagonal = previous[0];
      previous[0] = row;
      for (let column = 1; column <= right.length; column += 1) {
        const old = previous[column];
        previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1));
        diagonal = old;
      }
    }
    return 1 - previous[right.length] / Math.max(left.length, right.length);
  })));
}

async function bulkAutoLink(interaction) {
  if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [roster, fetchedMembers] = await Promise.all([
    fetchGuildRoster(),
    interaction.guild.members.fetch()
  ]);
  const existingLinks = getWowLinks(guildId);
  const linkedUsers = new Set(existingLinks.map((link) => link.user_id));
  const linkedCharacters = new Set(existingLinks.map((link) => `${link.character_name.toLocaleLowerCase()}@${link.realm_slug.toLocaleLowerCase()}`));
  const characters = (roster.members || []).flatMap(({ character }) => {
    const name = character?.name;
    const realm = character?.realm?.slug;
    if (!name || !realm || linkedCharacters.has(`${name.toLocaleLowerCase()}@${realm.toLocaleLowerCase()}`)) return [];
    return [{ name, realm }];
  });
  const members = [...fetchedMembers.values()].filter((member) => !member.user.bot && !linkedUsers.has(member.id));
  const options = members.map((member) => ({
    member,
    candidates: characters.map((character) => ({ character, score: autoLinkScore(character, member) }))
      .sort((left, right) => right.score - left.score)
  }));
  const proposals = [];
  const review = [];
  const noMatchCount = options.filter(({ candidates: ranked }) => !ranked[0] || ranked[0].score < 0.90).length;
  for (const option of options) {
    const [best, second] = option.candidates;
    if (!best || best.score < 0.90) continue;
    if (second && best.score - second.score < 0.10) {
      review.push(`${option.member.displayName} — varias coincidencias (${best.character.name}, ${second.character.name})`);
      continue;
    }
    proposals.push({ ...option, character: best.character, score: best.score });
  }
  const byCharacter = new Map();
  for (const proposal of proposals) {
    const key = `${proposal.character.name.toLocaleLowerCase()}@${proposal.character.realm.toLocaleLowerCase()}`;
    byCharacter.set(key, [...(byCharacter.get(key) || []), proposal]);
  }
  const accepted = [];
  for (const matches of byCharacter.values()) {
    matches.sort((left, right) => right.score - left.score);
    if (matches.length > 1 && matches[0].score - matches[1].score < 0.10) {
      review.push(`${matches[0].character.name} — posible coincidencia con varios miembros`);
      continue;
    }
    accepted.push(matches[0]);
  }
  let saved = 0;
  const failed = [];
  for (const match of accepted) {
    try {
      saveWowLink(guildId, match.member.id, match.character.name, match.character.realm);
      saved += 1;
    } catch {
      failed.push(`${match.member.displayName} → ${match.character.name}`);
    }
  }
  const lines = [
    `Vinculación masiva terminada: **${saved}** vinculados automáticamente.`,
    `Sin coincidencia clara: **${noMatchCount}** · Para revisar: **${review.length}** · Errores: **${failed.length}**.`
  ];
  if (saved) lines.push('', '**Vinculados**', ...accepted.slice(0, 12).map((match) => `• <@${match.member.id}> → **${match.character.name}** · ${match.character.realm}`));
  if (review.length) lines.push('', '**Revisar manualmente**', ...review.slice(0, 8).map((line) => `• ${line}`));
  if (failed.length) lines.push('', '**No guardados**', ...failed.slice(0, 8).map((line) => `• ${line}`));
  if (saved > 12 || review.length > 8 || failed.length > 8) lines.push('', '_La respuesta muestra una selección de resultados; ejecuta `/wow-vinculaciones` para consultar el estado completo._');
  return interaction.editReply({ content: lines.join('\n').slice(0, 1950), allowedMentions: { parse: [] } });
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Whitebird WoW Role Sync conectado como ${readyClient.user.tag}`);
  const intervalMinutes = Number.parseInt(process.env.WOW_SYNC_INTERVAL_MINUTES || '0', 10);
  if (intervalMinutes > 0) {
    let syncing = false;
    setInterval(async () => {
      if (syncing) return;
      syncing = true;
      try {
        const guild = await readyClient.guilds.fetch(guildId);
        const report = await runSync(guild);
        console.log(`Sync WoW ${guildId}: ${report.synced} vinculaciones procesadas; ${report.skipped.length} omitidas.`);
      } catch (error) {
        console.error('Falló la sincronización automática WoW:', error.message);
      } finally {
        syncing = false;
      }
    }, intervalMinutes * 60_000);
  }
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
    if (interaction.commandName === 'wow-vincular-masivo') return await bulkAutoLink(interaction);

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

  } catch (error) {
    console.error('Error al procesar interacción:', error);
    const message = 'Ha ocurrido un error. Inténtalo de nuevo o avisa a un oficial.';
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.login(token);
