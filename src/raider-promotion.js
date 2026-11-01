const roleName = role => String(role?.name || '').normalize('NFC').trim().toLocaleLowerCase('es-ES');

export function getRaiderPromotion(guild, member, targetRoleId, rankRoles) {
  const roles = Object.values(rankRoles).map(id => guild.roles.cache.get(id));
  const targetIsRaider = Object.values(rankRoles).includes(targetRoleId) && roleName(guild.roles.cache.get(targetRoleId)) === 'raider';
  const alreadyRaider = roles.some(role => roleName(role) === 'raider' && member.roles.cache.has(role.id));
  const wasRecruit = roles.some(role => roleName(role) === 'recluta' && member.roles.cache.has(role.id));
  return { targetIsRaider, promoted: targetIsRaider && wasRecruit && !alreadyRaider };
}

export function raiderPromotionMessage(userId) {
  return [
    `🎉 ¡Enhorabuena, <@${userId}>! Has pasado de **Recluta** a **Raider** de Whitebird. ¡Gracias por tu compromiso con la guild!`,
    '',
    '📅 **Asistencia a raid:** en WoWAudit contamos contigo por defecto. Solo tendrás que notificar cuando **no puedas venir**.',
    '🔧 **Reparaciones de guild:** cuando se activen, podrás reparar tu equipo a cargo de la hermandad.',
    '',
    '¡A por muchas más raids juntos! 💜'
  ].join('\n');
}

export async function notifyRaiderPromotion({ guild, link, channel, promoted }, store) {
  if (promoted) store.enqueue(guild.id, link.user_id, link.character_name, link.realm_slug);
  const notification = store.get(guild.id, link.user_id);
  if (!notification || notification.status === 'sent') return false;
  // Do not deliver an old main's pending announcement after a relink.
  const same = a => a.normalize('NFC').toLowerCase();
  if (same(notification.character_name) !== same(link.character_name) ||
      same(notification.realm_slug) !== same(link.realm_slug)) return false;
  if (notification.status === 'sending') {
    throw new Error('Felicitación Raider con entrega sin confirmar; revisa los logs antes de reenviarla.');
  }
  if (!channel?.isTextBased() || typeof channel.send !== 'function') {
    throw new Error('Felicitación Raider pendiente: no hay un canal Raider accesible.');
  }
  if (!store.claim(guild.id, link.user_id, channel.id)) return false;
  let message;
  try {
    message = await channel.send({ content: raiderPromotionMessage(link.user_id), allowedMentions: { users: [link.user_id] } });
  } catch (error) {
    // A definite Discord rejection can be retried; ambiguous network deliveries cannot.
    if (Number(error?.code) === 50013 || Number(error?.code) === 50001 || Number(error?.code) === 10003) {
      store.retry(guild.id, link.user_id);
    }
    throw new Error('No se confirmó el envío de la felicitación Raider; revisa el acceso al canal y los logs.', { cause: error });
  }
  try { store.finish(guild.id, link.user_id, message.id); }
  catch (error) {
    throw new Error(`Discord confirmó la felicitación Raider ${message.id}, pero no se guardó su estado. Revisa los logs antes de reenviar.`, { cause: error });
  }
  return true;
}
