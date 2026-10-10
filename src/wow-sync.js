import 'dotenv/config';
import { ChannelType } from 'discord.js';
import { saveWowLink } from './database.js';

const region = (process.env.WOW_REGION || '').trim().toLowerCase();
const locale = (process.env.WOW_LOCALE || '').trim();
const clientId = process.env.BLIZZARD_CLIENT_ID;
const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;
const realmSlug = (process.env.WOW_GUILD_REALM_SLUG || '').trim().toLowerCase();
const guildSlug = (process.env.WOW_GUILD_SLUG || '').trim().toLowerCase();
const defaultRankRoleId = (process.env.WOW_DEFAULT_RANK_ROLE_ID || '1463652921898963147').trim();

function parseRoleMap(envName) {
  const raw = process.env[envName] || '{}';
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error(`${envName} debe ser un objeto JSON válido.`); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${envName} debe ser un objeto JSON.`);
  for (const [key, id] of Object.entries(value)) {
    if (!/^\d{15,22}$/.test(String(id))) throw new Error(`${envName}: el valor para "${key}" no parece un ID de rol de Discord.`);
  }
  return value;
}

export function getWowConfig() {
  if (!region || !locale || !clientId || !clientSecret || !realmSlug || !guildSlug) {
    throw new Error('Configura BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET, WOW_REGION, WOW_LOCALE, WOW_GUILD_REALM_SLUG y WOW_GUILD_SLUG.');
  }
  if (!['us', 'eu', 'kr', 'tw'].includes(region)) throw new Error('WOW_REGION debe ser us, eu, kr o tw.');
  const rankRoles = parseRoleMap('WOW_RANK_ROLE_IDS');
  const professionRoles = parseRoleMap('WOW_PROFESSION_ROLE_IDS');
  if (!/^\d{15,22}$/.test(defaultRankRoleId)) throw new Error('WOW_DEFAULT_RANK_ROLE_ID no parece un ID de rol de Discord.');
  const ids = [...Object.values(rankRoles), ...Object.values(professionRoles), defaultRankRoleId];
  if (new Set(ids).size !== ids.length) throw new Error('Un mismo ID de rol no puede repetirse entre los rangos, profesiones y el rol por defecto.');
  return {
    region,
    locale,
    rankRoles,
    professionRoles,
    defaultRankRoleId
  };
}

let tokenCache;
async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.value;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) throw new Error(`Blizzard OAuth devolvió HTTP ${response.status}.`);
  const result = await response.json();
  tokenCache = { value: result.access_token, expiresAt: Date.now() + (result.expires_in || 0) * 1000 };
  return tokenCache.value;
}

async function blizzardGet(path, namespace, selectedRegion) {
  const accessToken = await getAccessToken();
  const url = new URL(`https://${selectedRegion}.api.blizzard.com${path}`);
  url.searchParams.set('namespace', `${namespace}-${selectedRegion}`);
  url.searchParams.set('locale', locale);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const error = new Error(`Blizzard devolvió HTTP ${response.status} para ${path}.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function fetchGuildRoster() {
  const config = getWowConfig();
  return blizzardGet(`/data/wow/guild/${encodeURIComponent(realmSlug)}/${encodeURIComponent(guildSlug)}/roster`, 'profile', config.region);
}

async function fetchCharacterProfessions(name, realm, selectedRegion) {
  // Blizzard's profile endpoints require the character name in lowercase.
  return blizzardGet(`/profile/wow/character/${encodeURIComponent(realm.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}/professions`, 'profile', selectedRegion);
}

// Character accents are significant in WoW names: Agô and Agó must not resolve to the same character.
const normalize = (value) => String(value || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const normalizeIgnoringAccents = (value) => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function differsOnlyByAccents(left, right) {
  return normalize(left) !== normalize(right) && normalizeIgnoringAccents(left) === normalizeIgnoringAccents(right);
}

function findRosterEntry(roster, name, realm) {
  const targetName = normalize(name);
  const targetRealm = normalize(realm);
  return (roster.members || []).find(({ character }) =>
    normalize(character?.name) === targetName && normalize(character?.realm?.slug) === targetRealm
  ) || null;
}

function similarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const old = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
      diagonal = old;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

export function rankGuildRosterCandidates(roster, aliases) {
  const names = aliases.map(normalize).filter(Boolean);
  const byKey = new Map();
  for (const entry of roster.members || []) {
    const name = entry.character?.name;
    const realm = entry.character?.realm?.slug;
    if (!name || !realm) continue;
    const key = `${normalize(name)}@${normalize(realm)}`;
    const candidateNames = [normalize(name), normalize(`${name}${realm}`)];
    const score = Math.max(0, ...names.flatMap((alias) => candidateNames.map((candidate) =>
      differsOnlyByAccents(alias, candidate) ? 0 : similarity(alias, candidate)
    )));
    const previous = byKey.get(key);
    if (!previous || score > previous.score) byKey.set(key, { name, realm, score });
  }
  return [...byKey.values()].sort((left, right) => right.score - left.score);
}

function roleIsManageable(role, botMember) {
  return Boolean(role && !role.managed && role.position < botMember.roles.highest.position);
}

function cleanChannelName(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'recluta';
}

function getRaiderChannelName(prefix, characterName, realmSlug) {
  return `${cleanChannelName(prefix)}-${cleanChannelName(characterName)}-${cleanChannelName(realmSlug)}`.slice(0, 100);
}

function getChannelPrefix(member, guild, config) {
  const mappedRank = Object.entries(config.rankRoles)
    .filter(([, roleId]) => member.roles.cache.has(roleId))
    .sort(([leftRank], [rightRank]) => Number(leftRank) - Number(rightRank))[0];
  const roleId = mappedRank?.[1] || (member.roles.cache.has(config.defaultRankRoleId) ? config.defaultRankRoleId : null);
  return (roleId && guild.roles.cache.get(roleId)?.name) || 'raider';
}

async function renameRaiderChannel(guild, link, prefix, characterName, realmSlug) {
  const expectedName = getRaiderChannelName(prefix, characterName, realmSlug);
  let channel = link.raider_channel_id ? guild.channels.cache.get(link.raider_channel_id) : null;
  if (!channel && link.raider_channel_id) channel = await guild.channels.fetch(link.raider_channel_id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) channel = null;
  if (!channel) {
    const characterRealmSuffix = `-${cleanChannelName(characterName)}-${cleanChannelName(realmSlug)}`;
    channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && item.name.endsWith(characterRealmSuffix));
  }
  if (!channel) return null;

  if (link.raider_channel_id !== channel.id || link.character_name !== characterName || link.realm_slug !== realmSlug) {
    saveWowLink(guild.id, link.user_id, characterName, realmSlug, channel.id);
  }
  if (channel.name !== expectedName) {
    const previousName = channel.name;
    await channel.setName(expectedName, 'Sincronización de nombre del canal personal de Raider');
    return { channel, previousName };
  }
  return { channel, previousName: null };
}

async function updateRaiderChannelName(guild, link, member, config, report, characterName, realmSlug) {
  let currentMember = member;
  try { currentMember = await guild.members.fetch({ user: member.id, force: true }); } catch { /* use the member already in cache */ }
  const prefix = getChannelPrefix(currentMember, guild, config);
  try {
    const result = await renameRaiderChannel(guild, link, prefix, characterName, realmSlug);
    if (result?.previousName) {
      report.channelsRenamed += 1;
      report.channelDetails.push(`${result.previousName} → ${result.channel.name}`);
    } else if (!result) {
      report.channelFailures.push(`${characterName}: no se encontró un canal Raider vinculado`);
    }
  } catch (error) {
    report.channelFailures.push(`${getRaiderChannelName(prefix, characterName, realmSlug)}: ${error.message}`);
  }
}

async function reconcileRoles(member, desiredIds, managedIds, botMember) {
  const add = [];
  const remove = [];
  for (const id of managedIds) {
    const role = member.guild.roles.cache.get(id);
    if (!roleIsManageable(role, botMember)) continue;
    const hasRole = member.roles.cache.has(id);
    if (desiredIds.has(id) && !hasRole) add.push(id);
    if (!desiredIds.has(id) && hasRole) remove.push(id);
  }
  // Apply roles one at a time. Passing an array makes discord.js replace the member's
  // complete role list, which can overwrite another role update from this same sync.
  for (const id of add) await member.roles.add(id, 'Sincronización de roles WoW Whitebird');
  for (const id of remove) await member.roles.remove(id, 'Sincronización de roles WoW Whitebird');
  return { added: add, removed: remove, changed: add.length > 0 || remove.length > 0 };
}

async function addMissingRoles(member, desiredIds, botMember) {
  const add = [...desiredIds].filter((id) => {
    const role = member.guild.roles.cache.get(id);
    return roleIsManageable(role, botMember) && !member.roles.cache.has(id);
  });
  for (const id of add) await member.roles.add(id, 'Profesión encontrada en un personaje vinculado de WoW');
}

export async function synchronizeWowRoles(guild, linkedMembers) {
  const config = getWowConfig();
  const roster = await fetchGuildRoster();
  const rankRoleIds = new Set([...Object.values(config.rankRoles), config.defaultRankRoleId]);
  const professionRoleIds = new Set(Object.values(config.professionRoles));
  const managedIds = new Set([...rankRoleIds, ...professionRoleIds]);
  const botMember = await guild.members.fetchMe();
  for (const id of managedIds) {
    const role = guild.roles.cache.get(id);
    if (!role || role.managed || role.position >= botMember.roles.highest.position) {
      throw new Error(`El rol configurado ${id} no existe en el servidor o está fuera de la jerarquía que puede gestionar el bot. No se han aplicado cambios.`);
    }
  }
  const report = { synced: 0, ranksChecked: 0, defaultRankApplied: 0, outsideRoster: 0, outsideRosterDefaultApplied: 0, rankDetails: [], channelsRenamed: 0, channelDetails: [], channelFailures: [], professionsChecked: 0, skipped: [], failed: [] };

  try { await guild.channels.fetch(); } catch (error) {
    report.channelFailures.push(`No se pudieron consultar los canales de Raider (${error.message})`);
  }

  for (const link of linkedMembers) {
    const rosterEntry = findRosterEntry(roster, link.character_name, link.realm_slug);
    const characterName = rosterEntry?.character.name || link.character_name;
    const characterRealm = rosterEntry?.character.realm.slug || link.realm_slug;
    let member;
    try {
      member = await guild.members.fetch(link.user_id);
    } catch {
      report.skipped.push(`${link.character_name}: no se encontró su usuario de Discord`);
      continue;
    }

    if (!rosterEntry) {
      report.outsideRoster += 1;
      try {
        const changes = await reconcileRoles(member, new Set([config.defaultRankRoleId]), managedIds, botMember);
        report.ranksChecked += 1;
        if (changes.changed) {
          report.defaultRankApplied += 1;
          report.outsideRosterDefaultApplied += 1;
          const roleName = guild.roles.cache.get(config.defaultRankRoleId)?.name || config.defaultRankRoleId;
          report.rankDetails.push(`${link.character_name}: fuera del roster → ${roleName} (rangos y profesiones configuradas retirados)`);
        }
        report.synced += 1;
      } catch (error) {
        report.failed.push(`${link.character_name}: no se pudo asignar el rol por defecto al salir del roster (${error.message})`);
      }
      await updateRaiderChannelName(guild, link, member, config, report, characterName, characterRealm);
      continue;
    }

    const character = rosterEntry.character;
    if (link.character_name !== character.name || link.realm_slug !== character.realm.slug) {
      try {
        saveWowLink(guild.id, link.user_id, character.name, character.realm.slug);
      } catch (error) {
        report.failed.push(`${character.name}: no se pudo normalizar el nombre guardado (${error.message})`);
      }
    }

    const rankKey = String(rosterEntry.rank);
    const configuredRankRoleId = config.rankRoles[rankKey];
    const rankRoleId = configuredRankRoleId || config.defaultRankRoleId;
    try {
      const changes = await reconcileRoles(member, new Set([rankRoleId]), rankRoleIds, botMember);
      report.ranksChecked += 1;
      if (changes.changed) {
        const roleName = guild.roles.cache.get(rankRoleId)?.name || rankRoleId;
        if (!configuredRankRoleId) report.defaultRankApplied += 1;
        report.rankDetails.push(`${character.name}: rango ${rankKey} → ${roleName}${configuredRankRoleId ? '' : ' (predeterminado)'}`);
      }
    } catch (error) {
      report.failed.push(`${character.name}: rango ${rankKey} sin actualizar (${error.message})`);
    }

    await updateRaiderChannelName(guild, link, member, config, report, character.name, character.realm.slug);

    try {
      const professions = await fetchCharacterProfessions(character.name, character.realm.slug, config.region);
      if (!Array.isArray(professions.primaries)) {
        throw new Error('Blizzard no devolvió una lista válida de profesiones principales; se conservan los roles actuales.');
      }
      const primaryProfessionNames = professions.primaries.map((entry) => entry.profession?.name);
      if (primaryProfessionNames.some((name) => typeof name !== 'string' || !name.trim())) {
        throw new Error('La respuesta de Blizzard contiene profesiones incompletas; se conservan los roles actuales.');
      }
      const names = primaryProfessionNames.map(normalize);
      const desiredProfessionIds = new Set(Object.entries(config.professionRoles)
        .filter(([name]) => names.includes(normalize(name)))
        .map(([, id]) => id));
      // Profession roles may represent an alt, so sync only adds them and never removes them.
      await addMissingRoles(member, desiredProfessionIds, botMember);
      report.professionsChecked += 1;
    } catch (error) {
      // Missing or malformed profile data must not strip existing profession roles.
      report.skipped.push(`${character.name}: profesiones sin actualizar (${error.message})`);
    }
    report.synced += 1;
  }
  return report;
}

export function findGuildRosterCharacter(roster, name, realm) {
  const entry = findRosterEntry(roster, name, realm);
  if (!entry) return null;
  return { name: entry.character.name, realm: entry.character.realm.slug, rank: entry.rank };
}

export function getUnlinkedMappedRosterMembers(roster, linkedMembers, rankRoles) {
  const linkedKeys = new Set(linkedMembers.map((link) =>
    `${normalize(link.character_name)}@${normalize(link.realm_slug)}`
  ));
  return (roster.members || [])
    .filter(({ character, rank }) => {
      if (!rankRoles[String(rank)] || !character?.name || !character?.realm?.slug) return false;
      const key = `${normalize(character.name)}@${normalize(character.realm.slug)}`;
      return !linkedKeys.has(key);
    })
    .map(({ character, rank }) => ({ name: character.name, realm: character.realm.slug, rank }))
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name));
}
