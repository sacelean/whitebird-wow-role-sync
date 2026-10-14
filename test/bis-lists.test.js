import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBisList, buildMethodBisList, formatBisProposal } from '../src/bis-lists.js';

const payloads = {
  '/wow/classes.json': [{ id: 'priest', name: 'Priest', specs: [{ id: 'holy', name: 'Holy' }] }],
  '/gear/bis/priest/holy/raid.json': {
    class: 'priest', spec: 'holy', activity: 'raid', sources: ['method'],
    slots: { head: [{ item_id: 101, score: 100, source: { type: 'raid', id: 201 } }] }, trinkets: []
  },
  '/gear/bis/priest/holy/source/method/raid.json': {
    source: 'method', source_url: 'https://method.gg', fetched_at: '2026-10-14T00:00:00Z'
  },
  '/gear/item/101.json': { id: 101, name: 'Crown of Testing', source: { type: 'raid', id: 201 } },
  '/gear/source/raid/encounter/201.json': { id: 201, name: 'The Example Boss' }
};

function fakeFetch(url) {
  const path = new URL(url).pathname;
  if (!(path in payloads)) return Promise.resolve(new Response('', { status: 404 }));
  return Promise.resolve(new Response(JSON.stringify(payloads[path]), {
    status: 200, headers: { 'content-type': 'application/json' }
  }));
}

test('resuelve objetos BIS y su procedencia desde los datos publicados por Blingtron', async () => {
  const list = await buildBisList({ className: 'Priest', specId: 'holy', activity: 'raid' }, fakeFetch);
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].itemName, 'Crown of Testing');
  assert.equal(list.items[0].sourceName, 'The Example Boss');
  const finger = list.items.find((item) => item.slot === 'finger');
  assert.equal(finger.slotName, 'Dedo');
  assert.equal(finger.itemId, 0);
  assert.match(formatBisProposal(list, 'Main').fields.find((field) => field.name === 'Dedo').value, /Blingtron no publica/);
  assert.deepEqual(list.sourceIds, ['method']);
  assert.match(formatBisProposal(list, 'Main').fields[0].value, /The Example Boss/);
});

test('no recorta silenciosamente objetos para que quepan en un embed', async () => {
  const crowded = await buildBisList({ className: 'Priest', specId: 'holy', activity: 'raid' }, fakeFetch);
  crowded.items = Array.from({ length: 28 }, (_, index) => ({ ...crowded.items[0], rank: index + 1, itemId: 101 + index }));
  assert.throws(() => formatBisProposal(crowded, 'Main'), /supera los límites de Discord/);
});

