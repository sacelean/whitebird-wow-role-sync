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
  getWowSyncHistory,
  removeWowLink,
  recordWowSyncChanges,
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
  previewWowRoleSync,
  synchronizeWowRoles,
} from './wow-sync.js';
import {
  renderCauldronSchedule as renderSchedule,
  updateCauldronPanel as updatePanel
} from './cauldron-panel.js';
import {
  buildDailyCauldronReminders,
  getGuildWeekday,
  nextDailyRun
} from './daily-cauldron.js';

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !guildId) throw new Error('Configura DISCORD_TOKEN y DISCORD_GUILD_ID en .env.');

const officerRoleIds = new Set((process.env.OFFICER_ROLE_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));
const officerReportChannelId = (process.env.OFFICER_REPORT_CHANNEL_ID || '').trim();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const pendingWowLinks = new Map();
const pendingSyncPreviews = new Map();
const weekdays = [
  ['monday', 'Lunes'], ['tuesday', 'Martes'], ['wednesday', 'Miércoles'], ['thursday', 'Jueves']
];

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

function syncConfirmationRow(nonce) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wow-sync-confirm:${nonce}`).setLabel('Confirmar sincronización').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`wow-sync-cancel:${nonce}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
  );
}

async function handleSyncPreviewComponent(interaction) {
  const [, action, nonce] = interaction.customId.match(/^wow-sync-(confirm|cancel):(.+)$/) || [];
  const pending = pendingSyncPreviews.get(nonce);
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingSyncPreviews.delete(nonce);
    return interaction.update({ content: 'La vista previa ha caducado. Ejecuta `/wow-sincronizar-revisar` para generar otra.', components: [] });
  }
  if (interaction.guildId !== pending.guildId || interaction.user.id !== pending.userId) {
    return interaction.reply({ content: 'Solo el oficial que solicitó la vista previa puede confirmar esta sincronización.', flags: MessageFlags.Ephemeral });
  }
  if (!isOfficer(interaction)) {
    pendingSyncPreviews.delete(nonce);
    return interaction.update({ content: 'Ya no tienes permisos de oficial; no se ha cambiado ningún rol.', components: [] });
  }
  pendingSyncPreviews.delete(nonce);
  if (action === 'cancel') return interaction.update({ content: 'Sincronización cancelada; no se ha cambiado ningún rol.', components: [] });
  if (!interaction.appPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.update({ content: 'El bot necesita el permiso **Gestionar roles**. No se ha modificado ningún rol.', components: [] });
  }
  await interaction.update({ content: 'Confirmado. Estoy volviendo a consultar Blizzard y aplicando la sincronización…', components: [] });
  const report = await runSync(interaction.guild);
  return interaction.editReply({ content: formatSyncReport(report) });
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

