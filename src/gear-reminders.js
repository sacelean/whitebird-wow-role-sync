import { auditGet } from './wowaudit.js';
import { nextDailyRun } from './daily-cauldron.js';

const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const normalize = (value) => String(value || '').normalize('NFC').toLocaleLowerCase('es-ES').replace(/[\s’'-]/g, '');
const identity = (name, realm) => `${normalize(name)}:${normalize(realm)}`;

const slotNames = {
  main_hand: 'mano principal', off_hand: 'mano secundaria', head: 'cabeza', neck: 'cuello',
  shoulder: 'hombros', back: 'espalda', chest: 'pecho', wrist: 'muñecas', hands: 'manos',
  waist: 'cintura', legs: 'piernas', feet: 'pies', finger_1: 'anillo 1', finger_2: 'anillo 2',
  trinket_1: 'abalorio 1', trinket_2: 'abalorio 2'
};

class GearReminderError extends Error {}

function requireSchema(ok, detail) {
  if (!ok) throw new GearReminderError(`WoWAudit: respuesta de auditoría incompatible (${detail}).`);
}

export function getGearReminderConfig(env = process.env) {
  const apiKey = env.WOWAUDIT_API_KEY?.trim();
  if (!apiKey) return null;
  const teamId = Number(env.WOWAUDIT_TEAM_ID);
  if (!positiveId(teamId)) throw new GearReminderError('WOWAUDIT_TEAM_ID debe ser el identificador numérico del equipo.');
  return { apiKey, teamId };
}

function readAuditCategory(enchantData, name) {
  const category = enchantData?.[name];
  requireSchema(category && Number.isSafeInteger(category.total) && category.total >= 0 && Array.isArray(category.characters), `enchantData.${name}`);
  const result = new Map();
  let entries = 0;
  for (const character of category.characters) {
    requireSchema(positiveId(character?.id) && Array.isArray(character.slots) && character.slots.every((slot) => typeof slot === 'string'), `${name}.characters`);
    const slots = result.get(character.id) || new Set();
    entries += character.slots.length;
    for (const slot of character.slots) {
      requireSchema(Object.hasOwn(slotNames, slot), `${name}.slots`);
      slots.add(slot);
    }
    result.set(character.id, slots);
  }
  requireSchema(entries === category.total, `${name}.total`);
  return result;
}

export function buildGearReminderMessages(team, overview, links) {
  requireSchema(Array.isArray(team?.members), 'team.members');
  requireSchema(overview?.enchantData && typeof overview.enchantData === 'object', 'enchantData');
  const missingEnchants = readAuditCategory(overview.enchantData, 'enchants_missing');
  const emptySockets = readAuditCategory(overview.enchantData, 'empty_sockets');

  const characters = new Map();
  for (const member of team.members) {
    const character = member?.characterReference;
    const id = character?.id;
    const name = character?.name;
    const realm = character?.realm?.slug || character?.realm?.name;
    requireSchema(positiveId(id) && typeof name === 'string' && name.length > 0 && typeof realm === 'string' && realm.length > 0, 'team.members.characterReference');
    requireSchema(!characters.has(id), 'team.members.characterReference.id duplicado');
    characters.set(id, { id, name, realm, enchants: missingEnchants.get(id) || new Set(), sockets: emptySockets.get(id) || new Set() });
  }

  const linksByIdentity = new Map();
  for (const link of links) {
    const key = identity(link.character_name, link.realm_slug);
    const matches = linksByIdentity.get(key) || [];
    matches.push(link);
    linksByIdentity.set(key, matches);
  }

  const byUser = new Map();
  const unlinked = [];
  for (const id of new Set([...missingEnchants.keys(), ...emptySockets.keys()])) {
    const character = characters.get(id);
    requireSchema(character, `personaje ${id} de overview_data ausente en team.members`);
    const matches = linksByIdentity.get(identity(character.name, character.realm)) || [];
    if (matches.length !== 1) {
      unlinked.push({ name: character.name, realm: character.realm, ambiguous: matches.length > 1 });
      continue;
    }
    const { user_id: userId, raider_channel_id: channelId } = matches[0];
    if (!channelId) {
      unlinked.push({ name: character.name, realm: character.realm, ambiguous: false, missingChannel: true });
      continue;
    }
    const recipientKey = `${channelId}:${userId}`;
    const recipient = byUser.get(recipientKey) || { userId, channelId, characters: [] };
    recipient.characters.push(character);
    byUser.set(recipientKey, recipient);
  }

  const messages = [...byUser.values()].map(({ userId, channelId, characters: affected }) => {
    const lines = [`<@${userId}> Según la auditoría de equipo de WoWAudit, revisa estas piezas por si se te pasó mejorarlas:`];
    for (const character of affected.sort((a, b) => identity(a.name, a.realm).localeCompare(identity(b.name, b.realm), 'en'))) {
      lines.push('', `**${character.name} · ${character.realm}**`);
      if (character.enchants.size) lines.push(`• Encantamiento ausente: ${[...character.enchants].map((slot) => slotNames[slot]).join(', ')}.`);
      if (character.sockets.size) lines.push(`• Hueco de gema vacío: ${[...character.sockets].map((slot) => slotNames[slot]).join(', ')}.`);
    }
    return { userId, channelId, content: lines.join('\n') };
  });
  return { messages, unlinked };
}

export async function fetchGearReminderMessages(config, links, fetcher = fetch) {
  const base = `/api/teams/${config.teamId}`;
  const [team, overview] = await Promise.all([
    auditGet(base, config.apiKey, fetcher),
    auditGet(`${base}/overview_data`, config.apiKey, fetcher)
  ]);
  return buildGearReminderMessages(team, overview, links);
}

export async function sendGearReminders(guild, config, links, fetcher = fetch) {
  const { messages, unlinked } = await fetchGearReminderMessages(config, links, fetcher);
  for (const character of unlinked) {
    const reason = character.ambiguous ? 'vinculación ambigua' : character.missingChannel ? 'sin canal Raider asociado' : 'sin vínculo de Discord';
    console.warn(`Aviso WoWAudit omitido para ${character.name} · ${character.realm}: ${reason}.`);
  }
  let sent = 0;
  let failed = 0;
  for (const { userId, channelId, content } of messages) {
    try {
      const channel = await guild.channels.fetch(channelId);
      if (!channel?.isTextBased() || typeof channel.send !== 'function') throw new Error('el canal Raider no existe o no admite mensajes');
      await channel.send({ content, allowedMentions: { users: [userId] } });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.warn(`No se pudo enviar el aviso WoWAudit al canal Raider ${channelId} para ${userId}: ${error.message}`);
    }
  }
  return { sent, failed, unlinked: unlinked.length, affected: messages.length };
}

export function startGearReminderScheduler(client, guildId, getLinks) {
  let config;
  try { config = getGearReminderConfig(); }
  catch (error) { console.error(error.message); return null; }
  if (!config) {
    console.warn('Avisos diarios de WoWAudit desactivados: configura WOWAUDIT_API_KEY y WOWAUDIT_TEAM_ID.');
    return null;
  }

  let timer;
  let busy = false;
  const schedule = () => {
    const timeZone = 'Europe/Madrid';
    const nextRun = nextDailyRun(22, timeZone);
    console.log(`Próximo aviso de encantamientos y gemas WoWAudit: ${new Date(nextRun).toLocaleString('es-ES', { timeZone })} (${timeZone}).`);
    timer = setTimeout(async () => {
      if (busy) return schedule();
      busy = true;
      try {
        const guild = await client.guilds.fetch(guildId);
        const result = await sendGearReminders(guild, config, getLinks(guild.id));
        console.log(`Avisos WoWAudit de encantamientos/gemas: ${result.sent} enviados · ${result.failed} fallidos · ${result.unlinked} personajes sin vínculo.`);
      } catch (error) {
        console.error('Falló la consulta o el envío de avisos WoWAudit de encantamientos/gemas:', error.message);
      } finally {
        busy = false;
        schedule();
      }
    }, Math.max(0, nextRun - Date.now()));
    timer.unref();
  };
  schedule();
  client.once('invalidated', () => clearTimeout(timer));
  return timer;
}
