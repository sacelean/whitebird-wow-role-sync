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
  getRaiderDestination,
  setRaiderDestination,
  getRaiderPanel,
  claimRaiderPanel,
  saveRaiderPanel,
  getRaiderView,
  saveRaiderView,
  getCauldronAssignments,
  getCauldronPanel,
  getWowLink,
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
  assert.deepEqual(getWowLink('g1', 'u1'), getWowLinks('g1')[0]);
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


test('raider panel persists a single message ID and weekly slot across manual refreshes',()=>{
 assert.equal(claimRaiderPanel('panel-g','panel-c'),true);
 assert.equal(claimRaiderPanel('panel-g','panel-c'),false);
 assert.equal(getRaiderPanel('panel-g','panel-c').status,'creating');
 saveRaiderPanel('panel-g','panel-c','panel-m','2026-10-14');
 saveRaiderPanel('panel-g','panel-c','panel-m');
 assert.deepEqual(getRaiderPanel('panel-g','panel-c'),{message_id:'panel-m',status:'ready',last_slot:'2026-10-14'});
 assert.equal(claimRaiderPanel('panel-g','panel-c','wrong-id'),false);
 assert.equal(claimRaiderPanel('panel-g','panel-c','panel-m'),true);
 assert.equal(getRaiderPanel('panel-g','panel-c').status,'creating');
 saveRaiderPanel('panel-g','panel-c','replacement','2026-10-21');
 assert.equal(getRaiderPanel('panel-g','panel-c').message_id,'replacement');
});

test('command-selected destination persists per guild and can be changed',async()=>{
 assert.equal(getRaiderDestination('destination-g'),null);
 setRaiderDestination('destination-g','channel-one');
 setRaiderDestination('other-destination-g','other-channel');
 setRaiderDestination('destination-g','channel-two');
 assert.equal(getRaiderDestination('destination-g'),'channel-two');
 const reopened=await import('../src/database.js?destination-test');
 try {
  assert.equal(reopened.getRaiderDestination('destination-g'),'channel-two');
  assert.equal(reopened.getRaiderDestination('other-destination-g'),'other-channel');
 } finally { reopened.db.close(); }
});

test('raider snapshot and sort survive restart independently of the weekly marker',async()=>{
 const snapshot={rows:[{id:1,name:'Main',loot:2,ilvl:330,channelId:'123456789012345678'}]};
 saveRaiderView('view-g','view-c',snapshot,'loot_asc');
 const reopened=await import('../src/database.js?view-test');
 try { assert.deepEqual(reopened.getRaiderView('view-g','view-c'),{snapshot,order:'loot_asc'}); }
 finally { reopened.db.close(); }
});
test('upgrade keeps the selected destination and removes obsolete report tables',async()=>{
 db.exec("CREATE TABLE wowaudit_loot_destinations (guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL); INSERT INTO wowaudit_loot_destinations VALUES ('legacy-g','legacy-c'); CREATE TABLE wowaudit_loot_panels (id TEXT); CREATE TABLE wowaudit_reports (id TEXT)");
 const reopened=await import('../src/database.js?retire-report-test');
 try {
  assert.equal(reopened.getRaiderDestination('legacy-g'),'legacy-c');
  assert.equal(reopened.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('wowaudit_loot_destinations','wowaudit_loot_panels','wowaudit_reports')").get().n,0);
 } finally { reopened.db.close(); }
});
