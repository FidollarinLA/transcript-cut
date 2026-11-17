/**
 * 文字剪视频 · 键盘快捷键匹配与分发
 */

export function isEditableElement(target) {
  if (!target || typeof target.getAttribute !== 'function') return false;
  const tag = (target.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (target.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(type);
  }
  return target.isContentEditable === true;
}

export function matchShortcut(event, context = {}) {
  if (context.isDialogOpen) return null;
  if (isEditableElement(event.target)) return null;

  const isCtrlOrMeta = Boolean(event.ctrlKey || event.metaKey);
  const key = event.key;

  if (isCtrlOrMeta && !event.altKey) {
    if (key === 'z' || key === 'Z') {
      return event.shiftKey ? 'redo' : 'undo';
    }
    if (key === 'y' || key === 'Y') {
      return 'redo';
    }
    return null;
  }

  if (isCtrlOrMeta || event.altKey) return null;

  if (key === ' ' || key === 'Spacebar' || key === 'k' || key === 'K') {
    return 'play-pause';
  }
  if (key === 'j' || key === 'J' || key === 'ArrowLeft') {
    return 'step-back';
  }
  if (key === 'l' || key === 'L' || key === 'ArrowRight') {
    return 'step-forward';
  }
  if (key === 'Delete' || key === 'Backspace') {
    return 'cut';
  }
  if (key === 'ArrowUp') {
    return event.shiftKey ? 'extend-prev' : 'select-prev';
  }
  if (key === 'ArrowDown') {
    return event.shiftKey ? 'extend-next' : 'select-next';
  }
  if (key === 'Escape') {
    return 'escape';
  }

  return null;
}
