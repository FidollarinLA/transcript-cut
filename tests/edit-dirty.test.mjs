import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreStatus } from '../web/restore-status.js';
import {
  assetReplacePrompt,
  editSignature,
  isEditDirty,
  leavePromptNeeded,
  replaceCancelledNotice,
  restoreNoticeClearsDirty,
  saveNoticeClearsDirty,
  transcriptReplacePrompt,
} from '../web/edit-dirty.js';

const spans = [{ start_us: 0, end_us: 1_000_000, text: '原句' }];
const savedHistory = { operations: [{ kind: 'cut' }], cursor: 1 };

test('已保存的剪辑和撤销回原样都不算未保存', () => {
  const saved = editSignature(spans, savedHistory);
  assert.equal(isEditDirty(spans, savedHistory, saved), false);
  assert.equal(isEditDirty(spans, { operations: [{ kind: 'cut' }], cursor: 0 }, saved), true);
  assert.equal(isEditDirty([{ ...spans[0], text: '改过' }], savedHistory, saved), true);
  assert.equal(leavePromptNeeded(false), false);
  assert.equal(leavePromptNeeded(true), true);
});

test('只有成功的保存和同源恢复会清掉脏状态', () => {
  const restored = restoreStatus({ matched: true, cursor: 2 });
  const mismatched = restoreStatus({ matched: false, cursor: 2 });
  assert.equal(restoreNoticeClearsDirty(restored, false), true);
  assert.equal(restoreNoticeClearsDirty(mismatched, false), false);
  assert.equal(restoreNoticeClearsDirty(restored, true), false);
  assert.equal(saveNoticeClearsDirty('项目文件已生成。恢复时请先导入同一个原视频。', false), true);
  assert.equal(saveNoticeClearsDirty('项目文件已生成。恢复时请先导入同一个原视频。', true), false);
  assert.equal(saveNoticeClearsDirty('无法创建项目文件', false), false);
});

test('替换转写稿仍使用原来的确认文案', () => {
  assert.equal(transcriptReplacePrompt, '替换转写稿会清空当前编辑，继续吗？');
  assert.match(assetReplacePrompt, /尚未保存/);
  assert.match(replaceCancelledNotice, /当前编辑未改动/);
  assert.notEqual(assetReplacePrompt, transcriptReplacePrompt);
});
