import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGearReminderMessages, fetchGearReminderMessages, getGearReminderConfig, sendGearReminders } from '../src/gear-reminders.js';

const team = {
  members: [
    { characterReference: { id: 11, name: 'RaiderA', realm: { slug: 'zuljin' } }, teamRank: { name: 'Trial' } },
    { characterReference: { id: 12, name: 'RaiderB', realm: { slug: 'sanguino' } }, teamRank: { name: 'Fijo' } },
    { characterReference: { id: 13, name: 'RaiderC', realm: { slug: 'stormscale' } }, teamRank: { name: 'Rotativo' } }
  ]
};
const roster = team.members.map(({characterReference: c}) => ({ id: c.id, name: c.name, realm: c.realm.slug, role: 'Healer' }));
const profile = (id, role = 'healer') => ({ id, currentSpec: { id: ({ healer: 257, ranged: 258, melee: 71, tank: 73 })[role], name: 'ignored', default_role: 'Healer' }, details: { gear: { head: { enchant: { missing: true }, sockets: [{ gem: null }] } } } });
const overview = {
  enchantData: {
    enchants_missing: { total: 2, characters: [{ id: 11, slots: ['head'] }, { id: 12, slots: ['feet'] }] },
    empty_sockets: { total: 2, characters: [{ id: 11, slots: ['waist'] }, { id: 13, slots: ['neck'] }] }
  }
};

test('notifica todos los rangos y agrupa incidencias de alts vinculadas al mismo usuario', () => {
  const result = buildGearReminderMessages(team, overview, [
    { user_id: 'discord-1', character_name: 'RaiderA', realm_slug: 'zuljin', raider_channel_id: 'raider-channel' },
    { user_id: 'discord-1', character_name: 'RaiderB', realm_slug: 'sanguino', raider_channel_id: 'raider-channel' },
    { user_id: 'discord-3', character_name: 'RaiderC', realm_slug: 'stormscale', raider_channel_id: null }
  ]);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].userId, 'discord-1');
  assert.equal(result.messages[0].channelId, 'raider-channel');
  assert.match(result.messages[0].content, /<@discord-1>/);
  assert.match(result.messages[0].content, /RaiderA/);
  assert.match(result.messages[0].content, /Encantamiento ausente: cabeza/);
  assert.match(result.messages[0].content, /Hueco de gema vacío: cintura/);
  assert.match(result.messages[0].content, /RaiderB/);
  assert.equal(result.unlinked.length, 1);
  assert.equal(result.unlinked[0].name, 'RaiderC');
  assert.equal(result.unlinked[0].missingChannel, true);
});

test('rechaza un resumen incompleto para no enviar avisos parciales', () => {
  assert.throws(() => buildGearReminderMessages(team, {
    enchantData: { ...overview.enchantData, empty_sockets: { total: 2, characters: [] } }
  }, []), /empty_sockets\.total/);
});

test('requiere API key y team ID, sin mostrar la clave en errores', () => {
  assert.equal(getGearReminderConfig({}), null);
  assert.throws(() => getGearReminderConfig({ WOWAUDIT_API_KEY: 'secret' }), /WOWAUDIT_TEAM_ID/);
  assert.deepEqual(getGearReminderConfig({ WOWAUDIT_API_KEY: ' secret ', WOWAUDIT_TEAM_ID: '66082' }), { apiKey: 'secret', teamId: 66082 });
});

test('consulta el roster con autenticación Bearer', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    const value = roster;
    return { ok: true, json: async () => value };
  };
  const result = await fetchGearReminderMessages({ apiKey: 'secret', teamId: 66082 }, [], fetcher);
  assert.equal(result.messages.length, 0);
  assert.deepEqual(requests.map((request) => request.url), [
    'https://wowaudit.com/v1/characters'
  ]);
  assert.ok(requests.every((request) => request.options.headers.Authorization === 'Bearer secret'));
});

test('publica el aviso en el canal Raider asociado y menciona al usuario', async () => {
  const sent = [];
  const channel = { isTextBased: () => true, send: async (payload) => sent.push(payload) };
  const guild = { channels: { fetch: async (id) => id === 'raider-channel' ? channel : null } };
  const fetcher = async (url) => ({ ok: true, json: async () => url.endsWith('/v1/characters') ? roster : profile(11) });
  const result = await sendGearReminders(guild, { apiKey: 'secret', teamId: 66082 }, [
    { user_id: 'discord-1', character_name: 'RaiderA', realm_slug: 'zuljin', raider_channel_id: 'raider-channel' }
  ], fetcher);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /<@discord-1>/);
  assert.match(sent[0].content, /Encantamiento ausente: cabeza/);
  assert.match(sent[0].content, /Hueco de gema vacío: cabeza/);
  assert.deepEqual(sent[0].allowedMentions, { users: ['discord-1'] });
});

for (const [expected, actual, sends] of [['Healer', 'ranged', false], ['Healer', 'healer', true], ['Tank', 'tank', true], ['Tank', 'melee', false], ['Melee', 'ranged', true], ['Ranged', null, false], ['unknown', 'tank', false]]) {
  test(`filtra equipo: roster ${expected}, especialización ${actual}`, async () => {
    const links = [{ user_id: 'u', character_name: 'RaiderA', realm_slug: 'zuljin', raider_channel_id: 'c' }];
    const fetcher = async url => ({ ok: true, json: async () => url.endsWith('/v1/characters') ? [{ ...roster[0], role: expected }] : profile(11, actual) });
    const result = await fetchGearReminderMessages({ apiKey: 'secret' }, links, fetcher);
    assert.equal(result.messages.length, sends ? 1 : 0);
    assert.equal(result.findings.length, sends ? 1 : 0);
    assert.equal(result.skipped.length, sends ? 0 : 1);
  });
}

