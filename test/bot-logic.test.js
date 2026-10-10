import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDailyCauldronReminders, getGuildWeekday, nextDailyRun } from '../src/daily-cauldron.js';

const testDirectory = mkdtempSync(join(tmpdir(), 'whitebird-wow-tests-'));
process.env.DATABASE_PATH = join(testDirectory, 'test.sqlite');
process.env.BLIZZARD_CLIENT_ID = 'test-client';
process.env.BLIZZARD_CLIENT_SECRET = 'test-secret';
process.env.WOW_REGION = 'eu';
process.env.WOW_LOCALE = 'en_US';
process.env.WOW_GUILD_REALM_SLUG = 'sanguino';
process.env.WOW_GUILD_SLUG = 'whitebird';
process.env.WOW_DEFAULT_RANK_ROLE_ID = '100000000000001';
process.env.WOW_RANK_ROLE_IDS = JSON.stringify({ 0: '100000000000002', 2: '100000000000003' });
process.env.WOW_PROFESSION_ROLE_IDS = JSON.stringify({
  Alchemy: '100000000000004',
  Blacksmithing: '100000000000005'
});

const {
  findGuildRosterCharacter,
  getUnlinkedMappedRosterMembers,
  previewWowRoleSync,
  rankGuildRosterCandidates,
  synchronizeWowRoles
} = await import('../src/wow-sync.js');
const { renderCauldronSchedule, updateCauldronPanel } = await import('../src/cauldron-panel.js');

after(() => {
  rmSync(testDirectory, { recursive: true, force: true });
});

const roleIds = {
  default: process.env.WOW_DEFAULT_RANK_ROLE_ID,
  rank0: '100000000000002',
  rank2: '100000000000003',
  alchemy: '100000000000004',
  blacksmithing: '100000000000005'
};

function makeGuild(initialRoleIds = []) {
  const roles = new Map(Object.entries({
    [roleIds.default]: { id: roleIds.default, name: 'Viajante', position: 1, managed: false },
    [roleIds.rank0]: { id: roleIds.rank0, name: 'Guild Master', position: 2, managed: false },
    [roleIds.rank2]: { id: roleIds.rank2, name: 'Raider', position: 3, managed: false },
    [roleIds.alchemy]: { id: roleIds.alchemy, name: 'Alquimista', position: 4, managed: false },
    [roleIds.blacksmithing]: { id: roleIds.blacksmithing, name: 'Herrero', position: 5, managed: false }
  }));
  const memberRoles = new Map(initialRoleIds.map((id) => [id, roles.get(id)]));
  const changes = [];
  const member = {
    id: 'discord-user-1',
    guild: null,
    roles: {
      cache: memberRoles,
      add: async (id) => { memberRoles.set(id, roles.get(id)); changes.push(['add', id]); },
      remove: async (id) => { memberRoles.delete(id); changes.push(['remove', id]); }
    }
  };
  const channelCache = new Map();
  channelCache.find = (predicate) => [...channelCache.values()].find(predicate);
  const channels = { cache: channelCache, fetch: async (id) => id ? channelCache.get(id) : new Map() };
  const guild = {
    id: 'discord-guild-1',
    roles: { cache: roles, fetch: async () => roles },
    channels,
    members: {
      fetchMe: async () => ({ roles: { highest: { position: 100 } } }),
      fetch: async () => member
    }
  };
  member.guild = guild;
  return { guild, member, changes, roles };
}

function blizzardResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockBlizzard(t, { roster, professions = { primaries: [{ profession: { name: 'Alchemy' } }] }, professionStatus = 200 }) {
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = String(input);
    if (url.includes('/roster')) return blizzardResponse(roster);
    if (url.includes('/professions')) return blizzardResponse(professions, professionStatus);
    if (url.includes('oauth.battle.net')) return blizzardResponse({ access_token: 'test-token', expires_in: 3600 });
    throw new Error(`Petición inesperada en prueba: ${url}`);
  });
}

function rosterWith(name, rank, realm = 'sanguino') {
  return { members: [{ rank, character: { name, realm: { slug: realm } } }] };
}

const linked = { user_id: 'discord-user-1', character_name: 'Asherrna', realm_slug: 'sanguino', raider_channel_id: null };

