import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreStatus } from '../web/restore-status.js';

test('错源恢复被拒绝，并说明当前编辑未改动', () => {
  const message = restoreStatus({ matched: false, cursor: 2 });
  assert.match(message, /项目与当前视频不匹配/);
  assert.match(message, /当前编辑未改动/);
  assert.doesNotMatch(message, /校验通过/);
});

test('同源恢复说明校验通过和可撤销步数', () => {
  assert.equal(
    restoreStatus({ matched: true, cursor: 2 }),
    '源视频校验通过。转写稿、剪点和撤销记录已恢复。可撤销 2 步。',
  );
  assert.match(restoreStatus({ matched: true, cursor: 0 }), /当前没有可撤销的编辑/);
  assert.doesNotMatch(restoreStatus({ matched: true, cursor: 1.5 }), /可撤销/);
});
