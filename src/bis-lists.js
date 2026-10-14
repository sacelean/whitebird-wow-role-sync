import { load } from 'cheerio';

const DATA_BASE = 'https://data.blingtron.app';
const ACTIVITIES = new Set(['overall', 'raid', 'mythic_plus']);
const MAX_TRINKET_RECOMMENDATIONS = 4;
const SLOT_LABELS = {
  head: 'Cabeza', neck: 'Cuello', shoulders: 'Hombros', back: 'Espalda', chest: 'Pecho',
  wrist: 'Muñecas', hands: 'Manos', waist: 'Cintura', legs: 'Piernas', feet: 'Pies',
  finger: 'Dedo', main_hand: 'Mano principal', off_hand: 'Mano secundaria',
  two_hand: 'Arma a dos manos', ranged: 'A distancia'
};

export class BisListError extends Error {}

const key = (value) => String(value || '').normalize('NFC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '');
const validId = (value) => Number.isSafeInteger(value) && value > 0;

function slugPart(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const METHOD_ACTIVITY = { overall: 'overall_table', raid: 'raid_table', mythic_plus: 'dungeon_table' };
const METHOD_SLOTS = {
  head: ['head', 'Cabeza'], neck: ['neck', 'Cuello'], shoulders: ['shoulders', 'Hombros'],
  back: ['back', 'Espalda'], cloak: ['back', 'Espalda'], chest: ['chest', 'Pecho'],
  wrist: ['wrist', 'Muñecas'], bracers: ['wrist', 'Muñecas'], hands: ['hands', 'Manos'], gloves: ['hands', 'Manos'],
  waist: ['waist', 'Cintura'], belt: ['waist', 'Cintura'], legs: ['legs', 'Piernas'], feet: ['feet', 'Pies'], boots: ['feet', 'Pies'],
  'ring 1': ['finger_1', 'Dedo 1'], 'ring 2': ['finger_2', 'Dedo 2'], 'finger 1': ['finger_1', 'Dedo 1'], 'finger 2': ['finger_2', 'Dedo 2'],
  'trinket 1': ['trinket_1', 'Abalorio 1'], 'trinket 2': ['trinket_2', 'Abalorio 2'],
  'main hand': ['main_hand', 'Mano principal'], 'off hand': ['off_hand', 'Mano secundaria'],
  'two-hand': ['two_hand', 'Arma a dos manos'], 'two handed': ['two_hand', 'Arma a dos manos']
};

function cleanText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }

function methodItemId($, itemCell) {
  const node = $(itemCell);
  const href = (node.is('a[href]') ? node : node.find('a[href]').first()).attr('href') || '';
  if (!href) return null;
  let url;
  try { url = new URL(href, 'https://www.method.gg'); } catch { return null; }
  if (!/(^|\.)wowhead\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/\/item=(\d+)/i) || url.search.match(/[?&]item=(\d+)/i);
  return match ? Number(match[1]) : null;
}

function methodTrinketRankings($, activity) {
  const heading = $('#trinkets').closest('.guide-section-title');
  if (!heading.length) return [];
  const contexts = [];
  let current = null;
  let tier = '';
  heading.nextUntil('.guide-section-title').each((_, element) => {
    const node = $(element);
    if (node.is('h3')) {
      current = { name: cleanText(node.text()), entries: [] };
      contexts.push(current);
      tier = '';
    } else if (node.is('h4')) {
      tier = cleanText(node.text());
    } else if (node.is('ul') && current) {
      node.children('li').each((__, listItem) => {
        const itemId = methodItemId($, listItem);
        if (!validId(itemId)) return;
        const itemAnchor = $(listItem).find('a[href]').toArray().find((anchor) => methodItemId($, anchor) === itemId);
        if (!itemAnchor) return;
        const itemName = cleanText($(itemAnchor).text());
        const details = cleanText($(listItem).text()).replace(itemName, '').replace(/^\s*[:–—-]\s*/, '');
        current.entries.push({ itemId, itemName, tier: tier || 'Recomendado', details });
      });
    }
  });

  const normalized = (value) => value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
  const context = activity === 'mythic_plus'
    ? contexts.find((entry) => /mythic\s*\+|m\+/.test(normalized(entry.name)))
    : activity === 'raid'
      ? contexts.find((entry) => /raid|raiding/.test(normalized(entry.name)))
      : contexts.find((entry) => /overall|all content|all sources/.test(normalized(entry.name))) ||
        contexts.find((entry) => /raid|raiding/.test(normalized(entry.name)));
  return context?.entries.slice(0, MAX_TRINKET_RECOMMENDATIONS) || [];
}

async function fetchMethodPage(url, fetcher) {
  let response;
  try {
    response = await fetcher(url, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; WhitebirdWoWRoleSync/1.0; +https://github.com/sacelean/whitebird-wow-role-sync)'
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error'
    });
  } catch {
    throw new BisListError('Method: no se pudo consultar la guía (conexión o timeout).');
  }
  if (!response.ok) throw new BisListError(`Method: HTTP ${response.status} al consultar la guía de esta especialización.`);
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType && !contentType.toLowerCase().includes('text/html')) throw new BisListError('Method: la guía devolvió un formato inesperado.');
  try { return await response.text(); } catch { throw new BisListError('Method: no se pudo leer el contenido de la guía.'); }
}

