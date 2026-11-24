export function editActionNotice({ action, operation, reviewMessage, outputDurationLabel } = {}) {
  const review = String(reviewMessage || '').trim();
  if (review) return review;
  if (action === 'undo') return '已撤销。';
  if (action === 'redo') return '已重做。';
  if (action === 'apply' && operation?.kind === 'correct') return '文字已修正。';
  if (action === 'apply' && operation?.kind === 'cut') {
    const duration = String(outputDurationLabel || '').trim();
    return duration ? `已剪掉区间。成片预计 ${duration}。` : '已剪掉区间。';
  }
  return '';
}
