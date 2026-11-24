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

export const shortcutHelp = [
  {
    title: '播放与定位',
    rows: [
      { keys: ['空格', 'K'], actions: ['play-pause'], label: '播放或暂停' },
      { keys: ['J', '←'], actions: ['step-back'], label: '后退 1 秒' },
      { keys: ['L', '→'], actions: ['step-forward'], label: '前进 1 秒' },
    ],
  },
  {
    title: '转写稿',
    rows: [
      { keys: ['↑', '↓'], actions: ['select-prev', 'select-next'], label: '选择上一句或下一句' },
      { keys: ['Shift + ↑', 'Shift + ↓'], actions: ['extend-prev', 'extend-next'], label: '向上或向下扩展选区' },
      { keys: ['Shift + 点击'], actions: [], label: '连续选择多行' },
      { keys: ['Esc'], actions: ['escape'], label: '取消当前选区。弹窗打开时先关闭弹窗' },
    ],
  },
  {
    title: '剪辑',
    rows: [
      { keys: ['Delete', 'Backspace'], actions: ['cut'], label: '剪掉当前选区' },
      { keys: ['Ctrl + Z', 'Cmd + Z'], actions: ['undo'], label: '撤销' },
      { keys: ['Ctrl + Y', 'Ctrl + Shift + Z', 'Cmd + Shift + Z'], actions: ['redo'], label: '重做' },
    ],
  },
  {
    title: '说明',
    rows: [
      { keys: ['?'], actions: ['help'], label: '打开快捷键说明' },
    ],
  },
];

export function matchShortcut(event, context = {}) {
  if (event.isComposing || event.key === 'Process') return null;
  if (context.isDialogOpen) return null;
  if (isEditableElement(event.target)) return null;
  if (typeof document !== 'undefined' && isEditableElement(document.activeElement)) return null;

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
  if (key === '?' || key === '？' || (event.shiftKey && key === '/')) {
    return 'help';
  }

  return null;
}
