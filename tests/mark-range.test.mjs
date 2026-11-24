import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markRangeFromPlayhead } from '../web/mark-range.js';

const durationUs = 12_000_000;

test('播放头可以写入半开的起点或终点', () => {
  assert.deepEqual(markRangeFromPlayhead({
    side: 'start', currentUs: 10_500_000, startUs: 10_000_000, endUs: 12_000_000, durationUs,
  }), { startUs: 10_500_000, endUs: 12_000_000 });
  assert.deepEqual(markRangeFromPlayhead({
    side: 'end', currentUs: 11_500_000, startUs: 10_500_000, endUs: 12_000_000, durationUs,
  }), { startUs: 10_500_000, endUs: 11_500_000 });
  assert.deepEqual(markRangeFromPlayhead({
    side: 'start', currentUs: 0, startUs: 1, endUs: durationUs, durationUs,
  }), { startUs: 0, endUs: durationUs });
  assert.deepEqual(markRangeFromPlayhead({
    side: 'end', currentUs: durationUs, startUs: 10_500_000, endUs: 11_000_000, durationUs,
  }), { startUs: 10_500_000, endUs: durationUs });
});

test('越界或起止颠倒时拒绝，且不交换起止', () => {
  assert.deepEqual(markRangeFromPlayhead({
    side: 'start', currentUs: 12_000_000, startUs: 10_000_000, endUs: 11_000_000, durationUs,
  }), { error: '当前位置需早于终点' });
  assert.deepEqual(markRangeFromPlayhead({
    side: 'end', currentUs: 10_000_000, startUs: 10_500_000, endUs: 11_500_000, durationUs,
  }), { error: '当前位置需晚于起点' });
  assert.deepEqual(markRangeFromPlayhead({
    side: 'end', currentUs: 12_000_001, startUs: 10_000_000, endUs: 11_000_000, durationUs,
  }), { error: '超出视频范围' });
  assert.deepEqual(markRangeFromPlayhead({
    side: 'start', currentUs: -1, startUs: 0, endUs: 1_000_000, durationUs,
  }), { error: '超出视频范围' });
  const swapped = markRangeFromPlayhead({
    side: 'end', currentUs: 9_000_000, startUs: 10_000_000, endUs: 11_000_000, durationUs,
  });
  assert.equal(swapped.error, '当前位置需晚于起点');
  assert.equal(swapped.startUs, undefined);
});
