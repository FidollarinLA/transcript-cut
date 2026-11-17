import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isEditableElement, matchShortcut } from '../web/shortcuts.js';

test('isEditableElement 正确区分文本编辑框与普通按钮元素', () => {
  const mockEl = (tag, type = '', isContentEditable = false) => ({
    tagName: tag.toUpperCase(),
    type,
    isContentEditable,
    getAttribute: () => null,
  });

  assert.equal(isEditableElement(mockEl('textarea')), true);
  assert.equal(isEditableElement(mockEl('select')), true);
  assert.equal(isEditableElement(mockEl('input', 'text')), true);
  assert.equal(isEditableElement(mockEl('input', 'number')), true);
  assert.equal(isEditableElement(mockEl('input', '')), true);
  assert.equal(isEditableElement(mockEl('div', '', true)), true);

  assert.equal(isEditableElement(mockEl('button')), false);
  assert.equal(isEditableElement(mockEl('input', 'file')), false);
  assert.equal(isEditableElement(mockEl('input', 'checkbox')), false);
  assert.equal(isEditableElement(mockEl('div', '', false)), false);
  assert.equal(isEditableElement(null), false);
  assert.equal(isEditableElement({}), false);
});

test('快捷键匹配支持播放、步进、撤销重做与剪除', () => {
  const evt = (key, opts = {}) => ({
    key,
    ctrlKey: Boolean(opts.ctrlKey),
    metaKey: Boolean(opts.metaKey),
    shiftKey: Boolean(opts.shiftKey),
    altKey: Boolean(opts.altKey),
    target: opts.target || { tagName: 'BODY', getAttribute: () => null },
  });

  // 播放与暂停
  assert.equal(matchShortcut(evt(' ')), 'play-pause');
  assert.equal(matchShortcut(evt('Spacebar')), 'play-pause');
  assert.equal(matchShortcut(evt('k')), 'play-pause');
  assert.equal(matchShortcut(evt('K')), 'play-pause');

  // 步进前进后退
  assert.equal(matchShortcut(evt('j')), 'step-back');
  assert.equal(matchShortcut(evt('J')), 'step-back');
  assert.equal(matchShortcut(evt('ArrowLeft')), 'step-back');
  assert.equal(matchShortcut(evt('l')), 'step-forward');
  assert.equal(matchShortcut(evt('L')), 'step-forward');
  assert.equal(matchShortcut(evt('ArrowRight')), 'step-forward');

  // 撤销与重做（Ctrl 与 Meta 键兼容）
  assert.equal(matchShortcut(evt('z', { ctrlKey: true })), 'undo');
  assert.equal(matchShortcut(evt('z', { metaKey: true })), 'undo');
  assert.equal(matchShortcut(evt('Z', { ctrlKey: true, shiftKey: true })), 'redo');
  assert.equal(matchShortcut(evt('z', { metaKey: true, shiftKey: true })), 'redo');
  assert.equal(matchShortcut(evt('y', { ctrlKey: true })), 'redo');
  assert.equal(matchShortcut(evt('Y', { metaKey: true })), 'redo');

  // 剪除与选择导航
  assert.equal(matchShortcut(evt('Delete')), 'cut');
  assert.equal(matchShortcut(evt('Backspace')), 'cut');
  assert.equal(matchShortcut(evt('ArrowUp')), 'select-prev');
  assert.equal(matchShortcut(evt('ArrowUp', { shiftKey: true })), 'extend-prev');
  assert.equal(matchShortcut(evt('ArrowDown')), 'select-next');
  assert.equal(matchShortcut(evt('ArrowDown', { shiftKey: true })), 'extend-next');
  assert.equal(matchShortcut(evt('Escape')), 'escape');
});

test('弹窗打开或在输入框中打字时屏蔽全局快捷键', () => {
  const editableTarget = { tagName: 'INPUT', type: 'number', getAttribute: () => null };
  const textareaTarget = { tagName: 'TEXTAREA', getAttribute: () => null };

  const evt = (key, opts = {}) => ({
    key,
    ctrlKey: Boolean(opts.ctrlKey),
    metaKey: Boolean(opts.metaKey),
    shiftKey: Boolean(opts.shiftKey),
    altKey: Boolean(opts.altKey),
    target: opts.target || { tagName: 'BODY', getAttribute: () => null },
  });

  // 输入框内不拦截
  assert.equal(matchShortcut(evt(' ', { target: editableTarget })), null);
  assert.equal(matchShortcut(evt('Delete', { target: editableTarget })), null);
  assert.equal(matchShortcut(evt('z', { ctrlKey: true, target: textareaTarget })), null);

  // 弹窗处于打开状态时不拦截
  assert.equal(matchShortcut(evt(' '), { isDialogOpen: true }), null);
  assert.equal(matchShortcut(evt('Delete'), { isDialogOpen: true }), null);
  assert.equal(matchShortcut(evt('z', { ctrlKey: true }), { isDialogOpen: true }), null);

  // Alt 组合键不误触发
  assert.equal(matchShortcut(evt('z', { ctrlKey: true, altKey: true })), null);
});
