import { getLootConfig, fetchLootReport, weeklySlot, weeklyCutoff } from './wowaudit.js';
import { lootPanelStore, getWowLinks, getLootDestination } from './database.js';
import { updateLootPanel } from './loot-panel.js';

export function startLootScheduler(client, guildId) {
  let config;
  try { config = getLootConfig(); } catch (error) { console.error(error.message); return; }
  if (!config) return;
  let busy = false;
  let retryAfter = 0;
  let completedKey = null;
  if (!getLootDestination(guildId)) console.warn('Elige un canal para el informe semanal con /wow-loot-actualizar canal:#tu-canal.');
  async function tick() {
    const slot = weeklySlot();
    const channelId = getLootDestination(guildId);
    const key = `${slot}:${channelId}`;
    if (!slot || !channelId || busy || key === completedKey || Date.now() < retryAfter) return;
    busy = true;
    try {
      const guild = await client.guilds.fetch(guildId);
      const report = await fetchLootReport(config, getWowLinks(guildId), weeklyCutoff(slot));
      await updateLootPanel(guild, { ...config, channelId }, report, lootPanelStore, slot);
      completedKey = key;
    } catch (error) {
      console.error('Informe WoWAudit:', error.message);
      retryAfter = Date.now() + 5 * 60_000;
    } finally { busy = false; }
  }
  void tick();
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  client.once('invalidated', () => clearInterval(timer));
  return timer;
}
