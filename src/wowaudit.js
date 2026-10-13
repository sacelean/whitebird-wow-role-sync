// Contract: https://wowaudit.com/api (official embedded Swagger, verified 2026-10-13).
const key = (s) => s.normalize('NFC').toLowerCase().replace(/[\s’']/g, '').replace(/-/g, '');
const identity = (name, realm) => `${key(name)}:${key(realm)}`;
export const DEFAULT_LOOT_RANKS = ['Oficiales', 'Fijo', 'Rotativo'];
export const DEFAULT_LOOT_CATEGORIES = ['BIS', 'Mejora de stats', 'set 4p', 'Catalizar'];
const categoryKey = s => s.normalize('NFC').trim().toLocaleLowerCase('es-ES').replace(/\s+/g, ' ');
const positiveId = (n) => Number.isSafeInteger(n) && n > 0;
class WoWAuditError extends Error {}
export function lootErrorMessage(error) {
  return error instanceof WoWAuditError ? error.message : 'WoWAudit: error interno al generar o mostrar el informe.';
}
function requireSchema(ok, detail = 'respuesta incompatible') {
  if (!ok) throw new WoWAuditError(`WoWAudit: ${detail}; informe cancelado.`);
}

export function getLootConfig(env = process.env) {
  if (!env.WOWAUDIT_API_KEY && !env.WOWAUDIT_LOOT_CHANNEL_ID) return null;
  if (!env.WOWAUDIT_API_KEY?.trim() || !/^\d{17,20}$/.test(env.WOWAUDIT_LOOT_CHANNEL_ID || '')) {
    throw new WoWAuditError('Configura WOWAUDIT_API_KEY y WOWAUDIT_LOOT_CHANNEL_ID.');
  }
  const days = env.WOWAUDIT_LOOT_WINDOW_DAYS ? Number(env.WOWAUDIT_LOOT_WINDOW_DAYS) : null;
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3660)) throw new WoWAuditError('WOWAUDIT_LOOT_WINDOW_DAYS debe estar entre 1 y 3660.');
  const categories = (env.WOWAUDIT_LOOT_CATEGORIES || DEFAULT_LOOT_CATEGORIES.join(',')).split(',').map(s => s.trim());
  if (categories.some(s => !s || s.length > 100)) throw new WoWAuditError('WOWAUDIT_LOOT_CATEGORIES no válido.');
  const ranks = (env.WOWAUDIT_LOOT_RANKS || DEFAULT_LOOT_RANKS.join(',')).split(',').map(s => s.trim());
  if (ranks.length > 10 || ranks.some(s => !s || s.length > 100)) throw new WoWAuditError('WOWAUDIT_LOOT_RANKS no válido.');
  return { apiKey: env.WOWAUDIT_API_KEY.trim(), channelId: env.WOWAUDIT_LOOT_CHANNEL_ID, days, categories, ranks };

}

