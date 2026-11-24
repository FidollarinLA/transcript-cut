export function markRangeFromPlayhead({ side, currentUs, startUs, endUs, durationUs }) {
  const current = Number(currentUs);
  const start = Number(startUs);
  const end = Number(endUs);
  const duration = Number(durationUs);
  const whole = value => Number.isInteger(value);
  if (!whole(duration) || duration <= 0 || !whole(current) || current < 0 || current > duration) {
    return { error: '超出视频范围' };
  }
  if (side === 'start') {
    if (!whole(end) || !(current < end && end <= duration)) return { error: '当前位置需早于终点' };
    return { startUs: current, endUs: end };
  }
  if (side === 'end') {
    if (!whole(start) || start < 0 || !(current > start)) return { error: '当前位置需晚于起点' };
    return { startUs: start, endUs: current };
  }
  return { error: '超出视频范围' };
}
