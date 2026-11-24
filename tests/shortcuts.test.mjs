import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isEditableElement, matchShortcut, shortcutHelp } from '../web/shortcuts.js';

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
  assert.equal(matchShortcut(evt('i')), 'mark-start');
  assert.equal(matchShortcut(evt('I')), 'mark-start');
  assert.equal(matchShortcut(evt('o')), 'mark-end');
  assert.equal(matchShortcut(evt('O')), 'mark-end');
  assert.equal(matchShortcut(evt('i', { shiftKey: true })), null);
  assert.equal(matchShortcut(evt('I', { ctrlKey: true })), null);
  assert.equal(matchShortcut(evt('o', { altKey: true })), null);
  assert.equal(matchShortcut(evt('O', { metaKey: true })), null);
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
    isComposing: Boolean(opts.isComposing),
    target: opts.target || { tagName: 'BODY', getAttribute: () => null },
  });

  // 输入框内不拦截
  assert.equal(matchShortcut(evt(' ', { target: editableTarget })), null);
  assert.equal(matchShortcut(evt('Delete', { target: editableTarget })), null);
  assert.equal(matchShortcut(evt('i', { target: editableTarget })), null);
  assert.equal(matchShortcut(evt('o', { target: { tagName: 'INPUT', type: 'text', getAttribute: () => null } })), null);
  assert.equal(matchShortcut(evt('I'), { isDialogOpen: true }), null);
  assert.equal(matchShortcut(evt('O', { isComposing: true })), null);
  assert.equal(matchShortcut(evt('z', { ctrlKey: true, target: textareaTarget })), null);

  // 弹窗处于打开状态时不拦截
  assert.equal(matchShortcut(evt(' '), { isDialogOpen: true }), null);
  assert.equal(matchShortcut(evt('Delete'), { isDialogOpen: true }), null);
  assert.equal(matchShortcut(evt('z', { ctrlKey: true }), { isDialogOpen: true }), null);

  // Alt 组合键不误触发
  assert.equal(matchShortcut(evt('z', { ctrlKey: true, altKey: true })), null);
});

test('问号打开帮助，输入法、修饰键、弹窗和输入框都不会误开', () => {
  const evt = (key, opts = {}) => ({
    key,
    ctrlKey: Boolean(opts.ctrlKey),
    metaKey: Boolean(opts.metaKey),
    shiftKey: Boolean(opts.shiftKey),
    altKey: Boolean(opts.altKey),
    isComposing: Boolean(opts.isComposing),
    target: opts.target || { tagName: 'BODY', getAttribute: () => null },
  });
  const field = { tagName: 'INPUT', type: 'number', getAttribute: () => null };

  assert.equal(matchShortcut(evt('?')), 'help');
  assert.equal(matchShortcut(evt('?', { shiftKey: true })), 'help');
  assert.equal(matchShortcut(evt('/', { shiftKey: true })), 'help');
  assert.equal(matchShortcut(evt('？')), 'help');
  assert.equal(matchShortcut(evt('/')), null);
  assert.equal(matchShortcut(evt('?', { ctrlKey: true })), null);
  assert.equal(matchShortcut(evt('?', { altKey: true })), null);
  assert.equal(matchShortcut(evt('?', { isComposing: true })), null);
  assert.equal(matchShortcut(evt('Process')), null);
  assert.equal(matchShortcut(evt('?'), { isDialogOpen: true }), null);
  assert.equal(matchShortcut(evt('?', { target: field })), null);
});

test('帮助清单与真实键位返回的动作一致', () => {
  const evt = (key, opts = {}) => ({
    key,
    ctrlKey: Boolean(opts.ctrlKey),
    metaKey: Boolean(opts.metaKey),
    shiftKey: Boolean(opts.shiftKey),
    altKey: Boolean(opts.altKey),
    target: { tagName: 'BODY', getAttribute: () => null },
  });
  const found = new Set();
  const remember = action => { if (action) found.add(action); };
  for (const key of [' ', 'Spacebar', 'k', 'K', 'j', 'J', 'l', 'L', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace', 'Escape', '?', '？', '/', 'i', 'I', 'o', 'O']) {
    remember(matchShortcut(evt(key)));
    remember(matchShortcut(evt(key, { shiftKey: true })));
  }
  for (const key of ['z', 'Z', 'y', 'Y']) {
    remember(matchShortcut(evt(key, { ctrlKey: true })));
    remember(matchShortcut(evt(key, { metaKey: true })));
    remember(matchShortcut(evt(key, { ctrlKey: true, shiftKey: true })));
    remember(matchShortcut(evt(key, { metaKey: true, shiftKey: true })));
  }
  const documented = new Set(shortcutHelp.flatMap(group => group.rows.flatMap(row => row.actions)));
  assert.deepEqual([...found].sort(), [...documented].sort());
  for (const group of shortcutHelp) {
    assert.ok(group.title);
    for (const row of group.rows) {
      assert.ok(row.keys.length > 0);
      assert.ok(row.label);
    }
  }
  assert.ok(shortcutHelp.some(group => group.rows.some(row => row.keys.includes('Shift + 点击') && row.actions.length === 0)));
});
