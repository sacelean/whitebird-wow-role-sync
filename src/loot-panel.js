import { logLootFailure } from './loot-diagnostics.js';
class LootPanelError extends Error {
  constructor(message) { super(message); this.name = 'LootPanelError'; }
}
const activeUpdates = new Set();
const uncertainHint = 'No se pudo confirmar la creación del mensaje. Revisa los logs de la operación antes de cambiar su estado.';

export async function resolveLootChannel(guild, config) {
  if (!config.channelId) throw new LootPanelError('Elige el destino con /wow-loot-actualizar canal:#tu-canal.');
  let channel;
  try { channel = await guild.channels.fetch(config.channelId); }
  catch (error) {
    logLootFailure('fetch-channel', error, { guildId:guild.id, channelId:config.channelId });
    throw new LootPanelError('No se pudo consultar el canal de loot. Revisa los logs.');
  }
  if (!channel?.isTextBased() || typeof channel.send !== 'function' || !channel.messages) throw new LootPanelError('Canal WoWAudit no disponible.');
  return channel;
}

export async function updateLootPanel(guild, config, payload, store, slot = null) {
  const channel = await resolveLootChannel(guild, config);
  const key = `${guild.id}:${channel.id}`;
  if (activeUpdates.has(key)) throw new LootPanelError('Ya hay una actualización de loot en curso.');
  activeUpdates.add(key);
  const context = { guildId:guild.id, channelId:channel.id };
  try {
    const panel = store.get(guild.id, channel.id);
    if (panel?.status === 'creating') {
      logLootFailure('blocked-creation', null, {...context,panelStatus:panel.status});
      throw new LootPanelError(uncertainHint);
    }
    if (slot && panel?.last_slot === slot) return { channelId: channel.id, messageId: panel.message_id, updated: false };
    const options = { ...payload, content: null, attachments: [], allowedMentions: { parse: [] } };
    if (panel?.message_id) {
      let message;
      try {
        message = await channel.messages.fetch({ message: panel.message_id, force: true });
      } catch (error) {
        logLootFailure('fetch-message', error, {...context,messageId:panel.message_id});
        // Only Discord's Unknown Message proves deletion.
        if (Number(error.code) !== 10008) throw new LootPanelError('No se pudo consultar el mensaje de loot. Revisa los logs.');
      }
      if (message) {
        if (message.author.id !== guild.client.user.id) throw new LootPanelError('El mensaje de loot guardado no pertenece a este bot.');
        try { await message.edit(options); }
        catch (error) {
          logLootFailure('edit-message', error, {...context,messageId:message.id});
          throw new LootPanelError('No se pudo editar el informe de loot. Revisa los logs.');
        }
        try { store.save(guild.id, channel.id, message.id, slot); }
        catch (error) {
          logLootFailure('save-edited-message',error,{...context,messageId:message.id});
          throw new LootPanelError('Discord confirmó la edición, pero no se pudo guardar el estado. Revisa los logs.');
        }
        return { channelId: channel.id, messageId: message.id, updated: true };
      }
    }
    if (!store.claim(guild.id, channel.id, panel?.message_id || null)) throw new LootPanelError('Otro proceso está creando el mensaje de loot.');
    let message;
    try {
      message = await channel.send({ ...payload, allowedMentions: { parse: [] } });
    } catch (error) {
      logLootFailure('create-message',error,{...context,panelStatus:'creating'});
      throw new LootPanelError('Falló la creación del mensaje de loot. Revisa el código de error en los logs; el estado se conserva para su revisión.');
    }
    try { store.save(guild.id, channel.id, message.id, slot); }
    catch (error) {
      logLootFailure('save-created-message',error,{...context,messageId:message.id,panelStatus:'creating'});
      throw new LootPanelError('Discord devolvió un mensaje, pero no se pudo guardar su ID. Revisa los logs.');
    }
    return { channelId: channel.id, messageId: message.id, updated: true };
  } finally { activeUpdates.delete(key); }
}