test('sync cambia el rango y añade profesión en la misma pasada sin borrar otras profesiones', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2) });
  const { guild, member, changes } = makeGuild([roleIds.rank0, roleIds.blacksmithing]);

  const report = await synchronizeWowRoles(guild, [linked]);

  assert.deepEqual(changes, [
    ['add', roleIds.rank2],
    ['remove', roleIds.rank0],
    ['add', roleIds.alchemy]
  ]);
  assert.equal(member.roles.cache.has(roleIds.rank2), true);
  assert.equal(member.roles.cache.has(roleIds.rank0), false);
  assert.equal(member.roles.cache.has(roleIds.alchemy), true);
  assert.equal(member.roles.cache.has(roleIds.blacksmithing), true);
  assert.equal(report.synced, 1);
  assert.equal(report.professionsChecked, 1);
});

test('rango nuevo sin mapear sustituye el rango antiguo por Viajante', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 7) });
  const { guild, member, changes } = makeGuild([roleIds.rank2]);

  const report = await synchronizeWowRoles(guild, [linked]);

  assert.deepEqual(changes.slice(0, 2), [['add', roleIds.default], ['remove', roleIds.rank2]]);
  assert.equal(member.roles.cache.has(roleIds.default), true);
  assert.equal(member.roles.cache.has(roleIds.rank2), false);
  assert.equal(report.defaultRankApplied, 1);
});

test('si el personaje sale del roster, asigna Viajante y retira roles de profesión', async (t) => {
  mockBlizzard(t, { roster: { members: [] } });
  const { guild, member } = makeGuild([roleIds.rank2, roleIds.alchemy, roleIds.blacksmithing]);

  const report = await synchronizeWowRoles(guild, [linked]);

  assert.equal(member.roles.cache.has(roleIds.default), true);
  assert.equal(member.roles.cache.has(roleIds.rank2), false);
  assert.equal(member.roles.cache.has(roleIds.alchemy), false);
  assert.equal(member.roles.cache.has(roleIds.blacksmithing), false);
  assert.equal(report.outsideRosterDefaultApplied, 1);
});

test('si sale del roster y el usuario ya dejó Discord, lo omite sin intentar cambiar roles', async (t) => {
  mockBlizzard(t, { roster: { members: [] } });
  const { guild, changes } = makeGuild([roleIds.rank2, roleIds.alchemy]);
  guild.members.fetch = async (user) => {
    if (user === 'discord-user-1') throw new Error('Unknown Member');
    throw new Error('Usuario de prueba inesperado');
  };

  const report = await synchronizeWowRoles(guild, [linked]);

  assert.equal(report.outsideRoster, 1);
  assert.equal(report.outsideRosterDefaultApplied, 0);
  assert.deepEqual(report.skipped, ['Asherrna: no se encontró su usuario de Discord']);
  assert.deepEqual(changes, []);
});

test('un error de Blizzard al consultar profesiones conserva los roles actuales', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2), professionStatus: 404 });
  const { guild, member } = makeGuild([roleIds.blacksmithing]);

  const report = await synchronizeWowRoles(guild, [linked]);

  assert.equal(member.roles.cache.has(roleIds.blacksmithing), true);
  assert.equal(member.roles.cache.has(roleIds.alchemy), false);
  assert.match(report.skipped[0], /profesiones sin actualizar/);
});

test('una respuesta de profesiones incompleta conserva los roles actuales', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2), professions: { primaries: [{}] } });
  const { guild, member } = makeGuild([roleIds.blacksmithing]);

  const report = await synchronizeWowRoles(guild, [linked]);

  assert.equal(member.roles.cache.has(roleIds.blacksmithing), true);
  assert.equal(member.roles.cache.has(roleIds.alchemy), false);
  assert.match(report.skipped[0], /profesiones incompletas/);
});

test('si el miembro ya tiene el rango y la profesión correctos, no repite cambios', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2) });
  const { guild, changes } = makeGuild([roleIds.rank2, roleIds.alchemy]);

  await synchronizeWowRoles(guild, [linked]);

  assert.deepEqual(changes, []);
});