test('muestra solo los cuatro abalorios mejor clasificados por Blingtron', async () => {
  const trinketEntries = Array.from({ length: 6 }, (_, index) => ({ item_id: 301 + index, score: index + 1 }));
  const fetcher = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/gear/bis/priest/holy/raid.json') {
      return new Response(JSON.stringify({ ...payloads[path], trinkets: trinketEntries }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
    const itemMatch = path.match(/^\/gear\/item\/(\d+)\.json$/);
    if (itemMatch && Number(itemMatch[1]) >= 301) {
      const id = Number(itemMatch[1]);
      return new Response(JSON.stringify({ id, name: `Trinket ${id}`, source: null }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
    return fakeFetch(url);
  };
  const list = await buildBisList({ className: 'Priest', specId: 'holy', activity: 'raid' }, fetcher);
  const trinkets = list.items.filter((item) => item.slot === 'trinket');
  assert.equal(trinkets.length, 4);
  assert.deepEqual(trinkets.map((item) => item.itemId), [306, 305, 304, 303]);
  assert.deepEqual(trinkets.map((item) => item.rank), [1, 2, 3, 4]);
});

const methodRows = [
  ['Head', 1001, 'Ula\'tek'], ['Neck', 1002, 'Ula\'tek'], ['Shoulders', 1003, 'Raid Token'],
  ['Cloak', 1004, 'Dungeon Boss'], ['Chest', 1005, 'Catalyst'], ['Wrist', 1006, 'Crafted'],
  ['Gloves', 1007, 'Raid Boss'], ['Belt', 1008, 'Crafted'], ['Legs', 1009, 'Catalyst'],
  ['Boots', 1010, 'Dungeon Boss'], ['Ring 1', 1011, 'Murder Row'], ['Ring 2', 1012, 'Sszorak'],
  ['Trinket 1', 1013, 'Nek\'zali'], ['Trinket 2', 1014, 'Lost Explorers'],
  ['Main Hand', 1015, 'Ula\'tek'], ['Off Hand', 1016, 'Crafted']
];

function methodHtml(rows = methodRows, includeTrinketRankings = false) {
  const tableRows = rows.map(([slot, id, source]) => `<tr><td>${slot}</td><td><a href="https://www.wowhead.com/ptr/item=${id}/test">Item ${id}</a></td><td>${source}</td></tr>`).join('');
  const trinkets = includeTrinketRankings
    ? `<div class="guide-section-title" id="trinkets"><h2>Trinkets</h2></div><h3>Trinkets for Raid</h3><h4>S Tier (Best)</h4><ul><li><a href="https://www.wowhead.com/item=401">Rank 1</a>: First</li><li><a href="https://www.wowhead.com/item=402">Rank 2</a>: Second</li></ul><h4>A Tier</h4><ul><li><a href="https://www.wowhead.com/item=403">Rank 3</a>: Third</li><li><a href="https://www.wowhead.com/item=404">Rank 4</a>: Fourth</li><li><a href="https://www.wowhead.com/item=405">Rank 5</a>: Fifth</li></ul>`
    : '';
  return `<html><body><h1>Holy Priest Guide</h1><span class="guide-author">Patch 12.1.5</span><div id="overall_table"><table><tbody><tr><td><b>Slot</b></td><td><b>Item</b></td><td><b>Source</b></td></tr>${tableRows}</tbody></table></div><div id="raid_table"><table>${tableRows}</table></div><div id="dungeon_table"><table>${tableRows}</table></div>${trinkets}<div class="guide-section-title" id="embellishments"><h2>Embellishments</h2></div></body></html>`;
}

test('extrae la tabla de Method y conserva ranuras dobles, procedencia y parche', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return new Response(methodHtml(), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const list = await buildMethodBisList({ classId: 'priest', className: 'Priest', specId: 'holy', specName: 'Holy', activity: 'overall' }, fetcher);
  assert.deepEqual(calls, ['https://www.method.gg/guides/holy-priest/gearing']);
  assert.equal(list.items.length, 16);
  assert.equal(list.items.find((item) => item.slot === 'finger_2').itemId, 1012);
  assert.equal(list.items.find((item) => item.slot === 'trinket_1').sourceName, "Nek'zali");
  assert.equal(list.patch, '12.1.5');
  assert.match(formatBisProposal(list, 'Main').description, /Fuente: \*\*Method\*\*/);
  assert.match(formatBisProposal(list, 'Main').footer.text, /extraídos de Method/);
});

test('Method reemplaza los dos abalorios BIS por sus cuatro mejores recomendaciones', async () => {
  const fetcher = async () => new Response(methodHtml(methodRows, true), {
    status: 200, headers: { 'content-type': 'text/html' }
  });
  const list = await buildMethodBisList({ className: 'Priest', specName: 'Holy', activity: 'raid' }, fetcher);
  const trinkets = list.items.filter((item) => item.slot === 'trinket');
  assert.equal(trinkets.length, 4);
  assert.deepEqual(trinkets.map((item) => item.itemId), [401, 402, 403, 404]);
  assert.match(trinkets[0].sourceName, /^S Tier/);
  assert.match(trinkets[2].sourceName, /^A Tier/);
  assert.equal(list.items.some((item) => item.slot === 'trinket_1' || item.slot === 'trinket_2'), false);
});

test('Method cancela una lista parcial o con una ranura que no reconoce', async () => {
  const fetcher = async () => new Response(methodHtml(methodRows.slice(0, 4)), {
    status: 200, headers: { 'content-type': 'text/html' }
  });
  await assert.rejects(
    buildMethodBisList({ className: 'Priest', specName: 'Holy' }, fetcher),
    /solo contiene 4 objetos reconocibles/
  );
});
