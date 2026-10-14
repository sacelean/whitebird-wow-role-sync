import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBisList, formatBisProposal } from '../src/bis-lists.js';

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
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].itemName, 'Crown of Testing');
  assert.equal(list.items[0].sourceName, 'The Example Boss');
  assert.deepEqual(list.sourceIds, ['method']);
  assert.match(formatBisProposal(list, 'Main').fields[0].value, /The Example Boss/);
});

test('no recorta silenciosamente objetos para que quepan en un embed', async () => {
  const crowded = await buildBisList({ className: 'Priest', specId: 'holy', activity: 'raid' }, fakeFetch);
  crowded.items = Array.from({ length: 28 }, (_, index) => ({ ...crowded.items[0], rank: index + 1, itemId: 101 + index }));
  assert.throws(() => formatBisProposal(crowded, 'Main'), /supera los límites de Discord/);
});
