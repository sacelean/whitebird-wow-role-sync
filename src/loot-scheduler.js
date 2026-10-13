import { getLootConfig, fetchLootReport, weeklySlot, weeklyCutoff } from './wowaudit.js';
import { lootPanelStore, getWowLinks } from './database.js';
import { updateLootPanel } from './loot-panel.js';

export function startLootScheduler(client, guildId) {
  let config;
  try { config = getLootConfig(); } catch (error) { console.error(error.message); return; }
  if (!config) return;
  let busy = false;
  let retryAfter = 0;
  let completedSlot = null;
  async function tick() {
    const slot = weeklySlot();
    if (!slot || busy || slot === completedSlot || Date.now() < retryAfter) return;
    busy = true;
    try {
      const guild = await client.guilds.fetch(guildId);
      const report = await fetchLootReport(config, getWowLinks(guildId), weeklyCutoff(slot));
      await updateLootPanel(guild, config, report, lootPanelStore, slot);
      completedSlot = slot;
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
