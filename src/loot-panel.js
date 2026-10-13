class LootPanelError extends Error {
  constructor(message) { super(message); this.name = 'LootPanelError'; }
}
const activeUpdates = new Set();

export async function resolveLootChannel(guild, config) {
  if (!config.channelId) throw new LootPanelError('Configura WOWAUDIT_LOOT_CHANNEL_ID.');
  const channel = await guild.channels.fetch(config.channelId);
  if (!channel?.isTextBased() || typeof channel.send !== 'function' || !channel.messages) throw new LootPanelError('Canal WoWAudit no disponible.');
  return channel;

}

export async function updateLootPanel(guild, config, payload, store, slot = null) {
  const channel = await resolveLootChannel(guild, config);
  const key = `${guild.id}:${channel.id}`;
  if (activeUpdates.has(key)) throw new LootPanelError('Ya hay una actualización de loot en curso; vuelve a intentarlo.');
  activeUpdates.add(key);
  try {
    const panel = store.get(guild.id, channel.id);
    if (panel?.status === 'creating') throw new LootPanelError('Creación de mensaje incierta: revisa el canal y wowaudit_loot_panels antes de reintentar.');
    if (slot && panel?.last_slot === slot) return { channelId: channel.id, messageId: panel.message_id, updated: false };
    const options = { ...payload, content: null, attachments: [], allowedMentions: { parse: [] } };
    if (panel?.message_id) {
      let message;
      try {
        message = await channel.messages.fetch({ message: panel.message_id, force: true });
      } catch (error) {
        // Only Discord's Unknown Message proves deletion. Permissions/network failures never create a replacement.
        if (Number(error.code) !== 10008) throw new LootPanelError('No se pudo consultar el mensaje de loot; revisa permisos o conexión.');
      }
      if (message) {
        if (message.author.id !== guild.client.user.id) throw new LootPanelError('El mensaje de loot guardado no pertenece a este bot.');
        await message.edit(options);
        store.save(guild.id, channel.id, message.id, slot);
        return { channelId: channel.id, messageId: message.id, updated: true };
      }
    }
    if (!store.claim(guild.id, channel.id, panel?.message_id || null)) throw new LootPanelError('Otro proceso está creando el mensaje de loot.');
    let message;
    try {
      message = await channel.send({ ...payload, allowedMentions: { parse: [] } });
    } catch {
      throw new LootPanelError('Creación de mensaje incierta: revisa el canal y wowaudit_loot_panels antes de reintentar.');
    }
    store.save(guild.id, channel.id, message.id, slot);
    return { channelId: channel.id, messageId: message.id, updated: true };
  } finally { activeUpdates.delete(key); }
}
