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

test('consulta las rutas JSON de equipo y overview con autenticación Bearer', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    const value = url.endsWith('/overview_data') ? overview : team;
    return { ok: true, json: async () => value };
  };
  const result = await fetchGearReminderMessages({ apiKey: 'secret', teamId: 66082 }, [], fetcher);
  assert.equal(result.messages.length, 0);
  assert.deepEqual(requests.map((request) => request.url), [
    'https://wowaudit.com/api/teams/66082',
    'https://wowaudit.com/api/teams/66082/overview_data'
  ]);
  assert.ok(requests.every((request) => request.options.headers.Authorization === 'Bearer secret'));
});

test('publica el aviso en el canal Raider asociado y menciona al usuario', async () => {
  const sent = [];
  const channel = { isTextBased: () => true, send: async (payload) => sent.push(payload) };
  const guild = { channels: { fetch: async (id) => id === 'raider-channel' ? channel : null } };
  const fetcher = async (url) => ({ ok: true, json: async () => url.endsWith('/overview_data') ? overview : team });
  const result = await sendGearReminders(guild, { apiKey: 'secret', teamId: 66082 }, [
    { user_id: 'discord-1', character_name: 'RaiderA', realm_slug: 'zuljin', raider_channel_id: 'raider-channel' }
  ], fetcher);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /<@discord-1>/);
  assert.deepEqual(sent[0].allowedMentions, { users: ['discord-1'] });
});
