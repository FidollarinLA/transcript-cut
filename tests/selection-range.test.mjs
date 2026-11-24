import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectionRangeStyle } from '../web/selection-range.js';

test('选区按片长换算成时间轴百分比', () => {
  const full = selectionRangeStyle(0, 2_000_000, 12_000_000);
  assert.ok(Math.abs(full.leftPct - 0) < 1e-9);
  assert.ok(Math.abs(full.widthPct - (2 / 12) * 100) < 1e-9);
  const marked = selectionRangeStyle(10_500_000, 11_500_000, 12_000_000);
  assert.ok(Math.abs(marked.leftPct - (10.5 / 12) * 100) < 1e-9);
  assert.ok(Math.abs(marked.widthPct - (1 / 12) * 100) < 1e-9);
  assert.ok(Math.abs(marked.leftPct + marked.widthPct - (11.5 / 12) * 100) < 1e-9);
});

test('起止颠倒或越界时不画出选区', () => {
  assert.equal(selectionRangeStyle(4_000_000, 4_000_000, 12_000_000), null);
  assert.equal(selectionRangeStyle(8_000_000, 4_000_000, 12_000_000), null);
  assert.equal(selectionRangeStyle(-1, 2_000_000, 12_000_000), null);
  assert.equal(selectionRangeStyle(10_000_000, 12_000_001, 12_000_000), null);
  assert.equal(selectionRangeStyle(0, 1, 0), null);
  assert.equal(selectionRangeStyle(Number.NaN, 1, 12), null);
});
