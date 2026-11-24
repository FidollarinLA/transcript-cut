export function selectionRangeStyle(startUs, endUs, durationUs) {
  const start = Number(startUs);
  const end = Number(endUs);
  const duration = Number(durationUs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(duration) || !(duration > 0)) {
    return null;
  }
  if (!(start >= 0) || !(end <= duration) || !(start < end)) return null;
  const leftPct = (start / duration) * 100;
  const widthPct = ((end - start) / duration) * 100;
  if (!(widthPct > 0)) return null;
  return { leftPct, widthPct };
}
