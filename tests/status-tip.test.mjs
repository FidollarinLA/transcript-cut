import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendTrackDurationTip } from '../web/status-tip.js';

const imported = '视频已导入。可以导入同源 SRT 或自动转写。';
const demo = '样例已就绪。请选择一行，复听后剪掉，再导出。';
const tip = (video, audio) => `视频轨 ${video}，音频轨 ${audio}，相差超过 0.1 秒。`;

test('音视频轨相差超过 100 毫秒才在导入状态中显示两轨时长', () => {
  assert.equal(
    appendTrackDurationTip(imported, 6_000_000, 4_000_000),
    `${imported}${tip('00:06.000', '00:04.000')}`,
  );
  assert.equal(
    appendTrackDurationTip(imported, 4_000_000, 6_100_000),
    `${imported}${tip('00:04.000', '00:06.100')}`,
  );
  assert.equal(appendTrackDurationTip(imported, 6_000_000, 6_100_000), imported);
  assert.equal(appendTrackDurationTip(imported, 6_100_000, 6_000_000), imported);
  assert.equal(
    appendTrackDurationTip(demo, 12_000_000, 12_100_001),
    `${demo}${tip('00:12.000', '00:12.100')}`,
  );
  assert.equal(appendTrackDurationTip(demo, 12_000_000, 12_100_000), demo);
  assert.equal(appendTrackDurationTip(imported, 25_200_000, 25_200_000), imported);
  for (const missing of [0, -1, 1.5, null, undefined, Number.NaN]) {
    assert.equal(appendTrackDurationTip(imported, missing, 6_000_000), imported);
    assert.equal(appendTrackDurationTip(imported, 6_000_000, missing), imported);
  }
});

test('新的导入在 100 毫秒以内时不再保留上一次的音视频时长提示', () => {
  const warned = appendTrackDurationTip(imported, 25_200_000, 22_964_000);
  assert.equal(warned, `${imported}${tip('00:25.200', '00:22.964')}`);
  const cleared = appendTrackDurationTip(imported, 12_000_000, 12_050_000);
  assert.equal(cleared, imported);
  assert.doesNotMatch(cleared, /00:25\.200|00:22\.964|视频轨|音频轨/);
  const replaced = appendTrackDurationTip(demo, 8_000_000, 8_000_000);
  assert.equal(replaced, demo);
  assert.doesNotMatch(replaced, /00:25\.200|00:22\.964/);
});
