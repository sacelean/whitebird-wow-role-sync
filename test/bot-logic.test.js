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
  announceRaiderMainChange,
  getWowConfig,
  findGuildRosterCharacter,
  getUnlinkedMappedRosterMembers,
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

test('cambiar de main renombra el canal asociado y explica el cambio en ese mismo canal', async () => {
  const { guild } = makeGuild([roleIds.rank2]);
  const previous = { ...linked, character_name: 'Monknalisa', raider_channel_id: 'raider-channel' };
  const character = { name: 'Rubênn', realm: 'sanguino' };
  const events = [];
  const channel = {
    id: previous.raider_channel_id,
    type: 0,
    name: 'raider-monknalisa-sanguino',
    setName: async (name) => { events.push(name); channel.name = name; },
    send: async (payload) => { events.push(payload); }
  };
  guild.channels.cache.set(channel.id, channel);

  assert.match(await announceRaiderMainChange(guild, previous, character), /Cambio de main anunciado/);
  assert.equal(events[0], 'raider-rubenn-sanguino');
  assert.match(events[1].content, /Monknalisa · sanguino.*Rubênn · sanguino/);
  assert.match(events[1].content, /#raider-monknalisa-sanguino.*#raider-rubenn-sanguino/);
  assert.deepEqual(events[1].allowedMentions, { parse: [] });

  await announceRaiderMainChange(guild, { ...previous, character_name: character.name }, character);
  assert.equal(events.length, 2);
});

test('distingue un renombrado correcto de un aviso que Discord rechaza', async () => {
  const { guild } = makeGuild([roleIds.rank2]);
  const channel = {
    id: 'raider-channel',
    type: 0,
    name: 'raider-monknalisa-sanguino',
    setName: async (name) => { channel.name = name; },
    send: async () => { throw new Error('Missing permissions'); }
  };
  guild.channels.cache.set(channel.id, channel);
  const status = await announceRaiderMainChange(guild, { ...linked, raider_channel_id: channel.id }, { name: 'Rubênn', realm: 'sanguino' });
  assert.equal(channel.name, 'raider-rubenn-sanguino');
  assert.match(status, /renombrado.*No se pudo publicar el aviso/);
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

test('el ascenso Recluta → Raider se detecta antes del cambio y entrega el canal resuelto', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2) });
  const { guild, roles } = makeGuild([roleIds.rank0]);
  roles.get(roleIds.rank0).name = 'Recluta';
  const channel = { id: 'raider-channel', type: 0, name: 'raider-asherrna-sanguino' };
  guild.channels.cache.set(channel.id, channel);
  const events = [];
  const options = { onRaiderSync: async event => { events.push(event); return event.promoted; } };
  const report = await synchronizeWowRoles(guild, [{ ...linked, raider_channel_id: channel.id }], options);
  assert.equal(events[0].promoted, true);
  assert.equal(events[0].channel, channel);
  assert.deepEqual(report.promotionMessages, ['Asherrna']);
  await synchronizeWowRoles(guild, [{ ...linked, raider_channel_id: channel.id }], options);
  assert.equal(events[1].promoted, false);
});

test('no considera ascenso a un Raider ya existente, una primera vinculación ni un cambio desde otro rango', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2) });
  for (const initial of [[roleIds.rank2], [], [roleIds.rank0]]) {
    const { guild } = makeGuild(initial);
    const events = [];
    await synchronizeWowRoles(guild, [linked], { onRaiderSync: async event => { events.push(event); } });
    assert.equal(events.length, 1);
    assert.equal(events[0].promoted, false);
  }
});

test('no felicita si falla la actualización del rango ni cuando el personaje sale del roster', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2) });
  const { guild, member, roles } = makeGuild([roleIds.rank0]);
  roles.get(roleIds.rank0).name = 'Recluta';
  member.roles.add = async () => { throw new Error('Missing Permissions'); };
  let calls = 0;
  await synchronizeWowRoles(guild, [linked], { onRaiderSync: async () => { calls++; } });
  assert.equal(calls, 0);
  mockBlizzard(t, { roster: { members: [] } });
  await synchronizeWowRoles(guild, [linked], { onRaiderSync: async () => { calls++; } });
  assert.equal(calls, 0);
});

test('un fallo del aviso de ascenso no detiene las profesiones ni la sincronización', async (t) => {
  mockBlizzard(t, { roster: rosterWith('Asherrna', 2) });
  const { guild, roles } = makeGuild([roleIds.rank0]);
  roles.get(roleIds.rank0).name = 'Recluta';
  const report = await synchronizeWowRoles(guild, [linked], { onRaiderSync: async () => { throw new Error('Aviso pendiente'); } });
  assert.equal(report.synced, 1);
  assert.equal(report.professionsChecked, 1);
  assert.ok(report.failed.some(message => message.includes('Aviso pendiente')));
});


