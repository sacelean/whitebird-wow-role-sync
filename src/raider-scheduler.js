import { getRaiderConfig, fetchRaiderTableReport, weeklySlot, weeklyCutoff } from './wowaudit.js';
import { getWowLinks, getRaiderDestination } from './database.js';
import { publishRaiderReport } from './raider-report.js';

export function startRaiderScheduler(client, guildId) {
  let config;
  try { config = getRaiderConfig(); } catch (error) { console.error(error.message); return; }
  if (!config) return;
  let busy = false;
  let retryAfter = 0;
  let completedKey = null;
  if (!getRaiderDestination(guildId)) console.warn('Elige un canal para el informe semanal con /informe-raiders canal:#tu-canal.');
  async function tick() {
    const slot = weeklySlot();
    const channelId = getRaiderDestination(guildId);
    const key = `${slot}:${channelId}`;
    if (!slot || !channelId || busy || key === completedKey || Date.now() < retryAfter) return;
    busy = true;
    try {
      const guild = await client.guilds.fetch(guildId);
      const links = getWowLinks(guildId);
      const end = weeklyCutoff(slot);
      const report = await fetchRaiderTableReport(config, links, end);
      await publishRaiderReport(guild, channelId, report, slot);
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