async function runSync(guild, selectedLinks = null) {
  const linked = selectedLinks || getWowLinks(guild.id);
  if (!linked.length) return { synced: 0, skipped: [] };
  return synchronizeWowRoles(guild, linked, {
    saveLink: saveWowLink,
    onRoleChange: (change) => recordWowSyncChanges([change])
  });
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

function formatSyncReport(report, title = 'Sincronización terminada') {
  const lines = [
    `**${title}:** ${report.synced || 0} vinculaciones procesadas.`,
    `Cambios de rol: **${report.roleChanges?.length || 0}** · Rangos comprobados: **${report.ranksChecked || 0}** · Profesiones comprobadas: **${report.professionsChecked || 0}**.`,
    `Fuera del roster: **${report.outsideRoster || 0}** · Viajante aplicado: **${report.outsideRosterDefaultApplied || 0}** · Canales renombrados: **${report.channelsRenamed || 0}**.`
  ];
  const details = [
    ...(report.roleChanges || []).slice(0, 6).map((change) => `• ${change.characterName}: ${change.action === 'added' ? 'añadido' : 'retirado'} ${change.roleName} (${change.category})`),
    ...(report.channelChanges || []).slice(0, 3).map((change) => `• Canal: ${change}`),
    ...(report.skipped || []).slice(0, 4).map((item) => `• Omitido: ${item}`),
    ...(report.failed || []).slice(0, 4).map((item) => `• Error: ${item}`),
    ...(report.channelFailures || []).slice(0, 3).map((item) => `• Canal: ${item}`)
  ];
  if (details.length) lines.push('', ...details);
  return lines.join('\n').slice(0, 1950);
}

function formatPreview(items) {
  if (!items.length) return 'No hay vinculaciones guardadas para revisar.';
  const lines = [`**Vista previa: ${items.length} vinculaciones**`, '_No se ha cambiado ningún rol ni canal. La confirmación volverá a consultar Blizzard antes de aplicar._'];
  for (const item of items.slice(0, 18)) {
    const changes = [...(item.roleChanges || []), ...(item.channelChange ? [`renombrar canal ${item.channelChange}`] : [])];
    lines.push(`• **${item.character}** — ${item.status}${changes.length ? `; ${changes.join(', ')}` : '; sin cambios previstos'}`);
  }
  if (items.length > 18) lines.push(`… y ${items.length - 18} vinculaciones más. Consulta `/wow-auditoria` para revisar el estado.`);
  return lines.join('\n').slice(0, 1900);
}

async function buildAuditReport(guild) {
  const config = getWowConfig();
  const links = getWowLinks(guild.id);
  const roster = await fetchGuildRoster();
  await guild.roles.fetch();
  const botMember = await guild.members.fetchMe();
  const issues = [];
  if (!botMember.permissions?.has(PermissionFlagsBits.ManageRoles)) issues.push('El bot no tiene el permiso Gestionar roles.');
  if (!botMember.permissions?.has(PermissionFlagsBits.ManageChannels)) issues.push('El bot no tiene el permiso Gestionar canales para renombrar canales Raider.');
  const managedRoles = [
    ...Object.entries(config.rankRoles).map(([rank, id]) => ({ id, label: `rango ${rank}` })),
    ...Object.entries(config.professionRoles).map(([name, id]) => ({ id, label: `profesión ${name}` })),
    { id: config.defaultRankRoleId, label: 'rango por defecto Viajante' }
  ];
  for (const { id, label } of managedRoles) {
    const role = guild.roles.cache.get(id);
    if (!role) issues.push(`Rol configurado inexistente (${label}, ID ${id}).`);
    else if (role.managed || role.position >= botMember.roles.highest.position) issues.push(`El bot no puede gestionar el rol ${role.name} (${label}); revisa la jerarquía.`);
  }
  for (const link of links) {
    const char = `${link.character_name} · ${link.realm_slug}`;
    if (!findGuildRosterCharacter(roster, link.character_name, link.realm_slug)) issues.push(`${char}: fuera del roster de Blizzard.`);
    try { await guild.members.fetch(link.user_id); } catch { issues.push(`${char}: usuario vinculado ausente del servidor de Discord.`); }
    if (!link.raider_channel_id) issues.push(`${char}: no tiene canal Raider vinculado.`);
    else {
      const channel = await guild.channels.fetch(link.raider_channel_id).catch(() => null);
      if (!channel?.isTextBased()) issues.push(`${char}: canal Raider inexistente o inaccesible.`);
      else if (channel.permissionsFor && !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages)) {
        issues.push(`${char}: el bot no puede ver y enviar mensajes en su canal Raider.`);
      }
    }
  }
  const unlinked = getUnlinkedMappedRosterMembers(roster, links, config.rankRoles);
  for (const character of unlinked) issues.push(`${character.name} · ${character.realm}: rango ${character.rank} mapeado sin vincular a Discord.`);
  const unmappedRanks = new Map();
  for (const { character, rank } of roster.members || []) {
    if (config.rankRoles[String(rank)] || !character?.name || !character?.realm?.slug) continue;
    const key = String(rank);
    const list = unmappedRanks.get(key) || [];
    list.push(`${character.name} · ${character.realm.slug}`);
    unmappedRanks.set(key, list);
  }
  for (const [rank, characters] of unmappedRanks) {
    issues.push(`Rango ${rank} sin mapeo: ${characters.length} personajes recibirían Viajante (${characters.slice(0, 5).join(', ')}${characters.length > 5 ? ', …' : ''}).`);
  }
  for (const assignment of getCauldronAssignments(guild.id)) {
    const matching = links.filter((link) => link.character_name.normalize('NFC').toLocaleLowerCase('es-ES') === assignment.character_name.normalize('NFC').toLocaleLowerCase('es-ES'));
    if (matching.length !== 1 || !matching[0].raider_channel_id) {
      issues.push(`Caldero ${assignment.cauldron_type} del día ${assignment.weekday}: ${assignment.character_name} no tiene un vínculo único con canal Raider.`);
    }
  }
  const panel = getCauldronPanel(guild.id);
  if (!panel) issues.push('No hay mensaje del reparto de calderos configurado.');
  else {
    const channel = await guild.channels.fetch(panel.channel_id).catch(() => null);
    const message = channel?.messages ? await channel.messages.fetch(panel.message_id).catch(() => null) : null;
    if (!message) issues.push('El mensaje guardado del reparto de calderos no existe; ejecuta `/wow-calderos-panel` para repararlo.');
    if (channel?.permissionsFor && !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages)) {
      issues.push('El bot no puede ver y enviar mensajes en el canal del reparto de calderos.');
    }
  }
  if (officerReportChannelId) {
    const channel = await guild.channels.fetch(officerReportChannelId).catch(() => null);
    if (!channel?.isTextBased()) issues.push('OFFICER_REPORT_CHANNEL_ID no existe o no es accesible.');
    else if (channel.permissionsFor && !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages)) {
      issues.push('El bot no puede enviar el informe diario en OFFICER_REPORT_CHANNEL_ID.');
    }
  } else issues.push('OFFICER_REPORT_CHANNEL_ID no está configurado; el informe diario no se publicará en Discord.');
  if (!issues.length) return ['**Auditoría WoW:** no se detectaron problemas.', `${links.length} vinculaciones revisadas; roles, canales y asignaciones comprobados.`];
  return [`**Auditoría WoW:** ${issues.length} observaciones`, ...issues.slice(0, 40).map((issue) => `• ${issue}`), ...(issues.length > 40 ? [`… y ${issues.length - 40} observaciones más.`] : [])];
}

