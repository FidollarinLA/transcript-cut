import { time } from './status-tip.js';

export function partialReview(spans, partialIds) {
  const ids = new Set(Array.isArray(partialIds) ? partialIds : []);
  const partial = (Array.isArray(spans) ? spans : []).filter(span => ids.has(span.id));
  if (!partial.length) return null;
  const first = partial[0];
  return {
    count: partial.length,
    startUs: first.start_us,
    message: `${partial.length} 句被切点截断，已从成片字幕略去。`,
    locateLabel: `定位 ${time(first.start_us)}`,
  };
}
