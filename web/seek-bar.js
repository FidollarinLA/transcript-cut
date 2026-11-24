export function seekUsInBar(startUs, endUs, x, width) {
  const start = Number(startUs);
  const end = Number(endUs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return start;
  if (!Number.isFinite(x) || !Number.isFinite(width) || !(width > 0) || x <= 0) return start;
  if (x >= width) return end - 1;
  const landed = start + Math.floor((end - start) * (x / width));
  if (landed <= start) return start;
  if (landed >= end) return end - 1;
  return landed;
}
