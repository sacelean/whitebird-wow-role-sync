export const RAIDER_ORDERS = [
  { label: 'iLvl · mayor a menor', value: 'ilvl_desc' },
  { label: 'iLvl · menor a mayor', value: 'ilvl_asc' },
  { label: 'Loot · mayor a menor', value: 'loot_desc' },
  { label: 'Loot · menor a mayor', value: 'loot_asc' },
  { label: 'Nombre · A → Z', value: 'name_asc' },
  { label: 'Nombre · Z → A', value: 'name_desc' }
];

export function sortRaiderRows(rows, order) {
  if (!RAIDER_ORDERS.some(option => option.value === order)) throw new Error('Orden de raiders no válido.');
  const [field, direction] = order.split('_');
  const names = (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) ||
    a.realm.localeCompare(b.realm, 'es') || a.id - b.id;
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (field === 'name') return sign * names(a, b);
    // Missing item levels stay at the end in either direction.
    if (a[field] === null || b[field] === null) {
      if (a[field] === b[field]) return names(a, b);
      return a[field] === null ? 1 : -1;
    }
    return sign * (a[field] - b[field]) || names(a, b);
  });
}

export function renderRaiderReport(snapshot, order = 'ilvl_desc') {
  const rows = sortRaiderRows(snapshot.rows, order);
  const clean = value => String(value).replace(/[`\r\n|<>@]/g, ' ').trim();
  const number = value => value === null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(1);
  const width = Math.max(6, ...rows.map(row => Math.min(12, clean(row.name).length)));
  const header = `# ${'Nombre'.padEnd(width)} Loot Keys    Raid     iLvl`;
  const lines = rows.map((row, index) => {
    const cells = [String(index + 1).padStart(2), clean(row.name).slice(0, 12).padEnd(width),
      String(row.loot).padStart(4), row.keys.padEnd(7), row.raid.padEnd(8), number(row.ilvl).padStart(5)];
    const channel = /^\d{15,22}$/.test(row.channelId || '') ? `<#${row.channelId}>` : '—';
    return `\`${cells.join(' ')}\` ${channel}`;
  });
  const description = [
    `Roster en seguimiento: ${snapshot.ranks.map(clean).join(', ')} · ${rows.length} personajes · **${snapshot.total} objetos**.`,
    `Mythic · categorías: ${snapshot.categories.map(clean).join(', ')}.`,
    '', `\`${header}\` **Canal Raider**`, ...lines
  ].join('\n');
  const embed = {
    title: `Raiders · ${snapshot.date} · p${snapshot.period}`, description, color: 0x38b66b,
    footer: { text: `Orden: ${RAIDER_ORDERS.find(option => option.value === order).label} · Keys/Raid vault · iLvl actual · — = sin datos o canal sin vincular.` }
  };
  if (description.length > 4096 || embed.title.length + description.length + embed.footer.text.length > 6000) {
    throw new Error('La tabla completa supera el límite de un mensaje Discord.');
  }
  return {
    embeds: [embed], allowedMentions: { parse: [] },
    components: [{ type: 1, components: [{ type: 3, custom_id: 'wow-raiders-sort',
      placeholder: 'Ordenar informe', min_values: 1, max_values: 1,
      options: RAIDER_ORDERS.map(option => ({ ...option, default: option.value === order })) }] }]
  };
}
