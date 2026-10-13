import { getLootConfig, fetchLootReport, weeklySlot, weeklyCutoff } from './wowaudit.js';
import { claimLootReport, finishLootReport, hasLootReport, getWowLinks } from './database.js';

export function startLootScheduler(client, guildId) {
  let config;
  try { config = getLootConfig(); } catch (error) { console.error(error.message); return; }
  if (!config) return;
  let busy = false;
  let retryAfter = 0;
  async function tick() {
    const slot = weeklySlot();
    if (!slot || busy || Date.now() < retryAfter || hasLootReport(guildId, config.channelId, slot)) return;
    busy = true;
    try {
      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(config.channelId);
      if (!channel?.isTextBased() || typeof channel.send !== 'function') throw new Error('Canal WoWAudit no disponible.');
      // Freeze the reporting boundary at Wednesday 20:00, including retries.
      const cutoff = weeklyCutoff(slot);
      const content = await fetchLootReport(config, getWowLinks(guildId), cutoff);
      if (!claimLootReport(guildId, config.channelId, slot)) return;
      try {
        const message = await channel.send({ content, allowedMentions: { parse: [] } });
        finishLootReport(guildId, config.channelId, slot, message.id);
      } catch {
        // Do not retry an uncertain send and risk duplicate messages.
        throw new Error('Envío WoWAudit incierto: revisar Discord y wowaudit_reports antes de reintentar.');
      }
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
