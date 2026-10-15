// Contract: https://wowaudit.com/api (official embedded Swagger, verified 2026-10-13).
const key = (s) => s.normalize('NFC').toLowerCase().replace(/[\s’']/g, '').replace(/-/g, '');
const identity = (name, realm) => `${key(name)}:${key(realm)}`;
export const DEFAULT_LOOT_RANKS = ['Oficiales', 'Fijo', 'Rotativo', 'Trial'];
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
  if (!env.WOWAUDIT_API_KEY?.trim()) return null;
  const days = env.WOWAUDIT_LOOT_WINDOW_DAYS ? Number(env.WOWAUDIT_LOOT_WINDOW_DAYS) : null;
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3660)) throw new WoWAuditError('WOWAUDIT_LOOT_WINDOW_DAYS debe estar entre 1 y 3660.');
  const categories = (env.WOWAUDIT_LOOT_CATEGORIES || DEFAULT_LOOT_CATEGORIES.join(',')).split(',').map(s => s.trim());
  if (categories.some(s => !s || s.length > 100)) throw new WoWAuditError('WOWAUDIT_LOOT_CATEGORIES no válido.');
  const ranks = (env.WOWAUDIT_LOOT_RANKS || DEFAULT_LOOT_RANKS.join(',')).split(',').map(s => s.trim());
  if (ranks.length > 10 || ranks.some(s => !s || s.length > 100)) throw new WoWAuditError('WOWAUDIT_LOOT_RANKS no válido.');
  return { apiKey: env.WOWAUDIT_API_KEY.trim(), days, categories, ranks };

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
    return [c.id, { ...c, count: 0, categoryCounts: Object.fromEntries(categories.map(name => [name, 0])), userId: matches.length === 1 ? matches[0].user_id : null }];
  }));
  requireSchema(rows.size > 0, 'no hay personajes con los rangos configurados y status tracking en el roster; revisa WOWAUDIT_LOOT_RANKS');
  const ids = new Map(), imports = new Map();
  let outsideRoster = 0;
  for (const item of history) {
    requireSchema(positiveId(item.id) && positiveId(item.character_id) && positiveId(item.item_id) && typeof item.discarded === 'boolean' && typeof item.awarded_at === 'string' && Number.isFinite(Date.parse(item.awarded_at)));
    requireSchema(typeof item.difficulty === 'string' && (item.response_type === null || typeof item.response_type?.name === 'string'));
    // The website counts merged categories, not the original RCLootCouncil button.
    const response = item.response_type?.propagated_to ?? item.response_type;
    requireSchema(response === null || typeof response?.name === 'string', 'categoría fusionada sin nombre válido');
    const signature = JSON.stringify([item.character_id, item.item_id, item.awarded_at, item.discarded, item.difficulty, item.response_type?.name, response?.name]);
    if (ids.has(item.id)) { requireSchema(ids.get(item.id) === signature); continue; }
    ids.set(item.id, signature);
    if (item.rclootcouncil_id) {
      requireSchema(typeof item.rclootcouncil_id === 'string');
      if (imports.has(item.rclootcouncil_id)) { requireSchema(imports.get(item.rclootcouncil_id) === signature); continue; }
      imports.set(item.rclootcouncil_id, signature);
    }
    const time = Date.parse(item.awarded_at);
    if (item.discarded || time < start || time >= end || item.difficulty.toLowerCase() !== 'mythic' ||
        !response || !categories.some(c => categoryKey(c) === categoryKey(response.name))) continue;
    if (rows.has(item.character_id)) {
      const row = rows.get(item.character_id);
      row.count++;
      const matchedCategory = categories.find(name => categoryKey(name) === categoryKey(response.name));
      row.categoryCounts[matchedCategory]++;
    } else outsideRoster++;
  }
  const compare = (a,b) => identity(a.name,a.realm).localeCompare(identity(b.name,b.realm), 'en') || a.id-b.id;
  const rowsSorted = [...rows.values()].sort((a,b) => b.count-a.count || compare(a,b));
  let position = 1;
  const all = rowsSorted.map((r,i) => {
    if (i && rowsSorted[i-1].count !== r.count) position = i+1;
    return { ...r, position };
  });
  return { all, size: rows.size, total: all.reduce((n,r)=>n+r.count,0), outsideRoster };

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
  const summary = [
    `Temporada WoWAudit ${seasonId}; [${new Date(start).toISOString()}, ${new Date(end).toISOString()}) UTC.`,
    `Roster en seguimiento: ${(config.ranks || DEFAULT_LOOT_RANKS).map(safe).join(', ')} · ${ranking.size} personajes · **${ranking.total} objetos**.`,
    `Mythic · categorías: ${config.categories.map(safe).join(', ')}.`
  ].join('\n');
  const list = ranking.all.map((row, index) =>
    `${index + 1}. **${safe(row.name)}** · ${safe(row.realm)}${row.userId ? ` (<@${row.userId}>)` : ''} — **${row.count}**`
  ).join('\n');
  const description = `${summary}\n\n${list}`;
  const embed = {
    title: 'Loot Mythic — roster completo', color: 0x38b66b, description,
    footer: { text: `Orden: loot recibido descendente; empates por nombre/reino. Por personaje, sin agrupar alts. Fuera del roster: ${ranking.outsideRoster}. Solo loot registrado y no descartado; cero no acredita cobertura completa.` }
  };
  const length = embed.title.length + description.length + embed.footer.text.length;
  requireSchema(description.length <= 4096 && length <= 6000, 'el roster completo supera el límite de un mensaje Discord');
  return { embeds: [embed], allowedMentions: { parse: [] } };

}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

