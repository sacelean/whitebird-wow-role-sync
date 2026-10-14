const DATA_BASE = 'https://data.blingtron.app';
const ACTIVITIES = new Set(['overall', 'raid', 'mythic_plus']);
const SLOT_LABELS = {
  head: 'Cabeza', neck: 'Cuello', shoulders: 'Hombros', back: 'Espalda', chest: 'Pecho',
  wrist: 'Muñecas', hands: 'Manos', waist: 'Cintura', legs: 'Piernas', feet: 'Pies',
  finger: 'Anillos', main_hand: 'Mano principal', off_hand: 'Mano secundaria',
  two_hand: 'Arma a dos manos', ranged: 'A distancia'
};

export class BisListError extends Error {}

const key = (value) => String(value || '').normalize('NFC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '');
const validId = (value) => Number.isSafeInteger(value) && value > 0;

async function getJson(path, fetcher) {
  let response;
  try {
    response = await fetcher(`${DATA_BASE}${path}`, {
      headers: {
        Accept: 'application/json',
        Origin: 'https://blingtron.app',
        Referer: 'https://blingtron.app/',
        'User-Agent': 'Mozilla/5.0 (compatible; WhitebirdWoWRoleSync/1.0)'
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error'
    });
  } catch {
    throw new BisListError('Blingtron: no se pudo consultar su catálogo (conexión o timeout).');
  }
  if (!response.ok) throw new BisListError(`Blingtron: HTTP ${response.status} al consultar su catálogo.`);
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    throw new BisListError('Blingtron: el catálogo devolvió un formato inesperado.');
  }
  try { return await response.json(); } catch { throw new BisListError('Blingtron: respuesta JSON no válida.'); }
}

export async function fetchBlingClasses(fetcher = fetch) {
  const classes = await getJson('/wow/classes.json', fetcher);
  if (!Array.isArray(classes) || !classes.length) throw new BisListError('Blingtron: no hay clases disponibles en el catálogo.');
  for (const entry of classes) {
    if (typeof entry?.id !== 'string' || typeof entry?.name !== 'string' || !Array.isArray(entry.specs)) {
      throw new BisListError('Blingtron: esquema de clases incompatible.');
    }
    for (const spec of entry.specs) {
      if (typeof spec?.id !== 'string' || typeof spec?.name !== 'string') throw new BisListError('Blingtron: esquema de especializaciones incompatible.');
    }
  }
  return classes;
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

function validateEntry(entry) {
  return entry && validId(entry.item_id) && Number.isFinite(Number(entry.score ?? entry.recommendation_pct ?? 0));
}

export async function buildBisList({ className, specId, activity = 'overall' }, fetcher = fetch) {
  if (!ACTIVITIES.has(activity)) throw new BisListError('Actividad BIS no válida.');
  const classes = await fetchBlingClasses(fetcher);
  const classEntry = classes.find((entry) => key(entry.name) === key(className) || key(entry.id) === key(className));
  if (!classEntry) throw new BisListError(`Blingtron no tiene datos para la clase ${className}.`);
  const specEntry = classEntry.specs.find((entry) => key(entry.id) === key(specId) || key(entry.name) === key(specId));
  if (!specEntry) throw new BisListError(`La especialización ${specId} no corresponde a ${classEntry.name}.`);

  const report = await getJson(`/gear/bis/${classEntry.id}/${specEntry.id}/${activity}.json`, fetcher);
  if (report?.class !== classEntry.id || report?.spec !== specEntry.id || report?.activity !== activity || !report?.slots || typeof report.slots !== 'object') {
    throw new BisListError('Blingtron: respuesta BIS incompatible con la clase, especialización o actividad solicitada.');
  }
  const sourceIds = Array.isArray(report.sources) ? [...new Set(report.sources.filter((source) => typeof source === 'string'))] : [];
  if (!sourceIds.length) throw new BisListError('Blingtron no publica fuentes BIS para esta combinación.');

  const sourceReports = await Promise.all(sourceIds.map(async (source) => {
    try { return await getJson(`/gear/bis/${classEntry.id}/${specEntry.id}/source/${encodeURIComponent(source)}/${activity}.json`, fetcher); }
    catch { return null; }
  }));
  const metadata = sourceReports.filter(Boolean);
  const sourceNames = Object.fromEntries(metadata.map((source) => [source.source, source.source_url || source.source]));

  const groups = Object.entries(report.slots).map(([slot, items]) => ({ slot, items }))
    .filter((group) => Array.isArray(group.items) && group.items.length);
  if (Array.isArray(report.trinkets) && report.trinkets.length) groups.push({ slot: 'trinket', items: report.trinkets });
  if (!groups.length || groups.some(({ items }) => items.some((item) => !validateEntry(item)))) {
    throw new BisListError('Blingtron: la lista no contiene objetos válidos.');
  }

  const ids = [...new Set(groups.flatMap(({ items }) => items.map((item) => item.item_id)))];
  const itemData = new Map();
  await mapConcurrent(ids, 5, async (id) => {
    const item = await getJson(`/gear/item/${id}.json`, fetcher);
    if (item?.id !== id || typeof item.name !== 'string' || !item.name) throw new BisListError(`Blingtron: faltan datos del objeto ${id}.`);
    itemData.set(id, item);
  });

  const locationCache = new Map();
  async function resolveSource(source, depth = 0) {
    if (!source || typeof source.type !== 'string' || !validId(source.id) || depth > 4) return 'Fuente no indicada por Blingtron';
    const cacheKey = `${source.type}:${source.id}`;
    if (locationCache.has(cacheKey)) return locationCache.get(cacheKey);
    let value;
    if (source.type === 'raid') {
      const location = await getJson(`/gear/source/raid/encounter/${source.id}.json`, fetcher);
      value = typeof location?.name === 'string' && location.name ? location.name : 'Jefe de raid sin nombre';
    } else if (source.type === 'mythic_plus') {
      const location = await getJson(`/gear/source/mythic_plus/${source.id}.json`, fetcher);
      value = typeof location?.name === 'string' && location.name ? location.name : 'Mazmorra sin nombre';
    } else if (source.type === 'item') {
      const sourceItem = await getJson(`/gear/item/${source.id}.json`, fetcher);
      if (typeof sourceItem?.name !== 'string') value = 'Objeto de origen desconocido';
      else {
        const nested = await resolveSource(sourceItem.source, depth + 1);
        value = nested === 'Fuente no indicada por Blingtron' ? sourceItem.name : `${sourceItem.name} · ${nested}`;
      }
    } else value = 'Fuente no indicada por Blingtron';
    locationCache.set(cacheKey, value);
    return value;
  }

  const items = [];
  for (const { slot, items: entries } of groups) {
    for (let rank = 0; rank < entries.length; rank++) {
      const entry = entries[rank];
      const details = itemData.get(entry.item_id);
      const source = details.source ?? entry.source ?? null;
      items.push({
        slot,
        slotName: slot === 'trinket' ? 'Abalorios' : SLOT_LABELS[slot] || slot.replace(/_/g, ' '),
        rank: rank + 1,
        itemId: entry.item_id,
        itemName: details.name,
        score: Number(entry.score ?? entry.recommendation_pct ?? 0),
        sourceType: source?.type || null,
        sourceId: source?.id || null,
        sourceName: await resolveSource(source),
        wowheadUrl: `https://www.wowhead.com/item=${entry.item_id}`
      });
    }
  }

  const sourceUrls = metadata.filter((source) => typeof source.source_url === 'string').map((source) => ({ name: source.source, url: source.source_url, fetchedAt: source.fetched_at || null }));
  const activityNames = { overall: 'General', raid: 'Raid', mythic_plus: 'M+' };
  return {
    classId: classEntry.id,
    className: classEntry.name,
    specId: specEntry.id,
    specName: specEntry.name,
    activity,
    activityName: activityNames[activity],
    sourceIds,
    sourceNames,
    sourceUrls,
    fetchedAt: sourceUrls.map((source) => source.fetchedAt).filter(Boolean).sort().at(-1) || null,
    pageUrl: `https://blingtron.app/gearing/${classEntry.id}/${specEntry.id}`,
    items
  };
}

export function formatBisProposal(bisList, raiderName) {
  const bySlot = new Map();
  for (const item of bisList.items) {
    const current = bySlot.get(item.slotName) || [];
    const extraSource = bisList.sourceIds.length > 1 ? ` · ${bisList.sourceIds.map((source) => source.toUpperCase()).join('/')}` : '';
    const manual = item.sourceType === 'manual' ? ' · elegido por el raider' : '';
    current.push(`**${item.rank}. [${item.itemName}](${item.wowheadUrl})** — ${item.sourceName}${manual}${extraSource}`);
    bySlot.set(item.slotName, current);
  }
  const embed = {
    title: `BIS ${bisList.specName} · ${bisList.activityName}`,
    url: bisList.pageUrl,
    description: `Lista propuesta para **${raiderName}**. Revisa los objetos y su procedencia y pulsa **Aceptar** o **Rechazar**.\nFuentes de guía: ${bisList.sourceIds.join(', ')}.${bisList.fetchedAt ? ` Datos actualizados: ${bisList.fetchedAt}.` : ''}`,
    color: 0x4d8fe8,
    fields: [...bySlot.entries()].map(([name, values]) => ({ name, value: values.join('\n'), inline: true })),
    footer: { text: 'Datos de Blingtron; las sustituciones manuales se indican. No es una simulación personalizada.' }
  };
  const total = embed.title.length + embed.description.length + embed.footer.text.length + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  if (embed.fields.length > 25 || embed.description.length > 4096 || total > 6000 || embed.fields.some((field) => field.value.length > 1024)) {
    throw new BisListError('La lista supera los límites de Discord; no se ha publicado ninguna propuesta.');
  }
  return embed;
}
