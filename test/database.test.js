import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testDirectory = mkdtempSync(join(tmpdir(), 'whitebird-wow-database-tests-'));
process.env.DATABASE_PATH = join(testDirectory, 'test.sqlite');

const {
  db,
  getCauldronAssignments,
  getCauldronPanel,
  getWowLinks,
  getWowSyncHistory,
  recordWowSyncChanges,
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
