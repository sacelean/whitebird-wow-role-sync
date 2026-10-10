const weekdays = [
  ['monday', 'Lunes'], ['tuesday', 'Martes'], ['wednesday', 'Miércoles'], ['thursday', 'Jueves']
];

export function renderCauldronSchedule(assignments, alchemyRoleId) {
  if (!/^\d{15,22}$/.test(String(alchemyRoleId || ''))) {
    throw new Error('Configura el rol de Alquimista como "Alchemy" en WOW_PROFESSION_ROLE_IDS para mencionarlo en el reparto.');
  }
  const byDay = new Map(assignments.map((item) => [`${item.weekday}:${item.cauldron_type}`, item.character_name]));
  const lines = ['📦 **REPARTO DE CALDEROS** 📦', `<@&${alchemyRoleId}>`];
  for (const [key, label] of weekdays) {
    lines.push('', `🗓️ **${label}**`);
    lines.push(`🧪 Potis: ${byDay.get(`${key}:potis`) || 'Sin asignar'}`);
    lines.push(`🧴 Frascos: ${byDay.get(`${key}:frascos`) || 'Sin asignar'}`);
  }
  lines.push('', '⚠️ Recordad tener los calderos preparados antes de la raid para evitar prisas de última hora. ¡Gracias por colaborar! 💜');
  return lines.join('\n');
}

export async function updateCauldronPanel(guild, { getPanel, getAssignments, setPanel, alchemyRoleId }) {
  const panel = getPanel(guild.id);
  if (!panel) return false;
  const channel = await guild.channels.fetch(panel.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return false;
  const content = renderCauldronSchedule(getAssignments(guild.id), alchemyRoleId);
  let message = await channel.messages.fetch(panel.message_id).catch(() => null);
  if (message) {
    try {
      await message.edit({ content, allowedMentions: { parse: [] } });
      return true;
    } catch (error) {
      // Discord.js can return a deleted message from cache; recover from the stale saved ID.
      if (error.code !== 10008) throw error;
    }
  }
  message = await channel.send({ content, allowedMentions: { parse: [] } });
  setPanel(guild.id, channel.id, message.id);
  return true;
}
