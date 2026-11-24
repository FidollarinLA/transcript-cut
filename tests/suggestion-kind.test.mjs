import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  suggestionMeta,
  summarizeSuggestions,
  visibleSuggestions,
} from '../web/suggestion-kind.js';

const items = [
  { kind: 'filler', start_us: 1 },
  { kind: 'repeat', start_us: 2 },
  { kind: 'pause', start_us: 3 },
  { kind: 'mystery', start_us: 4 },
];

test('已知类型有文字徽标，未知类型回退为建议', () => {
  assert.deepEqual(suggestionMeta('filler'), { id: 'filler', label: '口头禅' });
  assert.deepEqual(suggestionMeta('repeat'), { id: 'repeat', label: '重复句' });
  assert.deepEqual(suggestionMeta('pause'), { id: 'pause', label: '长停顿' });
  assert.deepEqual(suggestionMeta('mystery'), { id: 'other', label: '建议' });
  assert.deepEqual(suggestionMeta(undefined), { id: 'other', label: '建议' });
});

test('分类计数和筛选不改原列表', () => {
  assert.deepEqual(summarizeSuggestions(items), {
    all: 4, filler: 1, repeat: 1, pause: 1, other: 1,
  });
  assert.deepEqual(summarizeSuggestions([]), {
    all: 0, filler: 0, repeat: 0, pause: 0, other: 0,
  });
  assert.deepEqual(visibleSuggestions(items, 'pause').map(item => item.start_us), [3]);
  assert.deepEqual(visibleSuggestions(items, 'other').map(item => item.kind), ['mystery']);
  assert.equal(visibleSuggestions(items, 'all').length, 4);
  assert.equal(visibleSuggestions(items, 'filler').length, 1);
  assert.equal(items.length, 4);
});
