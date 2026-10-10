const cauldronTypes = { potis: 'caldero de pociones', frascos: 'caldero de frascos' };

const comparableCharacterName = (name) => String(name || '').normalize('NFC').toLocaleLowerCase('es-ES').replace(/\s+/g, '');

export function getGuildWeekday(timeZone, now = Date.now()) {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(new Date(now)).toLowerCase();
}

function findCauldronAssignee(links, characterName) {
  const key = comparableCharacterName(characterName);
  const matches = links.filter((link) => comparableCharacterName(link.character_name) === key);
  return matches.length === 1 && matches[0].raider_channel_id ? matches[0] : null;
}

export function buildDailyCauldronReminders(assignments, links, weekday) {
  const byUser = new Map();
  const unmatched = [];
  for (const assignment of assignments.filter((item) => item.weekday === weekday)) {
    const link = findCauldronAssignee(links, assignment.character_name);
    if (!link) {
      unmatched.push(assignment.character_name);
      continue;
    }
    const current = byUser.get(link.user_id) || { link, types: [] };
    current.types.push(cauldronTypes[assignment.cauldron_type] || `caldero de ${assignment.cauldron_type}`);
    byUser.set(link.user_id, current);
  }
  return { reminders: [...byUser.values()], unmatched };
}

export function nextDailyRun(hour, timeZone, now = Date.now()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const candidate = Math.floor(now / 60_000) * 60_000 + 60_000;
  for (let minute = 0; minute < 48 * 60; minute += 1) {
    const timestamp = candidate + minute * 60_000;
    const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(({ type, value }) => [type, value]));
    if (Number(parts.hour) === hour && Number(parts.minute) === 0) return timestamp;
  }
  throw new Error(`No se encontró la próxima ejecución para la zona horaria ${timeZone}.`);
}
