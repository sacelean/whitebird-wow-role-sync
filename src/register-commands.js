import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !clientId || !guildId) throw new Error('Configura DISCORD_TOKEN, DISCORD_CLIENT_ID y DISCORD_GUILD_ID en .env.');

const commands = [
  new SlashCommandBuilder()
    .setName('wow-vincular-auto')
    .setDescription('Busca tu main de WoW comparando tu nombre con el roster de Blizzard'),
  new SlashCommandBuilder()
    .setName('wow-vincular')
    .setDescription('Vincula un usuario de Discord con su personaje main (oficiales)')
    .addUserOption((option) => option.setName('usuario').setDescription('Miembro de Discord').setRequired(true))
    .addStringOption((option) => option.setName('personaje').setDescription('Nombre del personaje').setRequired(true))
    .addStringOption((option) => option.setName('reino').setDescription('Reino del personaje').setRequired(true)),
  new SlashCommandBuilder()
    .setName('wow-desvincular')
    .setDescription('Quita la vinculación de WoW de un usuario (oficiales)')
    .addUserOption((option) => option.setName('usuario').setDescription('Miembro de Discord').setRequired(true)),
  new SlashCommandBuilder()
    .setName('syncwow')
    .setDescription('Sincroniza los roles de rango y profesión (oficiales)'),
  new SlashCommandBuilder()
    .setName('wow-vinculaciones')
    .setDescription('Muestra vinculaciones guardadas y propuestas pendientes (oficiales)'),
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);
await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
console.log(`Comandos registrados en el servidor ${guildId}.`);