export async function buildMethodBisList({ classId, className, specId, specName, activity = 'overall' }, fetcher = fetch) {
  const tableId = METHOD_ACTIVITY[activity];
  if (!tableId) throw new BisListError('Actividad BIS no válida.');
  const slug = `${slugPart(specName)}-${slugPart(className)}`;
  if (!slug || slug.startsWith('-') || slug.endsWith('-')) throw new BisListError('Method: no se pudo construir la URL de la especialización.');
  const pageUrl = `https://www.method.gg/guides/${slug}/gearing`;
  const html = await fetchMethodPage(pageUrl, fetcher);
  const $ = load(html);
  const tab = $(`#${tableId}`);
  const table = tab.find('table').first();
  if (!tab.length || !table.length) throw new BisListError(`Method: la guía no contiene una tabla ${activity === 'overall' ? 'General' : activity === 'raid' ? 'Raid' : 'Mítico+'} reconocible; no se guardó ninguna lista.`);

  const items = [];
  const seenSlots = new Set();
  table.find('tr').each((_, row) => {
    const cells = $(row).children('td');
    if (cells.length < 3) return;
    const slotText = cleanText($(cells[0]).text()).toLocaleLowerCase('en-US');
    const itemName = cleanText($(cells[1]).text());
    const sourceName = cleanText($(cells[2]).text());
    if (slotText === 'slot' && itemName.toLocaleLowerCase('en-US') === 'item') return;
    const slotInfo = METHOD_SLOTS[slotText];
    if (!slotInfo || !itemName || !sourceName) throw new BisListError(`Method: fila de equipo incompleta o ranura desconocida («${slotText || 'vacía'}»); no se guardó ninguna lista.`);
    const itemId = methodItemId($, cells[1]);
    if (!validId(itemId)) throw new BisListError(`Method: no se pudo identificar el ID de Wowhead para «${itemName}»; no se guardó ninguna lista.`);
    if (seenSlots.has(slotInfo[0])) throw new BisListError(`Method: la guía repite la ranura «${slotInfo[1]}» de forma inesperada; no se guardó ninguna lista.`);
    seenSlots.add(slotInfo[0]);
    items.push({
      slot: slotInfo[0], slotName: slotInfo[1], rank: 1, itemId,
      itemName, score: 0, sourceType: 'method', sourceId: null, sourceName,
      wowheadUrl: `https://www.wowhead.com/item=${itemId}`
    });
  });

  const rankedTrinkets = methodTrinketRankings($, activity);
  if (rankedTrinkets.length >= MAX_TRINKET_RECOMMENDATIONS) {
    for (let index = items.length - 1; index >= 0; index--) {
      if (items[index].slot === 'trinket_1' || items[index].slot === 'trinket_2') items.splice(index, 1);
    }
    rankedTrinkets.forEach((item, index) => items.push({
      slot: 'trinket', slotName: 'Abalorios', rank: index + 1, itemId: item.itemId,
      itemName: item.itemName, score: MAX_TRINKET_RECOMMENDATIONS - index,
      sourceType: 'method', sourceId: null,
      sourceName: `${item.tier}${item.details ? ` · ${item.details}` : ''}`,
      wowheadUrl: `https://www.wowhead.com/item=${item.itemId}`
    }));
  }

  if (items.length < 10) throw new BisListError(`Method: la tabla solo contiene ${items.length} objetos reconocibles; se canceló para evitar guardar una lista parcial.`);
  const patchText = [
    $('.guide-author').text(),
    $('meta[name="description"]').attr('content'),
    $('meta[property="og:title"]').attr('content'),
    $('title').text()
  ].map(cleanText).find((text) => /Patch\s+[0-9]+(?:\.[0-9]+)+/i.test(text)) || '';
  const patch = patchText.match(/Patch\s+([0-9]+(?:\.[0-9]+)+)/i)?.[1] || null;
  const activityNames = { overall: 'General', raid: 'Raid', mythic_plus: 'M+' };
  const fetchedAt = new Date().toISOString();
  return {
    classId: classId || slugPart(className), className, specId: specId || slugPart(specName), specName,
    activity, activityName: activityNames[activity], sourceIds: ['Method'],
    sourceUrls: [{ name: 'Method', url: pageUrl, fetchedAt }],
    fetchedAt, patch, pageUrl, items
  };
}

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
  if (Array.isArray(report.trinkets) && report.trinkets.length) {
    const topTrinkets = report.trinkets.map((item, index) => ({ item, index }))
      .sort((a, b) => Number(b.item.score ?? b.item.recommendation_pct ?? 0) - Number(a.item.score ?? a.item.recommendation_pct ?? 0) || a.index - b.index)
      .slice(0, MAX_TRINKET_RECOMMENDATIONS)
      .map(({ item }) => item);
    groups.push({ slot: 'trinket', items: topTrinkets });
  }
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

  // The current Blingtron Priest/Holy feeds omit the finger slot entirely.
  // Keep it visible as an explicitly empty, editable slot instead of implying
  // that the bot forgot it or inventing an item recommendation.
  if (classEntry.id === 'priest' && specEntry.id === 'holy' && !items.some((item) => item.slot === 'finger')) {
    items.push({
      slot: 'finger', slotName: 'Dedo', rank: 1, itemId: 0, itemName: 'Sin objeto recomendado',
      score: 0, sourceType: 'missing', sourceId: null,
      sourceName: 'Blingtron no publica una recomendación para esta ranura.', wowheadUrl: ''
    });
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
    const itemLabel = item.sourceType === 'missing'
      ? `**${item.rank}. ${item.itemName}**`
      : `**${item.rank}. [${item.itemName}](${item.wowheadUrl})**`;
    current.push(`${itemLabel} — ${item.sourceName}${manual}${extraSource}`);
    bySlot.set(item.slotName, current);
  }
  let providerName = 'la fuente seleccionada';
  try {
    const host = new URL(bisList.pageUrl).hostname;
    if (host.endsWith('method.gg')) providerName = 'Method';
    else if (host.endsWith('blingtron.app')) providerName = 'Blingtron';
  } catch { /* Keep the generic provider label for old or incomplete snapshots. */ }
  const embed = {
    title: `BIS ${bisList.specName} · ${bisList.activityName}`,
    url: bisList.pageUrl,
    description: `Lista propuesta para **${raiderName}**. Fuente: **${providerName}** · ${bisList.sourceIds.join(', ')}. Revisa los objetos y su procedencia y pulsa **Aceptar** o **Rechazar**.${bisList.patch ? `\nParche de la guía: ${bisList.patch}.` : ''}${bisList.fetchedAt ? `\nConsultada: ${bisList.fetchedAt}.` : ''}`,
    color: 0x4d8fe8,
    fields: [...bySlot.entries()].map(([name, values]) => ({ name, value: values.join('\n'), inline: true })),
    footer: { text: `Datos extraídos de ${providerName}; las sustituciones manuales se indican. No es una simulación personalizada.` }
  };
  const total = embed.title.length + embed.description.length + embed.footer.text.length + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  if (embed.fields.length > 25 || embed.description.length > 4096 || total > 6000 || embed.fields.some((field) => field.value.length > 1024)) {
    throw new BisListError('La lista supera los límites de Discord; no se ha publicado ninguna propuesta.');
  }
  return embed;
}
