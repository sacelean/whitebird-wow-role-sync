import 'dotenv/config';

const region = (process.env.WOW_REGION || '').trim().toLowerCase();
const locale = (process.env.WOW_LOCALE || '').trim();
const clientId = process.env.BLIZZARD_CLIENT_ID;
const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;
const wowauditApiKey = process.env.WOWAUDIT_API_KEY;
const wowauditApiBase = (process.env.WOWAUDIT_API_BASE_URL || 'https://api.wowaudit.com').replace(/\/$/, '');
const realmSlug = (process.env.WOW_GUILD_REALM_SLUG || '').trim().toLowerCase();
const guildSlug = (process.env.WOW_GUILD_SLUG || '').trim().toLowerCase();

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
  if (!region || !locale || !clientId || !clientSecret || !wowauditApiKey || !realmSlug || !guildSlug) {
    throw new Error('Configura WOWAUDIT_API_KEY, BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET, WOW_REGION, WOW_LOCALE, WOW_GUILD_REALM_SLUG y WOW_GUILD_SLUG.');
  }
  if (!['us', 'eu', 'kr', 'tw'].includes(region)) throw new Error('WOW_REGION debe ser us, eu, kr o tw.');
  const rankRoles = parseRoleMap('WOW_RANK_ROLE_IDS');
  const professionRoles = parseRoleMap('WOW_PROFESSION_ROLE_IDS');
  const ids = [...Object.values(rankRoles), ...Object.values(professionRoles)];
  if (new Set(ids).size !== ids.length) throw new Error('Un mismo ID de rol no puede aparecer en ambos mapeos ni repetirse.');
  return {
    region,
    locale,
    rankRoles,
    professionRoles
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

export async function fetchWowAuditCharacters() {
  const response = await fetch(`${wowauditApiBase}/v1/characters`, {
    headers: { Authorization: `Bearer ${wowauditApiKey}` }
  });
  if (!response.ok) throw new Error(`WoWAudit devolvió HTTP ${response.status} al leer el roster.`);
  const payload = await response.json();
  const characters = Array.isArray(payload) ? payload
    : Array.isArray(payload.data) ? payload.data
      : Array.isArray(payload.characters) ? payload.characters
        : Array.isArray(payload.data?.characters) ? payload.data.characters : null;
  if (!characters) throw new Error('La respuesta de WoWAudit no contiene una lista de personajes reconocible.');
  return characters;
}

async function fetchCharacterProfessions(name, realm, selectedRegion) {
  return blizzardGet(`/profile/wow/character/${encodeURIComponent(realm)}/${encodeURIComponent(name)}/professions`, 'profile', selectedRegion);
}

const normalize = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function findRosterEntry(roster, name, realm) {
  const targetName = normalize(name);
  const targetRealm = normalize(realm);
  return (roster.members || []).find(({ character }) =>
    normalize(character?.name) === targetName && normalize(character?.realm?.slug) === targetRealm
  ) || null;
}

function getCharacterName(entry) {
  return entry.name || entry.character_name || entry.characterName || entry.character?.name || '';
}

function getCharacterRealm(entry) {
  const value = entry.realm_slug || entry.realmSlug || entry.realm?.slug || entry.realm?.name || entry.realm || entry.character?.realm?.slug || '';
  return typeof value === 'object' ? (value.slug || value.name || '') : String(value);
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

export function rankWowAuditCandidates(characters, aliases) {
  const names = aliases.map(normalize).filter(Boolean);
  const byKey = new Map();
  for (const entry of characters) {
    const name = getCharacterName(entry);
    const realm = getCharacterRealm(entry);
    if (!name || !realm) continue;
    const key = `${normalize(name)}@${normalize(realm)}`;
    const candidateNames = [normalize(name), normalize(`${name}${realm}`)];
    const score = Math.max(0, ...names.flatMap((alias) => candidateNames.map((candidate) => similarity(alias, candidate))));
    const previous = byKey.get(key);
    if (!previous || score > previous.score) byKey.set(key, { name, realm, score });
  }
  return [...byKey.values()].sort((left, right) => right.score - left.score);
}

function roleIsManageable(role, botMember) {
  return Boolean(role && !role.managed && role.position < botMember.roles.highest.position);
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
  if (add.length) await member.roles.add(add, 'Sincronización de roles WoW Whitebird');
  if (remove.length) await member.roles.remove(remove, 'Sincronización de roles WoW Whitebird');
}

export async function synchronizeWowRoles(guild, linkedMembers) {
  const config = getWowConfig();
  const roster = await fetchGuildRoster();
  const auditCharacters = await fetchWowAuditCharacters();
  const rankRoleIds = new Set(Object.values(config.rankRoles));
  const professionRoleIds = new Set(Object.values(config.professionRoles));
  const managedIds = new Set([...rankRoleIds, ...professionRoleIds]);
  const botMember = await guild.members.fetchMe();
  for (const id of managedIds) {
    const role = guild.roles.cache.get(id);
    if (!role || role.managed || role.position >= botMember.roles.highest.position) {
      throw new Error(`El rol configurado ${id} no existe en el servidor o está fuera de la jerarquía que puede gestionar el bot. No se han aplicado cambios.`);
    }
  }
  const report = { synced: 0, skipped: [], failed: [] };

  for (const link of linkedMembers) {
    const auditCharacter = auditCharacters.find((entry) =>
      normalize(getCharacterName(entry)) === normalize(link.character_name) &&
      normalize(getCharacterRealm(entry)) === normalize(link.realm_slug)
    );
    if (!auditCharacter) {
      report.skipped.push(`${link.character_name}-${link.realm_slug}: no aparece en el roster de WoWAudit`);
      continue;
    }
    const rosterEntry = findRosterEntry(roster, link.character_name, link.realm_slug);
    if (!rosterEntry) {
      report.skipped.push(`${link.character_name}-${link.realm_slug}: no aparece en el roster`);
      continue;
    }
    const character = rosterEntry.character;
    let member;
    try {
      member = await guild.members.fetch(link.user_id);
    } catch {
      report.skipped.push(`${link.character_name}: no se encontró su usuario de Discord`);
      continue;
    }

    const rankKey = String(rosterEntry.rank);
    const rankRoleId = config.rankRoles[rankKey];
    const desiredRankIds = rankRoleId ? new Set([rankRoleId]) : null;
    if (desiredRankIds) await reconcileRoles(member, desiredRankIds, rankRoleIds, botMember);

    try {
      const professions = await fetchCharacterProfessions(character.name, character.realm.slug, config.region);
      const names = (professions.primaries || []).flatMap((entry) => entry.professions || []).map((entry) => normalize(entry.name));
      const desiredProfessionIds = new Set(Object.entries(config.professionRoles)
        .filter(([name]) => names.includes(normalize(name)))
        .map(([, id]) => id));
      await reconcileRoles(member, desiredProfessionIds, professionRoleIds, botMember);
    } catch (error) {
      // A missing or temporarily unavailable character profile must not strip existing profession roles.
      report.skipped.push(`${character.name}: profesiones sin actualizar (${error.message})`);
    }
    report.synced += 1;
  }
  return report;
}

export function validateWowAuditCharacter(characters, name, realm) {
  return characters.find((entry) =>
    normalize(getCharacterName(entry)) === normalize(name) &&
    normalize(getCharacterRealm(entry)) === normalize(realm)
  ) || null;
}
