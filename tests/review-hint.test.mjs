import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partialReview } from '../web/review-hint.js';

const spans = [
  { id: 'early', start_us: 1_500_000, end_us: 2_500_000, text: '前一句' },
  { id: 'later', start_us: 4_000_000, end_us: 5_000_000, text: '后一句' },
];

test('没有被切点截断的句子时不显示复核提示', () => {
  assert.equal(partialReview(spans, []), null);
  assert.equal(partialReview(spans, ['missing']), null);
});

test('复核提示按字幕顺序定位第一句被截断的源时间', () => {
  const review = partialReview(spans, ['later', 'early']);
  assert.equal(review.count, 2);
  assert.equal(review.startUs, 1_500_000);
  assert.equal(review.message, '2 句被切点截断，已从成片字幕略去。');
  assert.equal(review.locateLabel, '定位 00:01.500');
});
