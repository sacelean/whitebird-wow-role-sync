import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { getPublishedReleaseNote, savePublishedReleaseNote } from './database.js';

async function readLatestReleaseNote() {
  const contents = await readFile(new URL('../RELEASE_NOTES.md', import.meta.url), 'utf8');
  const sections = contents.split(/^##\s+/m).slice(1);
  if (!sections.length) throw new Error('RELEASE_NOTES.md no contiene una sección de release (## ...).');
  const [titleLine, ...bodyLines] = sections[0].split(/\r?\n/);
  const title = titleLine.trim();
  const body = bodyLines.join('\n').trim();
  if (!title || !body) throw new Error('La sección más reciente de RELEASE_NOTES.md está vacía.');
  const releaseId = createHash('sha256').update(`${title}\n${body}`).digest('hex');
  return { title, body, releaseId };
}

export async function publishLatestReleaseNote(client, guildId, channelId) {
  if (!channelId) {
    console.info('Anuncio de release notes desactivado: configura RELEASE_NOTES_CHANNEL_ID con el ID del canal de entrada.');
    return { published: false, reason: 'not-configured' };
  }

  const { title, body, releaseId } = await readLatestReleaseNote();
  if (getPublishedReleaseNote(guildId, releaseId)) {
    return { published: false, reason: 'already-published' };
  }

  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error('RELEASE_NOTES_CHANNEL_ID no apunta a un canal de texto de este servidor.');
  }
  const botMember = await guild.members.fetchMe();
  const permissions = channel.permissionsFor(botMember);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) {
    throw new Error('El bot necesita Ver canal y Enviar mensajes en el canal de entrada para publicar las release notes.');
  }

  const content = `📣 **Whitebird WoW Role Sync · ${title}**\n\n${body}`;
  if (content.length > 2000) throw new Error(`La última release note tiene ${content.length} caracteres; Discord permite hasta 2000 en un mensaje.`);
  const message = await channel.send({ content, allowedMentions: { parse: [] } });
  savePublishedReleaseNote(guildId, releaseId, channel.id, message.id);
  console.log(`Release note publicada en #${channel.name}: ${title} (${message.id}).`);
  return { published: true, messageId: message.id };
}
