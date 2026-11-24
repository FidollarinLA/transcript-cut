import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seekUsInBar } from '../web/seek-bar.js';

const start = 4_000_000;
const end = 12_000_000;

test('时间轴段内点击落在半开区间，不落到段尾', () => {
  assert.equal(seekUsInBar(start, end, 0, 200), start);
  assert.equal(seekUsInBar(start, end, -4, 200), start);
  assert.equal(seekUsInBar(start, end, 200, 200), end - 1);
  assert.equal(seekUsInBar(start, end, 240, 200), end - 1);
  assert.equal(seekUsInBar(start, end, 100, 200), 8_000_000);
  assert.ok(seekUsInBar(start, end, 199, 200) < end);
  assert.ok(seekUsInBar(start, end, 199, 200) > start);
  assert.equal(seekUsInBar(start, end, 10, 0), start);
  assert.equal(seekUsInBar(0, 1, 1, 1), 0);
});