function getAlchemyRoleId() {
  const alchemyRoleId = getWowConfig().professionRoles.Alchemy;
  if (!alchemyRoleId) throw new Error('Configura el rol de Alquimista como "Alchemy" en WOW_PROFESSION_ROLE_IDS para mencionarlo en el reparto.');
  return alchemyRoleId;
}

function renderCauldronSchedule(guildId) {
  return renderSchedule(getCauldronAssignments(guildId), getAlchemyRoleId());
}

async function updateCauldronPanel(guild) {
  return updatePanel(guild, {
    getPanel: getCauldronPanel,
    getAssignments: getCauldronAssignments,
    setPanel: setCauldronPanel,
    alchemyRoleId: getAlchemyRoleId()
  });
}

async function sendDailyCauldronReminders(guild, timeZone) {
  const today = getGuildWeekday(timeZone);
  const { reminders, unmatched } = buildDailyCauldronReminders(getCauldronAssignments(guild.id), getWowLinks(guild.id), today);
  let sent = 0;
  let skipped = unmatched.length;
  for (const characterName of unmatched) {
    console.warn(`Aviso de caldero omitido: ${characterName} no tiene un vínculo único con canal Raider.`);
  }
  for (const { link, types } of reminders) {
    const channel = await guild.channels.fetch(link.raider_channel_id).catch(() => null);
    if (!channel?.isTextBased()) {
      console.warn(`Aviso de caldero omitido para ${link.character_name}: no se encontró su canal Raider.`);
      skipped += 1;
      continue;
    }
    const duty = types.join(' y ');
    try {
      await channel.send({
        content: `<@${link.user_id}> Hoy te toca llevar el ${duty}. Recuerda tenerlo preparado antes de la raid.`,
        allowedMentions: { users: [link.user_id] }
      });
      sent += 1;
    } catch (error) {
      console.warn(`Aviso de caldero no enviado a ${link.character_name}: ${error.message}`);
      skipped += 1;
    }
  }
  return { weekday: today, sent, skipped };
}

