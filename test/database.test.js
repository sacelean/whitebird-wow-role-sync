import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testDirectory = mkdtempSync(join(tmpdir(), 'whitebird-wow-database-tests-'));
process.env.DATABASE_PATH = join(testDirectory, 'test.sqlite');

const {
  db,
  acceptBisProposal,
  createBisProposal,
  getBisProposal,
  getCurrentBisList,
  getLootDestination,
  setLootDestination,
  getLootPanel,
  claimLootPanel,
  saveLootPanel,
  claimLootReport,
  finishLootReport,
  hasLootReport,
  getCauldronAssignments,
  getCauldronPanel,
  getWowLinks,
  getWowSyncHistory,
  markBisProposalBuilding,
  markBisProposalAwaitingSource,
  rejectBisProposal,
  recordWowSyncChanges,
  saveBisProposalList,
  updateBisListItem,
  saveWowLink,
  seedCauldronAssignments,
  setCauldronAssignment,
  setCauldronPanel
} = await import('../src/database.js');

after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

test('la base conserva el canal Raider al actualizar el vínculo y permite cambiar de main', () => {
  saveWowLink('g1', 'u1', 'Main', 'sanguino', 'raider-channel');
  saveWowLink('g1', 'u1', 'Renombrado', 'sanguino');
  assert.deepEqual(getWowLinks('g1'), [{ user_id: 'u1', character_name: 'Renombrado', realm_slug: 'sanguino', raider_channel_id: 'raider-channel' }]);
});

test('guarda una propuesta BIS aceptada con sus objetos; rechazar otra limpia la lista activa', () => {
  const makeProposal = (id) => createBisProposal({
    id, guildId: 'bis-g', userId: 'bis-u', characterId: 'char-1', characterName: 'Main',
    realmSlug: 'sanguino', classId: 'priest', className: 'Priest', activity: 'raid', channelId: 'raider-c'
  });
  const list = {
    classId: 'priest', className: 'Priest', specId: 'holy', specName: 'Holy',
    activity: 'raid', activityName: 'Raid', sourceIds: ['method'], sourceUrls: [],
    pageUrl: 'https://blingtron.app/gearing/priest/holy', fetchedAt: null,
    items: [{ slot: 'head', slotName: 'Cabeza', rank: 1, itemId: 123, itemName: 'Test Helm', score: 100,
      sourceType: 'raid', sourceId: 456, sourceName: 'Boss', wowheadUrl: 'https://www.wowhead.com/item=123' }]
  };

  makeProposal('bis-accepted');
  assert.equal(markBisProposalAwaitingSource('bis-accepted', 'holy', 'Holy'), true);
  assert.equal(markBisProposalBuilding('bis-accepted'), true);
  assert.equal(saveBisProposalList('bis-accepted', list), true);
  assert.equal(acceptBisProposal('bis-g', 'bis-u', 'bis-accepted'), true);
  assert.equal(getCurrentBisList('bis-g', 'bis-u').id, 'bis-accepted');
  assert.equal(getCurrentBisList('bis-g', 'bis-u').items[0].sourceName, 'Boss');
  assert.deepEqual(updateBisListItem('bis-g', 'bis-u', 'bis-accepted', 0, {
    itemId: 124, itemName: 'Replacement Helm', sourceName: 'Vault', wowheadUrl: 'https://www.wowhead.com/item=124'
  }), { itemId: 123, itemName: 'Test Helm', sourceName: 'Boss', slotName: 'Cabeza' });
  assert.equal(getCurrentBisList('bis-g', 'bis-u').items[0].itemName, 'Replacement Helm');
  assert.equal(db.prepare('SELECT actor_user_id, old_item_id, new_item_id FROM wow_bis_item_edits WHERE list_id=?').get('bis-accepted').new_item_id, 124);

  makeProposal('bis-rejected');
  assert.equal(saveBisProposalList('bis-rejected', list), true);
  assert.equal(rejectBisProposal('bis-g', 'bis-u', 'bis-rejected'), true);
  assert.equal(getCurrentBisList('bis-g', 'bis-u'), null);
  assert.equal(getBisProposal('bis-accepted').status, 'cleared');
  assert.equal(getBisProposal('bis-rejected').status, 'rejected');
});