test('Shadow con default_role Healer se omite para un healer; Disciplina y Mistweaver sí se comprueban', async () => {
  for (const [specId, expected] of [[258, 0], [256, 1], [270, 1], [99999, 0]]) {
    const fetcher = async url => ({ ok: true, json: async () => url.endsWith('/v1/characters') ? roster : { ...profile(11), currentSpec: { id: specId, default_role: 'Healer' } } });
    const result = await fetchGearReminderMessages({ apiKey: 'secret' }, [{ user_id: 'u', character_name: 'RaiderA', realm_slug: 'zuljin', raider_channel_id: 'c' }], fetcher);
    assert.equal(result.messages.length, expected, `specialization ${specId}`);
  }
});

test('diagnóstico distingue equipo correcto de una comprobación omitida sin enviar mensajes', async () => {
  const cleanProfile = profile(11);
  cleanProfile.details.gear.head = { enchant: { missing: false }, sockets: [{ gem: { id: 1 } }] };
  const fetcher = async url => ({ ok: true, json: async () => url.endsWith('/v1/characters') ? roster : cleanProfile });
  const result = await fetchGearReminderMessages({ apiKey: 'secret' }, [
    { user_id: 'u', character_name: 'RaiderA', realm_slug: 'zuljin', raider_channel_id: 'c' }
  ], fetcher);
  assert.deepEqual(result.checked, [{ name: 'RaiderA', role: 'healer', specializationRole: 'healer' }]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.messages.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.unlinked.length, 0);
});

test('el diagnóstico muestra encantamientos y gemas aunque falte el canal Raider', async () => {
  const character = profile(11);
  character.details.gear = {
    head: { enchant: { name: '', quality: 0, id: null, missing: true }, sockets: [] },
    chest: { enchant: { id: 8013, missing: false }, sockets: [] },
    neck: { enchant: null, sockets: [{ gem: 240983 }] },
    waist: { enchant: null, sockets: [{ gem: null }, { gem: null }] }
  };
  const links = [{ user_id: 'u', character_name: 'RaiderA', realm_slug: 'zuljin', raider_channel_id: null }];
  const fetcher = async url => ({ ok: true, json: async () => url.endsWith('/v1/characters') ? roster : character });
  const result = await fetchGearReminderMessages({ apiKey: 'secret' }, links, fetcher);

  assert.deepEqual(result.findings, [
    '**RaiderA · zuljin**\n• Encantamiento ausente: cabeza.\n• Hueco de gema vacío: cintura.'
  ]);
  assert.deepEqual(result.messages, []);
  assert.equal(result.unlinked[0].missingChannel, true);
});

test('avisa de la baja calidad en hombros aunque no falten encantamientos ni gemas', async () => {
  const character = profile(11);
  character.details = {
    gearStatus: { enchants_missing: 0, enchants_not_bis: 1 },
    gear: {
      shoulder: { enchant: { name: 'Flight of the Eagle (2)', id: 7971, quality: 2, missing: false }, sockets: [] },
      head: { enchant: { id: 8013, quality: 4, missing: false }, sockets: [{ gem: 240983 }] }
    }
  };
  const audit = { enchantData: { enchants_not_bis: { total: 1, characters: [{ id: 11, slots: ['shoulder'] }] } } };
  const responses = {
    '/v1/characters': roster,
    '/api/characters/11': character,
    '/api/teams/66082/overview_data': audit
  };
  const requests = [];
  const fetcher = async url => {
    const path = new URL(url).pathname;
    requests.push(path);
    return { ok: true, json: async () => responses[path] };
  };
  const link = { user_id: 'u', character_name: 'RaiderA', realm_slug: 'zuljin', raider_channel_id: 'c' };
  const config = { apiKey: 'secret', teamId: 66082 };
  const result = await fetchGearReminderMessages(config, [link], fetcher);
  assert.deepEqual(requests, Object.keys(responses));
  assert.deepEqual(result.qualityWarnings, []);
  assert.deepEqual(result.findings, ['**RaiderA · zuljin**\n• Encantamiento de baja calidad: hombros.']);
  assert.ok(result.messages[0].content.endsWith(result.findings[0]));

  const noChannel = await fetchGearReminderMessages(config, [{ ...link, raider_channel_id: null }], fetcher);
  assert.deepEqual(noChannel.findings, result.findings);
  assert.deepEqual(noChannel.messages, []);
});

test('una discrepancia en calidad conserva los avisos de encantamientos ausentes y gemas', async () => {
  const character = profile(11);
  character.details.gearStatus = { enchants_not_bis: 1 };
  const audit = { enchantData: { enchants_not_bis: { total: 1, characters: [{ id: 11, slots: ['head'] }] } } };
  const responses = {
    '/v1/characters': roster,
    '/api/characters/11': character,
    '/api/teams/66082/overview_data': audit
  };
  const fetcher = async url => ({ ok: true, json: async () => responses[new URL(url).pathname] });
  const result = await fetchGearReminderMessages({ apiKey: 'secret', teamId: 66082 }, [
    { user_id: 'u', character_name: 'RaiderA', realm_slug: 'zuljin', raider_channel_id: 'c' }
  ], fetcher);
  assert.deepEqual(result.findings, [
    '**RaiderA · zuljin**\n• Encantamiento ausente: cabeza.\n• Hueco de gema vacío: cabeza.'
  ]);
  assert.equal(result.qualityWarnings.length, 1);
  assert.match(result.qualityWarnings[0].reason, /no coincide con el perfil/);
});