test('no toca roles si un rol configurado no existe o supera la jerarquía del bot', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2) });
  const { guild, changes } = makeGuild();
  guild.roles.cache.delete(roleIds.alchemy);

  await assert.rejects(synchronizeWowRoles(guild, [linked]), /no existe en el servidor o está fuera de la jerarquía/);
  assert.deepEqual(changes, []);
});

test('vinculación manual respeta los acentos del roster y excluye los ya vinculados', () => {
  const roster = { members: [
    { rank: 0, character: { name: 'Agô', realm: { slug: 'zuljin' } } },
    { rank: 2, character: { name: 'Agó', realm: { slug: 'sanguino' } } },
    { rank: 7, character: { name: 'Libre', realm: { slug: 'sanguino' } } }
  ] };

  assert.equal(findGuildRosterCharacter(roster, 'Ago', 'zuljin'), null);
  assert.deepEqual(findGuildRosterCharacter(roster, 'Agô', 'zuljin'), { name: 'Agô', realm: 'zuljin', rank: 0 });
  assert.deepEqual(getUnlinkedMappedRosterMembers(roster, [{ character_name: 'Agô', realm_slug: 'zuljin' }], { 0: roleIds.rank0, 2: roleIds.rank2 }), [
    { name: 'Agó', realm: 'sanguino', rank: 2 }
  ]);
});

test('búsqueda aproximada no mezcla nombres que solo difieren en acentos', () => {
  const ranked = rankGuildRosterCandidates({ members: [
    { character: { name: 'Agô', realm: { slug: 'zuljin' } } },
    { character: { name: 'Agó', realm: { slug: 'sanguino' } } }
  ] }, ['Ago']);

  assert.ok(ranked[0].score < 0.62, 'una diferencia de acento no debe bastar para proponer una vinculación');
  assert.equal(ranked.length, 2);
});

test('panel muestra una mención de rol real y las asignaciones del día', () => {
  const content = renderCauldronSchedule([
    { weekday: 'monday', cauldron_type: 'potis', character_name: 'Asherrna' },
    { weekday: 'monday', cauldron_type: 'frascos', character_name: 'Yaihy' }
  ], roleIds.alchemy);

  assert.match(content, new RegExp(`<@&${roleIds.alchemy}>`));
  assert.match(content, /🧪 Potis: Asherrna/);
  assert.match(content, /🧴 Frascos: Yaihy/);
  assert.match(content, /🗓️ \*\*Jueves\*\*/);
  assert.throws(() => renderCauldronSchedule([], 'Alquimista'), /WOW_PROFESSION_ROLE_IDS/);
});

test('si Discord devuelve un mensaje borrado desde caché, publica otro y guarda su ID', async () => {
  let savedPanel;
  let sentContent;
  const deletedMessage = {
    edit: async () => { const error = new Error('Unknown Message'); error.code = 10008; throw error; }
  };
  const channel = {
    id: 'channel-1',
    isTextBased: () => true,
    messages: { fetch: async () => deletedMessage },
    send: async ({ content, allowedMentions }) => {
      sentContent = { content, allowedMentions };
      return { id: 'message-new' };
    }
  };
  const guild = { id: 'g1', channels: { fetch: async () => channel } };

  const updated = await updateCauldronPanel(guild, {
    getPanel: () => ({ channel_id: 'channel-1', message_id: 'message-deleted' }),
    getAssignments: () => [{ weekday: 'monday', cauldron_type: 'potis', character_name: 'Asherrna' }],
    setPanel: (...values) => { savedPanel = values; },
    alchemyRoleId: roleIds.alchemy
  });

  assert.equal(updated, true);
  assert.deepEqual(savedPanel, ['g1', 'channel-1', 'message-new']);
  assert.match(sentContent.content, new RegExp(`<@&${roleIds.alchemy}>`));
  assert.deepEqual(sentContent.allowedMentions, { parse: [] });
});

