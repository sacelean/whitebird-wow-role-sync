import { db, getRaiderPanel, getRaiderView, saveRaiderView, raiderPanelStore } from './database.js';
import { updateRaiderPanel } from './raider-panel.js';
import { renderRaiderReport, RAIDER_ORDERS } from './raider-render.js';

function storeWithSnapshot(snapshot, order) {
  return { ...raiderPanelStore, save: db.transaction((guildId, channelId, messageId, slot) => {
    raiderPanelStore.save(guildId, channelId, messageId, slot);
    saveRaiderView(guildId, channelId, snapshot, order);
  }) };
}

const active = new Set();
async function withReportLock(guild, channelId, action) {
  const key = `${guild.id}:${channelId}`;
  if (active.has(key)) throw new Error('Ya hay una actualización del informe de raiders en curso.');
  active.add(key);
  try { return await action(); } finally { active.delete(key); }
}

export async function publishRaiderReport(guild, channelId, snapshot, slot = null) {
  return withReportLock(guild, channelId, async () => {
    const order = getRaiderView(guild.id, channelId)?.order || 'ilvl_desc';
    const result = await updateRaiderPanel(guild, { channelId }, renderRaiderReport(snapshot, order), storeWithSnapshot(snapshot, order), slot);
    return result;
  });
}

export async function sortRaiderReport(guild, channelId, messageId, order) {
  return withReportLock(guild, channelId, async () => {
    if (!RAIDER_ORDERS.some(option => option.value === order)) throw new Error('Orden de raiders no válido.');
    const panel = getRaiderPanel(guild.id, channelId);
    const view = getRaiderView(guild.id, channelId);
    if (!view || panel?.status !== 'ready' || panel.message_id !== messageId) {
      throw new Error('Este informe ya no está disponible. Actualízalo con /informe-raiders.');
    }
    const result = await updateRaiderPanel(guild, { channelId }, renderRaiderReport(view.snapshot, order), storeWithSnapshot(view.snapshot, order));
    return result;
  });
}
