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
import { getWowLinks, removeWowLink, saveWowLink } from './database.js';
import {
  fetchGuildRoster,
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

function buildLinkReport(targetGuildId) {
  const linked = getWowLinks(targetGuildId);
  const pending = [...pendingWowLinks.entries()]
    .filter(([, item]) => item.guildId === targetGuildId && item.expiresAt > Date.now());
  for (const [nonce, item] of pendingWowLinks) {
    if (item.expiresAt <= Date.now()) pendingWowLinks.delete(nonce);
  }

  const lines = [`**Vinculaciones guardadas (${linked.length})**`];
  lines.push(...(linked.length
    ? linked.map((link) => `• <@${link.user_id}> — **${link.character_name}** · ${link.realm_slug}`)
    : ['• No hay vinculaciones guardadas.']));
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
        `Rangos comprobados: **${report.ranksChecked || 0}** · Rol por defecto aplicado: **${report.defaultRankApplied || 0}** · Profesiones comprobadas: **${report.professionsChecked || 0}**.`
      ];
      if (report.skipped.length) lines.push(`Omitidas (${report.skipped.length}): ${report.skipped.slice(0, 8).join('; ')}`);
      if (report.failed?.length) lines.push(`Errores (${report.failed.length}): ${report.failed.slice(0, 8).join('; ')}`);
      return interaction.editReply(lines.join('\n').slice(0, 1950));
    }

    if (interaction.commandName === 'wow-vinculaciones') {
      if (!isOfficer(interaction)) return interaction.reply(unauthorizedReply());
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const pages = splitReport(buildLinkReport(guildId));
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