test('la sincronización renombra el canal Raider según el rol, personaje y reino', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2) });
  const { guild, member } = makeGuild([roleIds.rank2]);
  const channel = {
    id: 'raider-channel',
    type: 0,
    name: 'raider-antiguo-sanguino',
    setName: async (name) => { channel.name = name; }
  };
  guild.channels.cache.set(channel.id, channel);

  const report = await synchronizeWowRoles(guild, [{ ...linked, raider_channel_id: channel.id }]);

  assert.equal(channel.name, 'raider-asherrna-sanguino');
  assert.equal(report.channelsRenamed, 1);
  assert.deepEqual(report.channelDetails, ['raider-antiguo-sanguino → raider-asherrna-sanguino']);
});

test('encuentra un canal Raider antiguo por nombre y guarda su ID en el vínculo', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2) });
  const { guild } = makeGuild([roleIds.rank2]);
  const channel = { id: 'legacy-raider', type: 0, name: 'raider-asherrna-sanguino', setName: async () => {} };
  guild.channels.cache.set(channel.id, channel);
  const saved = [];

  await synchronizeWowRoles(guild, [linked], { saveLink: (...args) => saved.push(args) });

  assert.deepEqual(saved, [['discord-guild-1', linked.user_id, linked.character_name, linked.realm_slug, channel.id]]);
});

test('la vista previa predice cambios de rango y profesión sin modificar roles', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2) });
  const { guild, member, changes } = makeGuild([roleIds.rank0, roleIds.blacksmithing]);

  const items = await previewWowRoleSync(guild, [linked]);

  assert.equal(items.length, 1);
  assert.match(items[0].status, /rango 2/);
  assert.deepEqual(items[0].roleChanges, ['añadir Raider', 'quitar Guild Master', 'añadir profesión Alquimista']);
  assert.deepEqual(changes, []);
  assert.equal(member.roles.cache.has(roleIds.rank0), true);
});

test('la sincronización emite cada cambio real para guardarlo en el historial', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2) });
  const { guild } = makeGuild([roleIds.rank0]);
  const recorded = [];

  const report = await synchronizeWowRoles(guild, [linked], { onRoleChange: (change) => recorded.push(change) });

  assert.deepEqual(recorded.map(({ category, action, roleName }) => ({ category, action, roleName })), [
    { category: 'rango', action: 'added', roleName: 'Raider' },
    { category: 'rango', action: 'removed', roleName: 'Guild Master' },
    { category: 'profesión', action: 'added', roleName: 'Alquimista' }
  ]);
  assert.deepEqual(report.roleChanges, recorded);
});

test('los avisos diarios agrupan los dos calderos por usuario y omiten vínculos ambiguos', () => {
  const assignments = [
    { weekday: 'monday', cauldron_type: 'potis', character_name: 'Asherrna' },
    { weekday: 'monday', cauldron_type: 'frascos', character_name: 'Asherrna' },
    { weekday: 'monday', cauldron_type: 'potis', character_name: 'Daphne' },
    { weekday: 'tuesday', cauldron_type: 'potis', character_name: 'Another' }
  ];
  const links = [
    { user_id: 'u1', character_name: 'Asherrna', raider_channel_id: 'c1' },
    { user_id: 'u2', character_name: 'Daphne', raider_channel_id: 'c2' },
    { user_id: 'u3', character_name: 'Daphne', raider_channel_id: 'c3' }
  ];

  const result = buildDailyCauldronReminders(assignments, links, 'monday');

  assert.equal(result.reminders.length, 1);
  assert.equal(result.reminders[0].link.user_id, 'u1');
  assert.deepEqual(result.reminders[0].types, ['caldero de pociones', 'caldero de frascos']);
  assert.deepEqual(result.unmatched, ['Daphne']);
});

test('el horario diario respeta Europe/Madrid y calcula el siguiente día si ya pasó la hora', () => {
  const beforeRun = Date.parse('2026-10-12T01:59:30.000Z');
  const afterRun = Date.parse('2026-10-12T02:00:30.000Z');

  assert.equal(getGuildWeekday('Europe/Madrid', Date.parse('2026-10-11T22:30:00.000Z')), 'monday');
  assert.equal(nextDailyRun(4, 'Europe/Madrid', beforeRun), Date.parse('2026-10-12T02:00:00.000Z'));
  assert.equal(nextDailyRun(4, 'Europe/Madrid', afterRun), Date.parse('2026-10-13T02:00:00.000Z'));
});
