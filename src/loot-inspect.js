import 'dotenv/config';
import Database from 'better-sqlite3';
import { REST, Routes, PermissionFlagsBits } from 'discord.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { logLootFailure } from './loot-diagnostics.js';

export function inspectPermissions(guildId, botId, roles, member, channel) {
  const memberRoles = new Set(member.roles);
  let bits = roles.filter(r=>r.id===guildId || memberRoles.has(r.id)).reduce((n,r)=>n|BigInt(r.permissions),0n);
  const admin = (bits & PermissionFlagsBits.Administrator) !== 0n;
  if (!admin) {
    const overwrites=channel.permission_overwrites || [];
    const apply = o => { if(o) bits=(bits&~BigInt(o.deny))|BigInt(o.allow); };
    apply(overwrites.find(o=>o.id===guildId));
    const roleOverwrites=overwrites.filter(o=>o.type===0 && memberRoles.has(o.id));
    const deny=roleOverwrites.reduce((n,o)=>n|BigInt(o.deny),0n);
    const allow=roleOverwrites.reduce((n,o)=>n|BigInt(o.allow),0n);
    bits=(bits&~deny)|allow;
    apply(overwrites.find(o=>o.type===1 && o.id===botId));
  }
  return Object.fromEntries([
    ['Ver canal',PermissionFlagsBits.ViewChannel],
    ['Enviar mensajes',PermissionFlagsBits.SendMessages],
    ['Insertar enlaces',PermissionFlagsBits.EmbedLinks],
    ['Leer historial de mensajes',PermissionFlagsBits.ReadMessageHistory]
  ].map(([name,bit])=>[name,admin || (bits&bit)!==0n]));
}

async function inspect() {
  const guildId=process.env.DISCORD_GUILD_ID;
  if (!guildId || !process.env.DISCORD_TOKEN) { console.error('Faltan DISCORD_GUILD_ID o DISCORD_TOKEN.'); process.exitCode=1;return; }
  let db;
  try {
    db=new Database(resolve(process.env.DATABASE_PATH || './data/whitebird-wow-roles.sqlite'),{readonly:true,fileMustExist:true});
    const panels=db.prepare('SELECT channel_id, message_id, status, last_slot FROM wowaudit_loot_panels WHERE guild_id=?').all(guildId);
    console.log(JSON.stringify({panels},null,2));
    if (!panels.length) { console.log('No hay paneles registrados para este servidor.');return; }
    const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
    const [bot,roles]=await Promise.all([rest.get(Routes.user('@me')),rest.get(Routes.guildRoles(guildId))]);
    const member=await rest.get(Routes.guildMember(guildId,bot.id));
    for (const panel of panels) {
      try {
        const channel=await rest.get(Routes.channel(panel.channel_id));
        if(channel.guild_id!==guildId) { console.log('El canal guardado no pertenece al servidor configurado.');continue; }
        console.log(JSON.stringify({channelId:panel.channel_id,permissions:inspectPermissions(guildId,bot.id,roles,member,channel)},null,2));
        if(panel.message_id) {
          const message=await rest.get(Routes.channelMessage(panel.channel_id,panel.message_id));
          console.log(JSON.stringify({channelId:panel.channel_id,messageId:message.id,ownedByBot:message.author.id===bot.id}));
        }
      } catch(error) { logLootFailure('inspect-channel-readonly',error,{guildId,channelId:panel.channel_id,messageId:panel.message_id}); }
    }
  } catch(error) { logLootFailure('inspect-readonly',error,{guildId});process.exitCode=1; }
  finally { db?.close(); }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await inspect();
