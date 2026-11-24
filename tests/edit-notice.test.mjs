import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editActionNotice } from '../web/edit-notice.js';

const review = '1 句被切点截断，已从成片字幕略去。';

test('没有截断复核时说明刚才的剪辑操作', () => {
  assert.equal(editActionNotice({
    action: 'apply',
    operation: { kind: 'cut' },
    outputDurationLabel: '00:10.000',
  }), '已剪掉区间。成片预计 00:10.000。');
  assert.equal(editActionNotice({
    action: 'apply',
    operation: { kind: 'cut' },
  }), '已剪掉区间。');
  assert.equal(editActionNotice({ action: 'undo' }), '已撤销。');
  assert.equal(editActionNotice({ action: 'redo' }), '已重做。');
  const corrected = editActionNotice({ action: 'apply', operation: { kind: 'correct' } });
  assert.equal(corrected, '文字已修正。');
  assert.doesNotMatch(corrected, /错误|失败/);
});

test('有截断复核时只保留复核说明', () => {
  for (const action of ['apply', 'undo', 'redo']) {
    const operation = action === 'apply' ? { kind: 'cut' } : null;
    const text = editActionNotice({
      action,
      operation,
      reviewMessage: review,
      outputDurationLabel: '00:09.000',
    });
    assert.equal(text, review);
    assert.doesNotMatch(text, /已剪掉|已撤销|已重做|文字已修正/);
  }
  assert.equal(editActionNotice({
    action: 'apply',
    operation: { kind: 'correct' },
    reviewMessage: `  ${review}  `,
  }), review);
});