function formatKeyVault(dungeons) {
  requireSchema(Array.isArray(dungeons), 'actividad semanal sin dungeons_done');
  const levels = dungeons.map(run => {
    requireSchema(Number.isInteger(run?.level) && run.level >= 0, 'dungeon sin nivel válido');
    return run.level;
  }).sort((a, b) => b - a);
  return [levels[0] || 0, levels[3] || 0, levels[7] || 0].join('/');
}

function formatRaidVault(raids) {
  requireSchema(raids && typeof raids === 'object' && !Array.isArray(raids), 'actividad semanal sin vault_options.raids');
  return [1, 2, 3].map(n => {
    const level = raids[`option_${n}`];
    requireSchema(level === null || (Number.isInteger(level) && level >= 0), 'recompensa de raid sin nivel válido');
    return level === null ? '-' : String(level);
  }).join('/');
}

export async function fetchRaiderTableReport(config, links, end = Date.now(), fetcher = fetch) {
  const period = await auditGet('/v1/period', config.apiKey, fetcher);
  const season = period?.current_season;
  const seasonId = season?.keystone_season_id ?? season?.id;
  requireSchema(positiveId(seasonId) && positiveId(period?.current_period) && typeof season?.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(season.start_date), '/v1/period sin temporada, período o fecha de inicio válidos');

  const seasonStart = Date.parse(`${season.start_date}T00:00:00Z`);
  requireSchema(Number.isFinite(seasonStart) && seasonStart < end);
  const start = Math.max(seasonStart, config.days ? end - config.days * 86400000 : seasonStart);
  const startDate = new Date(start).toISOString().slice(0, 10);
  const historicalPath = `/v1/historical_data?period=${encodeURIComponent(period.current_period)}`;
  const [roster, weekly, loot] = await Promise.all([
    auditGet('/v1/characters', config.apiKey, fetcher),
    auditGet(historicalPath, config.apiKey, fetcher),
    auditGet(`/v1/loot_history/${seasonId}`, config.apiKey, fetcher)
  ]);
  requireSchema(Array.isArray(weekly?.characters), '/v1/historical_data sin characters');

  const ranking = buildLootRanking(roster, loot?.history_items, links, {
    start, end, categories: config.categories, ranks: config.ranks
  });
  const selected = ranking.all;
  const weeklyById = new Map();
  for (const character of weekly.characters) {
    requireSchema(positiveId(character.id));
    requireSchema(!weeklyById.has(character.id), '/v1/historical_data contiene personajes duplicados');
    weeklyById.set(character.id, character.data);
  }
  const details = await mapConcurrent(selected, 4, async character => {
    const detail = await auditGet(`/api/characters/${character.id}`, config.apiKey, fetcher);
    requireSchema(detail?.id === character.id, `perfil incompatible para ${character.name}`);
    const profile = detail.details;
    return [character.id, Number.isFinite(profile?.currentItemLevel) && profile.currentItemLevel > 0 ? profile.currentItemLevel : null];
  });
  const gearById = new Map(details);
  const name = value => String(value).replace(/[|`\r\n]/g, ' ').trim().slice(0, 12);
  const rows = selected.map(character => {
    const data = weeklyById.get(character.id);
    const vault = data?.vault_options;
    const profile = gearById.get(character.id);
    return {
      character,
      gear: profile ?? null,
      keys: data ? formatKeyVault(data.dungeons_done) : '—/—/—',
      raidVault: data ? formatRaidVault(vault?.raids) : '-/-/-',
      loot: character.count,
      safeName: name(character.name)
    };
  }).sort((a, b) => (b.gear ?? -1) - (a.gear ?? -1) || identity(a.character.name, a.character.realm).localeCompare(identity(b.character.name, b.character.realm), 'en'));

  const number = value => value === null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(1);
  const nameWidth = Math.max(4, ...rows.map(row => row.safeName.length));
  const widths = {
    keys: Math.max(4, ...rows.map(row => row.keys.length)),
    raid: Math.max(4, ...rows.map(row => row.raidVault.length)),
    loot: Math.max(4, ...rows.map(row => String(row.loot).length))
  };
  const columns = [
    '#', 'Nombre'.padEnd(nameWidth), 'Loot'.padStart(widths.loot), 'Keys'.padEnd(widths.keys),
    'Raid'.padEnd(widths.raid), 'iLvl'.padStart(5)
  ];
  const header = `${columns[0].padStart(2)} ${columns.slice(1).join(' ')}`;
  const body = rows.map((row, index) => [
    String(index + 1).padStart(2), row.safeName.padEnd(nameWidth), String(row.loot).padStart(widths.loot),
    row.keys.padEnd(widths.keys), row.raidVault.padEnd(widths.raid), number(row.gear).padStart(5)
  ].join(' ')).join('\n');
  const divider = '─'.repeat(header.length);
  const rosterSummary = `Roster en seguimiento: ${config.ranks.join(', ')} · ${ranking.size} personajes · **${ranking.total} objetos**.`;
  const filtersSummary = `Mythic · categorías: ${config.categories.join(', ')}.`;
  const content = [
    `**Raiders · ${new Date(end).toISOString().slice(0, 10)} · p${period.current_period}**`,
    rosterSummary,
    filtersSummary,
    `Loot total · Keys/Raid vault · iLvl actual.`,
    `\`\`\`text\n${header}\n${divider}\n${body}\n\`\`\``,
    `Período de loot: desde ${startDate} · alts por separado · — = sin datos.`
  ].join('\n');
  let messageContent = content;
  if (messageContent.length > 2000) {
    const compactHeader = `# ${'Nombre'.padEnd(nameWidth)} Loot Keys Raid iLvl`;
    const compactBody = rows.map((row, index) => `${String(index + 1).padStart(2)} ${row.safeName.padEnd(nameWidth)} ${row.loot} ${row.keys} ${row.raidVault} ${number(row.gear)}`).join('\n');
    messageContent = [
      `**Raiders · ${new Date(end).toISOString().slice(0, 10)} · p${period.current_period}**`,
      rosterSummary,
      filtersSummary,
      `Loot total · Keys/Raid vault · iLvl actual.`,
      `\`\`\`text\n${compactHeader}\n${compactBody}\n\`\`\``,
      `Período desde ${startDate} · alts separados · — = sin datos.`
    ].join('\n');
  }
  requireSchema(messageContent.length <= 2000, 'la tabla completa supera el límite de 2000 caracteres de un mensaje Discord');
  return { content: messageContent, allowedMentions: { parse: [] } };
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