export async function auditGet(path, apiKey, fetcher = fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetcher(`https://wowaudit.com${path}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000), redirect: 'error'
      });
    } catch {
      if (attempt === 2) throw new WoWAuditError('WoWAudit: fallo de conexión o timeout.');
      continue;
    }
    if (response.ok) {
      try { return await response.json(); } catch { throw new WoWAuditError('WoWAudit: JSON no válido.'); }
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw new WoWAuditError(`WoWAudit: HTTP ${response.status}.`);
    const seconds = Number(response.headers.get('retry-after'));
    await new Promise(resolve => setTimeout(resolve, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 10) * 1000 : 1000 * (attempt + 1)));
  }
}

export function buildLootRanking(roster, history, links, { start, end, categories = DEFAULT_LOOT_CATEGORIES, ranks = DEFAULT_LOOT_RANKS }) {
  requireSchema(Array.isArray(roster), '/v1/characters no devuelve un array');
  requireSchema(Array.isArray(history), 'historial sin array history_items');
  const characters = new Map();
  const identities = new Map();
  for (const c of roster) {
    requireSchema(positiveId(c.id) && typeof c.name === 'string' && c.name.length > 0 && typeof c.realm === 'string' && c.realm.length > 0 && typeof c.rank === 'string' && typeof c.status === 'string');
    if (characters.has(c.id)) {
      requireSchema(JSON.stringify(characters.get(c.id)) === JSON.stringify(c));
      continue;
    }
    const nameKey = identity(c.name, c.realm);
    requireSchema(!identities.has(nameKey));
    characters.set(c.id, c); identities.set(nameKey, c.id);
  }
  const rows = new Map([...characters.values()].filter(c => c.status === 'tracking' && ranks.some(rank => categoryKey(rank) === categoryKey(c.rank))).map(c => {
    const matches = links.filter(l => identity(l.character_name, l.realm_slug) === identity(c.name, c.realm));
    return [c.id, { ...c, count: 0, userId: matches.length === 1 ? matches[0].user_id : null }];
  }));
  requireSchema(rows.size > 0, 'no hay personajes con los rangos configurados y status tracking en el roster; revisa WOWAUDIT_LOOT_RANKS');
  const ids = new Map(), imports = new Map();
  let outsideRoster = 0;
  for (const item of history) {
    requireSchema(positiveId(item.id) && positiveId(item.character_id) && positiveId(item.item_id) && typeof item.discarded === 'boolean' && typeof item.awarded_at === 'string' && Number.isFinite(Date.parse(item.awarded_at)));
    requireSchema(typeof item.difficulty === 'string' && (item.response_type === null || typeof item.response_type?.name === 'string'));
    const signature = JSON.stringify([item.character_id, item.item_id, item.awarded_at, item.discarded, item.difficulty, item.response_type?.name]);
    if (ids.has(item.id)) { requireSchema(ids.get(item.id) === signature); continue; }
    ids.set(item.id, signature);
    if (item.rclootcouncil_id) {
      requireSchema(typeof item.rclootcouncil_id === 'string');
      if (imports.has(item.rclootcouncil_id)) { requireSchema(imports.get(item.rclootcouncil_id) === signature); continue; }
      imports.set(item.rclootcouncil_id, signature);
    }
    const time = Date.parse(item.awarded_at);
    if (item.discarded || time < start || time >= end || item.difficulty.toLowerCase() !== 'mythic' ||
        !item.response_type || !categories.some(c => categoryKey(c) === categoryKey(item.response_type.name))) continue;
    if (rows.has(item.character_id)) rows.get(item.character_id).count++;
    else outsideRoster++;
  }
  const compare = (a,b) => identity(a.name,a.realm).localeCompare(identity(b.name,b.realm), 'en') || a.id-b.id;
  const ordered = (direction) => {
    const all = [...rows.values()].sort((a,b) => direction * (a.count-b.count) || compare(a,b));
    return all.slice(0,5).map((r,i) => ({ ...r, position: all.findIndex(x => x.count === r.count) + 1, cutTie: i === 4 && all[5]?.count === r.count }));
  };
  return { most: ordered(-1), least: ordered(1), size: rows.size, total: [...rows.values()].reduce((n,r)=>n+r.count,0), outsideRoster };
}

export async function fetchLootReport(config, links, end = Date.now(), fetcher = fetch) {
  const period = await auditGet('/v1/period', config.apiKey, fetcher);
  const season = period?.current_season;
  // Legacy Swagger exposes keystone_season_id; the live API omits it and uses id.
  // Live contract verified: current_season.id=18 -> /v1/loot_history/18 returns history_items.
  const seasonId = season?.keystone_season_id ?? season?.id;
  requireSchema(positiveId(seasonId) && typeof season.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(season.start_date), '/v1/period sin identificador de temporada o fecha de inicio válida');
  // WoWAudit provides a date without a timezone; use explicit UTC midnight.
  const seasonStart = Date.parse(`${season.start_date}T00:00:00Z`);
  requireSchema(Number.isFinite(seasonStart) && seasonStart < end);
  const start = Math.max(seasonStart, config.days ? end - config.days * 86400000 : seasonStart);
  const roster = await auditGet('/v1/characters', config.apiKey, fetcher);
  const loot = await auditGet(`/v1/loot_history/${seasonId}`, config.apiKey, fetcher);
  const ranking = buildLootRanking(roster, loot?.history_items, links, { start, end, categories: config.categories, ranks: config.ranks });
  const safe = s => s.replace(/[\\*_`~|<>@]/g, '').replace(/[\r\n]/g,' ').slice(0,30);
  const section = (title, rows) => [title, ...rows.map(r => `${r.position}. ${safe(r.name)} · ${safe(r.realm)}${r.userId ? ` (<@${r.userId}>)` : ''}: **${r.count}**${r.cutTie ? ' (empate en el corte)' : ''}`)].join('\n');
  const content = [
    '**Informe semanal de loot registrado en WoWAudit — por personaje**',
    `Temporada WoWAudit ${seasonId}; [${new Date(start).toISOString()}, ${new Date(end).toISOString()}) UTC.`,
    `Roster actual en seguimiento: ${(config.ranks || DEFAULT_LOOT_RANKS).map(safe).join(', ')} · ${ranking.size} personajes · ${ranking.total} objetos.`,
    `Filtros: Mythic · categorías: ${config.categories.map(safe).join(', ')}.`,
    section('**5 con más loot**', ranking.most), section('**5 con menos loot**', ranking.least),
    `Empates: mismo puesto, orden por nombre/reino; máximo 5 por lista. Alts sin agrupar. Fuera del roster: ${ranking.outsideRoster} registros.`,
    'Solo adjudicaciones registradas, no descartadas (incluye respuestas excluidas). Cero significa sin registros válidos en este período; no acredita cobertura completa.'
  ].join('\n');
  requireSchema(content.length <= 2000, 'el informe supera el límite de Discord');
  return content;
}

export function weeklySlot(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', weekday:'short', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hourCycle:'h23' }).formatToParts(now).map(p => [p.type,p.value]));
  return p.weekday === 'Wed' && p.hour === '20' ? `${p.year}-${p.month}-${p.day}` : null;
}

export function weeklyCutoff(slot) {
  const noon = Date.parse(`${slot}T12:00:00Z`);
  const offsetHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/Madrid', hour:'2-digit', hourCycle:'h23' }).format(noon)) - 12;
  return Date.parse(`${slot}T20:00:00Z`) - offsetHour * 3600000;
}
