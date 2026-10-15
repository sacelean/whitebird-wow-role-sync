import { getLootConfig, fetchLootReport, fetchRaiderTableReport, weeklySlot, weeklyCutoff } from './wowaudit.js';
import { lootPanelStore, raiderPanelStore, getWowLinks, getLootDestination } from './database.js';
import { updateLootPanel } from './loot-panel.js';

export function startLootScheduler(client, guildId) {
  let config;
  try { config = getLootConfig(); } catch (error) { console.error(error.message); return; }
  if (!config) return;
  let busy = false;
  let retryAfter = 0;
  let completedKey = null;
  if (!getLootDestination(guildId)) console.warn('Elige un canal para el informe semanal con /informe-raiders canal:#tu-canal.');
  async function tick() {
    const slot = weeklySlot();
    const channelId = getLootDestination(guildId);
    const key = `${slot}:${channelId}`;
    if (!slot || !channelId || busy || key === completedKey || Date.now() < retryAfter) return;
    busy = true;
    try {
      const guild = await client.guilds.fetch(guildId);
      const links = getWowLinks(guildId);
      const end = weeklyCutoff(slot);
      const failures = [];
      try {
        const report = await fetchLootReport(config, links, end);
        await updateLootPanel(guild, { ...config, channelId }, report, lootPanelStore, slot);
      } catch (error) {
        failures.push(`loot: ${error.message}`);
      }
      try {
        const report = await fetchRaiderTableReport(config, links, end);
        await updateLootPanel(guild, { ...config, channelId }, report, raiderPanelStore, slot, 'resumen de raiders');
      } catch (error) {
        failures.push(`raiders: ${error.message}`);
      }
      if (failures.length) throw new Error(failures.join(' · '));
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
