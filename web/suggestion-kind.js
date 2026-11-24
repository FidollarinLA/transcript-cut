const labels = {
  filler: '口头禅',
  repeat: '重复句',
  pause: '长停顿',
};

export const suggestionFilters = [
  { id: 'all', label: '全部' },
  { id: 'filler', label: '口头禅' },
  { id: 'repeat', label: '重复句' },
  { id: 'pause', label: '长停顿' },
];

export function suggestionMeta(kind) {
  if (labels[kind]) return { id: kind, label: labels[kind] };
  return { id: 'other', label: '建议' };
}

export function summarizeSuggestions(items) {
  const counts = { all: 0, filler: 0, repeat: 0, pause: 0, other: 0 };
  for (const item of items || []) {
    counts.all += 1;
    counts[suggestionMeta(item?.kind).id] += 1;
  }
  return counts;
}

export function visibleSuggestions(items, filter) {
  const list = [...(items || [])];
  if (!filter || filter === 'all') return list;
  return list.filter(item => suggestionMeta(item?.kind).id === filter);
}
