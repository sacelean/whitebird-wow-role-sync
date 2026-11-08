import { auditGet } from './wowaudit.js';

export function combatRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return ({ tank: 'tank', heal: 'healer', healer: 'healer', melee: 'dps', ranged: 'dps', dps: 'dps' })[role] || null;
}

// Explicit playable specialization IDs; unknown/initial specs deliberately have no role.
export const SPECIALIZATION_ROLES = Object.freeze({
  // Warrior
  71: 'dps', 72: 'dps', 73: 'tank',
  // Paladin
  65: 'healer', 66: 'tank', 70: 'dps',
  // Hunter
  253: 'dps', 254: 'dps', 255: 'dps',
  // Rogue
  259: 'dps', 260: 'dps', 261: 'dps',
  // Priest: Discipline, Holy, Shadow
  256: 'healer', 257: 'healer', 258: 'dps',
  // Death Knight
  250: 'tank', 251: 'dps', 252: 'dps',
  // Shaman
  262: 'dps', 263: 'dps', 264: 'healer',
  // Mage
  62: 'dps', 63: 'dps', 64: 'dps',
  // Warlock
  265: 'dps', 266: 'dps', 267: 'dps',
  // Monk: Brewmaster, Windwalker, Mistweaver
  268: 'tank', 269: 'dps', 270: 'healer',
  // Druid
  102: 'dps', 103: 'dps', 104: 'tank', 105: 'healer',
  // Demon Hunter
  577: 'dps', 581: 'tank', 1480: 'dps',
  // Evoker
  1467: 'dps', 1468: 'healer', 1473: 'dps'
});

export function specializationRole(profile) {
  const nestedId = profile?.currentSpec?.id;
  const flatId = profile?.currentSpecId;
  // Conflicting identifiers are unsafe to use for an equipment reminder.
  if (nestedId != null && flatId != null && nestedId !== flatId) return null;
  const id = nestedId ?? flatId;
  return Number.isSafeInteger(id) && Object.hasOwn(SPECIALIZATION_ROLES, id)
    ? SPECIALIZATION_ROLES[id] : null;
}

const identity = (name, realm) => `${String(name || '').normalize('NFC').toLowerCase()}:${String(realm || '').normalize('NFC').toLowerCase().replace(/[\s’'-]/g, '')}`;

export function findAuditCharacter(roster, name, realm) {
  const matches = roster.filter(character => identity(character.name, character.realm) === identity(name, realm));
  return matches.length === 1 ? matches[0] : null;
}

export async function fetchCombatRoster(apiKey, fetcher = fetch) {
  const roster = await auditGet('/v1/characters', apiKey, fetcher);
  if (!Array.isArray(roster)) throw new Error('WoWAudit: roster de roles incompatible.');
  return roster;
}

const combatRoleNames = { tank: 'Tankes', healer: 'Healers', dps: 'DPS' };

export function resolveCombatRoles(guild, { allowMissing = false } = {}) {
  const result = {};
  for (const [key, name] of Object.entries(combatRoleNames)) {
    const matches = [...guild.roles.cache.values()].filter(role => role.name.toLowerCase() === name.toLowerCase());
    if (allowMissing && !matches.length) continue;
    if (matches.length !== 1) throw new Error(`Debe existir un único rol de Discord llamado ${name}.`);
    result[key] = matches[0].id;
  }
  return result;
}
