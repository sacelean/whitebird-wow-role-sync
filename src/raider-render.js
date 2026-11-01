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
  const headings = ['#', 'Nombre', 'Loot', 'Keys', 'Raid', 'iLvl'];
  const cells = rows.map((row, index) => [String(index + 1), clean(row.name).slice(0, 12),
    String(row.loot), clean(row.keys), clean(row.raid), number(row.ilvl)]);
  const widths = headings.map((heading, column) => Math.max(heading.length,
    ...cells.map(row => row[column].length)));
  const format = row => row.map((value, column) => column === 0 || column === 2 || column === 5
    ? value.padStart(widths[column]) : value.padEnd(widths[column])).join(' ');
  const lines = cells.map(format);
  const content = [
    `**Raiders · ${snapshot.date} · p${snapshot.period}**`,
    `${rows.length} personajes · **${snapshot.total} objetos**`,
    `Rangos: ${snapshot.ranks.map(clean).join(', ')}.`,
    `Mythic · ${snapshot.categories.map(clean).join(', ')}.`,
    '', '```text', format(headings), '─'.repeat(format(headings).length), ...lines, '```',
    `Orden: ${RAIDER_ORDERS.find(option => option.value === order).label}`,
    'Keys/Raid: vault · iLvl: actual · —: sin datos.'
  ].join('\n');
  if (content.length > 4000) throw new Error('El informe completo supera el límite de 4000 caracteres de un mensaje Discord.');
  return {
    // Text Display allows the full roster without an embed or pagination.
    flags: 1 << 15, allowedMentions: { parse: [] },
    components: [{ type: 10, content }, { type: 1, components: [{ type: 3, custom_id: 'wow-raiders-sort',
      placeholder: 'Ordenar informe', min_values: 1, max_values: 1,
      options: RAIDER_ORDERS.map(option => ({ ...option, default: option.value === order })) }] }]
  };
}