async function sendOfficerDailyReport(guild, { syncReport, syncError, cauldronReport, cauldronError }) {
  if (!officerReportChannelId) return;
  const channel = await guild.channels.fetch(officerReportChannelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('OFFICER_REPORT_CHANNEL_ID no existe o no es accesible.');
  const lines = [`**Informe automático WoW · ${new Date().toLocaleString('es-ES', { timeZone: process.env.WOW_SYNC_TIMEZONE || 'Europe/Madrid' })}**`];
  if (syncReport) lines.push('', formatSyncReport(syncReport, 'Sincronización diaria'));
  else lines.push('', `**Falló la sincronización:** ${syncError || 'error desconocido'}`);
  if (cauldronReport) lines.push('', `**Avisos de calderos (${cauldronReport.weekday}):** ${cauldronReport.sent} enviados · ${cauldronReport.skipped} omitidos.`);
  else if (cauldronError) lines.push('', `**Fallaron los avisos de calderos:** ${cauldronError}`);
  await channel.send({ content: lines.join('\n').slice(0, 1950), allowedMentions: { parse: [] } });
}

function scheduleDailySync(readyClient, hour, timeZone) {
  const nextRun = nextDailyRun(hour, timeZone);
  console.log(`Próxima sincronización WoW: ${new Date(nextRun).toLocaleString('es-ES', { timeZone })} (${timeZone}).`);
  setTimeout(async () => {
    let syncReport = null;
    let syncError = null;
    let cauldronReport = null;
    let cauldronError = null;
    try {
      const guild = await readyClient.guilds.fetch(guildId);
      try {
        syncReport = await runSync(guild);
        console.log(`Sync WoW ${guildId}: ${syncReport.synced} vinculaciones procesadas; ${syncReport.skipped.length} omitidas.`);
      } catch (error) { syncError = error.message; console.error('Falló la sincronización automática WoW:', error.message); }
      try { cauldronReport = await sendDailyCauldronReminders(guild, timeZone); }
      catch (error) { cauldronError = error.message; console.error('Falló el envío de avisos de calderos:', error.message); }
      try { await sendOfficerDailyReport(guild, { syncReport, syncError, cauldronReport, cauldronError }); }
      catch (error) { console.error('No se pudo enviar el informe diario a oficiales:', error.message); }
    } catch (error) {
      console.error('Falló la sincronización automática WoW:', error.message);
    } finally {
      scheduleDailySync(readyClient, hour, timeZone);
    }
  }, Math.max(0, nextRun - Date.now()));
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Whitebird WoW Role Sync conectado como ${readyClient.user.tag}`);
  if (!officerReportChannelId) console.warn('Configura OFFICER_REPORT_CHANNEL_ID para recibir el informe diario automático en Discord.');
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
    if (interaction.isButton() && interaction.customId.startsWith('wow-sync-')) return await handleSyncPreviewComponent(interaction);
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
      return interaction.editReply({ content: formatSyncReport(report), allowedMentions: { parse: [] } });
    }

    if (interaction.commandName === 'wow-sincronizar-revisar') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      if (!interaction.appPermissions?.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ content: 'El bot necesita el permiso **Gestionar roles** para aplicar la sincronización.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const items = await previewWowRoleSync(interaction.guild, getWowLinks(guildId));
      if (!items.length) return interaction.editReply('No hay vinculaciones guardadas que sincronizar.');
      const nonce = randomUUID();
      pendingSyncPreviews.set(nonce, { guildId, userId: interaction.user.id, expiresAt: Date.now() + 5 * 60_000 });
      for (const [key, value] of pendingSyncPreviews) if (value.expiresAt <= Date.now()) pendingSyncPreviews.delete(key);
      return interaction.editReply({ content: formatPreview(items), components: [syncConfirmationRow(nonce)], allowedMentions: { parse: [] } });
    }

    if (interaction.commandName === 'wow-sync-usuario') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      if (!interaction.appPermissions?.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ content: 'El bot necesita el permiso **Gestionar roles**. No se ha modificado ningún rol.', flags: MessageFlags.Ephemeral });
      }
      const target = interaction.options.getUser('usuario', true);
      const link = getWowLinks(guildId).find((item) => item.user_id === target.id);
      if (!link) return interaction.reply({ content: `${target} no tiene un personaje vinculado.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const report = await runSync(interaction.guild, [link]);
      return interaction.editReply({ content: formatSyncReport(report, `Sincronización de ${link.character_name}`), allowedMentions: { parse: [] } });
    }

    if (interaction.commandName === 'wow-auditoria') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const pages = splitReport(await buildAuditReport(interaction.guild));
      await interaction.editReply({ content: pages[0], allowedMentions: { parse: [] } });
      for (const page of pages.slice(1)) await interaction.followUp({ content: page, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }

    if (interaction.commandName === 'wow-historial') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      const target = interaction.options.getUser('usuario');
      const limit = interaction.options.getInteger('limite') || 10;
      const changes = getWowSyncHistory(guildId, target?.id || null, limit);
      const lines = [`**Historial de cambios${target ? ` de ${target.username}` : ''} (${changes.length})**`];
      lines.push(...(changes.length ? changes.map((change) => {
        const operation = change.action === 'added' ? 'recibió' : 'perdió';
        return `• ${change.created_at} — **${change.character_name}** · ${change.realm_slug} ${operation} **${change.role_name}** (${change.category})`;
      }) : ['• No hay cambios guardados todavía.']));
      return interaction.reply({ content: lines.join('\n').slice(0, 1950), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
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

    if (interaction.commandName === 'wow-calderos-vista') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      return interaction.reply({ content: renderCauldronSchedule(guildId), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }

    if (interaction.commandName === 'wow-caldero-probar') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      const weekday = interaction.options.getString('dia', true);
      const type = interaction.options.getString('tipo', true);
      const assignment = getCauldronAssignments(guildId).find((item) => item.weekday === weekday && item.cauldron_type === type);
      if (!assignment) return interaction.reply({ content: 'No hay una asignación para ese día y tipo de caldero.', flags: MessageFlags.Ephemeral });
      const key = (value) => value.normalize('NFC').toLocaleLowerCase('es-ES').replace(/\s+/g, '');
      const matches = getWowLinks(guildId).filter((link) => key(link.character_name) === key(assignment.character_name));
      if (matches.length !== 1 || !matches[0].raider_channel_id) {
        return interaction.reply({ content: `${assignment.character_name} no tiene una vinculación única con canal Raider.`, flags: MessageFlags.Ephemeral });
      }
      const channel = await interaction.guild.channels.fetch(matches[0].raider_channel_id).catch(() => null);
      if (!channel?.isTextBased()) return interaction.reply({ content: `No puedo acceder al canal Raider de ${assignment.character_name}.`, flags: MessageFlags.Ephemeral });
      const dayName = weekdays.find(([key]) => key === weekday)?.[1] || weekday;
      const typeName = type === 'potis' ? 'caldero de pociones' : 'caldero de frascos';
      await channel.send({
        content: `🧪 <@${matches[0].user_id}> **Aviso de prueba (${dayName})**: te corresponde el ${typeName}. Este mensaje es una prueba enviada por un oficial.`,
        allowedMentions: { users: [matches[0].user_id] }
      });
      return interaction.reply({ content: `Envié el aviso de prueba al canal Raider de **${assignment.character_name}**.`, flags: MessageFlags.Ephemeral });
    }

  } catch (error) {
    console.error('Error al procesar interacción:', error);
    const message = 'Ha ocurrido un error. Inténtalo de nuevo o avisa a un oficial.';
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.login(token);
