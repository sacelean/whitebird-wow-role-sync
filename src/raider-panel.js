import { logRaiderFailure } from './raider-diagnostics.js';
class RaiderPanelError extends Error {
  constructor(message) { super(message); this.name = 'RaiderPanelError'; }
}
const activeUpdates = new Set();
const uncertainHint = 'No se pudo confirmar la creación del mensaje. Revisa los logs de la operación antes de cambiar su estado.';

export async function resolveRaiderChannel(guild, config, reportName = 'informe de raiders') {
  if (!config.channelId) throw new RaiderPanelError(`Elige un canal para el ${reportName}.`);
  let channel;
  try { channel = await guild.channels.fetch(config.channelId); }
  catch (error) {
    logRaiderFailure('fetch-channel', error, { guildId:guild.id, channelId:config.channelId });
    throw new RaiderPanelError('No se pudo consultar el canal de raiders. Revisa los logs.');
  }
  if (!channel?.isTextBased() || typeof channel.send !== 'function' || !channel.messages) throw new RaiderPanelError(`Canal no disponible para el ${reportName}.`);
  return channel;
}

export async function updateRaiderPanel(guild, config, payload, store, slot = null, reportName = 'informe de raiders') {
  const channel = await resolveRaiderChannel(guild, config, reportName);
  const key = `${guild.id}:${channel.id}:${reportName}`;
  if (activeUpdates.has(key)) throw new RaiderPanelError(`Ya hay una actualización del ${reportName} en curso.`);
  activeUpdates.add(key);
  const context = { guildId:guild.id, channelId:channel.id };
  try {
    const panel = store.get(guild.id, channel.id);
    if (panel?.status === 'creating') {
      logRaiderFailure('blocked-creation', null, {...context,panelStatus:panel.status});
      throw new RaiderPanelError(uncertainHint.replace('la creación del mensaje', `la creación del mensaje del ${reportName}`));
    }
    if (slot && panel?.last_slot === slot) return { channelId: channel.id, messageId: panel.message_id, updated: false };
    const options = { ...payload, content: payload.content ?? null, embeds: payload.embeds ?? [], attachments: [], allowedMentions: { parse: [] } };
    if (panel?.message_id) {
      let message;
      try {
        message = await channel.messages.fetch({ message: panel.message_id, force: true });
      } catch (error) {
        logRaiderFailure('fetch-message', error, {...context,messageId:panel.message_id});
        // Only Discord's Unknown Message proves deletion.
        if (Number(error.code) !== 10008) throw new RaiderPanelError(`No se pudo consultar el mensaje del ${reportName}. Revisa los logs.`);
      }
      if (message) {
        if (message.author.id !== guild.client.user.id) throw new RaiderPanelError(`El mensaje del ${reportName} guardado no pertenece a este bot.`);
        try { await message.edit(options); }
        catch (error) {
          logRaiderFailure('edit-message', error, {...context,messageId:message.id});
          throw new RaiderPanelError(`No se pudo editar el mensaje del ${reportName}. Revisa los logs.`);
        }
        try { store.save(guild.id, channel.id, message.id, slot); }
        catch (error) {
          logRaiderFailure('save-edited-message',error,{...context,messageId:message.id});
          throw new RaiderPanelError(`Discord confirmó la edición del ${reportName}, pero no se pudo guardar el estado. Revisa los logs.`);
        }
        return { channelId: channel.id, messageId: message.id, updated: true };
      }
    }
    if (!store.claim(guild.id, channel.id, panel?.message_id || null)) throw new RaiderPanelError(`Otro proceso está creando el mensaje del ${reportName}.`);
    let message;
    try {
      message = await channel.send({ ...payload, allowedMentions: { parse: [] } });
    } catch (error) {
      logRaiderFailure('create-message',error,{...context,panelStatus:'creating'});
      throw new RaiderPanelError(`Falló la creación del mensaje del ${reportName}. Revisa el código de error en los logs; el estado se conserva para su revisión.`);
    }
    try { store.save(guild.id, channel.id, message.id, slot); }
    catch (error) {
      logRaiderFailure('save-created-message',error,{...context,messageId:message.id,panelStatus:'creating'});
      throw new RaiderPanelError(`Discord devolvió el mensaje del ${reportName}, pero no se pudo guardar su ID. Revisa los logs.`);
    }
    return { channelId: channel.id, messageId: message.id, updated: true };
  } finally { activeUpdates.delete(key); }
}