test('roster usa el umbral de Blizzard, independientemente del nombre y mapeo del rol', async (t) => {
  const rosterId = '100000000000099';
  const keys = ['WOW_ROSTER_ROLE_ID', 'WOW_ROSTER_MIN_RANK', 'WOWAUDIT_API_KEY'];
  const previous = keys.map(key => process.env[key]);
  process.env.WOW_ROSTER_ROLE_ID = rosterId;
  process.env.WOW_ROSTER_MIN_RANK = '4';
  process.env.WOWAUDIT_API_KEY = 'test-audit';
  t.after(() => {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
    });
  });
  let selectedRoster;
  t.mock.method(globalThis, 'fetch', async input => {
    const url = String(input);
    if (url.endsWith('/v1/characters')) return blizzardResponse([{ id: 1, name: 'Asherrna', realm: 'sanguino', role: 'Ranged' }]);
    if (url.includes('/roster')) return blizzardResponse(selectedRoster);
    if (url.includes('/professions')) return blizzardResponse({ primaries: [] });
    return blizzardResponse({ access_token: 'test-token', expires_in: 3600 });
  });
  const { guild, member, roles } = makeGuild([roleIds.rank2]);
  roles.set(rosterId, { id: rosterId, name: 'roster', position: 6, managed: false });
  for (const [id, name] of [['tank', 'Tankes'], ['heal', 'Healers'], ['dps', 'DPS']]) {
    roles.set(id, { id, name, position: 6, managed: false });
  }
  roles.get(roleIds.rank2).name = 'Social';
  selectedRoster = rosterWith('Asherrna', 2);
  await synchronizeWowRoles(guild, []);
  assert.equal(member.roles.cache.has(rosterId), false);
  for (const rank of [0, 2, 4, 5, 4]) {
    selectedRoster = rosterWith('Asherrna', rank);
    const hadRoster = member.roles.cache.has(rosterId);
    const report = await synchronizeWowRoles(guild, [linked]);
    assert.equal(member.roles.cache.has(rosterId), rank <= 4);
    assert.equal(member.roles.cache.has('dps'), rank <= 4);
    if (rank === 5) assert.ok(report.roleChanges.some(change => change.roleId === 'dps' && change.category === 'combate' && change.action === 'removed'));
    assert.equal(report.roleChanges.some(change => change.roleId === rosterId && change.category === 'roster'), hadRoster !== (rank <= 4));
    const unchanged = await synchronizeWowRoles(guild, [linked]);
    assert.equal(unchanged.roleChanges.length, 0);
  }
  process.env.WOW_ROSTER_MIN_RANK = '0';
  await synchronizeWowRoles(guild, [linked]);
  assert.equal(member.roles.cache.has(rosterId), false);
  selectedRoster = rosterWith('Asherrna', 0);
  await synchronizeWowRoles(guild, [linked]);
  assert.equal(member.roles.cache.has(rosterId), true);
  delete process.env.WOWAUDIT_API_KEY;
  selectedRoster = { members: [] };
  await synchronizeWowRoles(guild, [linked]);
  assert.equal(member.roles.cache.has(rosterId), false);
  assert.equal(member.roles.cache.has('dps'), false);
  delete process.env.WOW_ROSTER_MIN_RANK;
  assert.equal(getWowConfig().rosterMinRank, 4);
  for (const invalid of ['', '-1', '1.5', 'abc', '9007199254740992']) {
    process.env.WOW_ROSTER_MIN_RANK = invalid;
    assert.throws(() => getWowConfig(), /WOW_ROSTER_MIN_RANK/);
  }
});

for (const raidRole of ['Tank', 'Healer', 'Ranged', null]) {
  test(`sync roles de combate con rangos: ${raidRole}`, async (t) => {
    const previousKey = process.env.WOWAUDIT_API_KEY;
    process.env.WOWAUDIT_API_KEY = 'test-audit';
    t.after(() => { if (previousKey === undefined) delete process.env.WOWAUDIT_API_KEY; else process.env.WOWAUDIT_API_KEY = previousKey; });
    const { guild, member, roles } = makeGuild([roleIds.rank0]);
    for (const [id, name] of [['tank', 'Tankes'], ['heal', 'Healers'], ['dps', 'DPS']]) roles.set(id, { id, name, position: 6, managed: false });
    member.roles.cache.set('dps', roles.get('dps'));
    t.mock.method(globalThis, 'fetch', async input => {
      const url = String(input);
      if (url.endsWith('/v1/characters')) return blizzardResponse([{ id: 1, name: linked.character_name, realm: linked.realm_slug, role: raidRole }]);
      if (url.includes('/roster')) return blizzardResponse(rosterWith('Asherrna', 2));
      if (url.includes('/professions')) return blizzardResponse({ primaries: [] });
      if (url.includes('oauth.battle.net')) return blizzardResponse({ access_token: 'test', expires_in: 3600 });
      throw new Error(`Petición inesperada: ${url}`);
    });
    const report = await synchronizeWowRoles(guild, [linked]);
    const expected = ({ Tank: 'tank', Healer: 'heal', Ranged: 'dps' })[raidRole] || 'dps';
    assert.equal(member.roles.cache.has(expected), true);
    assert.equal(['tank', 'heal', 'dps'].filter(id => member.roles.cache.has(id)).length, 1);
    assert.equal(member.roles.cache.has(roleIds.rank2), true);
    assert.equal(report.failed.length, 0);
    if (raidRole === null) assert.ok(report.skipped.some(message => message.includes('rol de raid')));
    if (raidRole === 'Healer') assert.equal(report.roleChanges.filter(change => change.category === 'combate').length, 2);
  });
}