test('precarga calderos una sola vez y actualiza asignaciones y panel', () => {
  const assignments = [{ weekday: 'monday', type: 'potis', characterName: 'Main' }];
  assert.equal(seedCauldronAssignments('g1', assignments), true);
  assert.equal(seedCauldronAssignments('g1', [{ weekday: 'monday', type: 'potis', characterName: 'Other' }]), false);
  setCauldronAssignment('g1', 'monday', 'potis', 'Other');
  assert.deepEqual(getCauldronAssignments('g1'), [{ weekday: 'monday', cauldron_type: 'potis', character_name: 'Other' }]);

  setCauldronPanel('g1', 'channel-1', 'message-1');
  setCauldronPanel('g1', 'channel-1', 'message-2');
  assert.deepEqual(getCauldronPanel('g1'), { channel_id: 'channel-1', message_id: 'message-2' });
});

test('guarda cambios de roles en el historial y filtra por usuario', () => {
  recordWowSyncChanges([
    { guildId: 'g1', userId: 'u1', characterName: 'Main', realmSlug: 'sanguino', category: 'rango', action: 'added', roleId: 'r1', roleName: 'Raider' },
    { guildId: 'g1', userId: 'u2', characterName: 'Alt', realmSlug: 'zuljin', category: 'profesión', action: 'added', roleId: 'p1', roleName: 'Alquimista' }
  ]);

  assert.equal(getWowSyncHistory('g1').length, 2);
  assert.deepEqual(getWowSyncHistory('g1', 'u1', 5).map(({ character_name, role_name }) => ({ character_name, role_name })), [
    { character_name: 'Main', role_name: 'Raider' }
  ]);
});


test('claims persist and isolate weeks/channels, including uncertain sends', () => {
  assert.equal(hasLootReport('g1', 'c1', '2026-10-14'), false);
  assert.equal(claimLootReport('g1', 'c1', '2026-10-14'), true);
  assert.equal(claimLootReport('g1', 'c1', '2026-10-14'), false);
  assert.equal(hasLootReport('g1', 'c1', '2026-10-14'), true);
  finishLootReport('g1', 'c1', '2026-10-14', 'm1');
  assert.deepEqual(db.prepare('SELECT status, message_id FROM wowaudit_reports').get(), {status:'sent', message_id:'m1'});
  assert.equal(claimLootReport('g1', 'c2', '2026-10-14'), true);
  assert.equal(claimLootReport('g1', 'c1', '2026-10-21'), true);
});

test('loot panel persists a single message ID and weekly slot across manual refreshes',()=>{
 assert.equal(claimLootPanel('panel-g','panel-c'),true);
 assert.equal(claimLootPanel('panel-g','panel-c'),false);
 assert.equal(getLootPanel('panel-g','panel-c').status,'creating');
 saveLootPanel('panel-g','panel-c','panel-m','2026-10-14');
 saveLootPanel('panel-g','panel-c','panel-m');
 assert.deepEqual(getLootPanel('panel-g','panel-c'),{message_id:'panel-m',status:'ready',last_slot:'2026-10-14'});
 assert.equal(claimLootPanel('panel-g','panel-c','wrong-id'),false);
 assert.equal(claimLootPanel('panel-g','panel-c','panel-m'),true);
 assert.equal(getLootPanel('panel-g','panel-c').status,'creating');
 saveLootPanel('panel-g','panel-c','replacement','2026-10-21');
 assert.equal(getLootPanel('panel-g','panel-c').message_id,'replacement');
});

test('migration recovers newest confirmed weekly message and preserves an existing panel',async()=>{
  claimLootReport('legacy-g','legacy-c','2026-10-07');
  finishLootReport('legacy-g','legacy-c','2026-10-07','old-message');
  claimLootReport('legacy-g','legacy-c','2026-10-14');
  finishLootReport('legacy-g','legacy-c','2026-10-14','new-message');
  saveLootPanel('preserved-g','preserved-c','manual-message');
  claimLootReport('preserved-g','preserved-c','2026-10-14');
  finishLootReport('preserved-g','preserved-c','2026-10-14','legacy-message');
  const reopened=await import('../src/database.js?migration-test');
  try {
    assert.deepEqual(reopened.getLootPanel('legacy-g','legacy-c'),{message_id:'new-message',status:'ready',last_slot:'2026-10-14'});
    assert.equal(reopened.getLootPanel('preserved-g','preserved-c').message_id,'manual-message');
  } finally { reopened.db.close(); }
});

test('command-selected destination persists per guild and can be changed',async()=>{
 assert.equal(getLootDestination('destination-g'),null);
 setLootDestination('destination-g','channel-one');
 setLootDestination('other-destination-g','other-channel');
 setLootDestination('destination-g','channel-two');
 assert.equal(getLootDestination('destination-g'),'channel-two');
 const reopened=await import('../src/database.js?destination-test');
 try {
  assert.equal(reopened.getLootDestination('destination-g'),'channel-two');
  assert.equal(reopened.getLootDestination('other-destination-g'),'other-channel');
 } finally { reopened.db.close(); }
});
