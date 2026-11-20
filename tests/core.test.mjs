import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatch } from '../_build/js/release/build/core/core.js';
import { parseSrt } from '../server/media.mjs';
import { calculateEdit } from '../web/edit-core.js';

const span = (id, start_us, end_us, text) => ({ id, start_us, end_us, text });
const cut = (start_us, end_us) => ({ kind: 'cut', span_id: '', start_us, end_us, text: '' });
const correct = (span_id, text) => ({ kind: 'correct', span_id, start_us: 0, end_us: 0, text });
const calculate = (fields = {}) => calculateEdit(dispatch, {
  duration_us: 12_000_000,
  spans: [],
  history: { operations: [], cursor: 0 },
  operation: null,
  action: 'plan',
  ...fields,
});

test('合并重叠及相邻删除段，保留区间映射到输出起点', () => {
  const result = calculate({
    history: { cursor: 4, operations: [
      cut(8_000_000, 9_000_000), cut(2_000_000, 4_000_000), cut(3_500_000, 4_500_000), cut(4_500_000, 5_000_000),
    ] },
  });
  assert.deepEqual(result.plan.deleted, [
    { start_us: 2_000_000, end_us: 5_000_000 }, { start_us: 8_000_000, end_us: 9_000_000 },
  ]);
  assert.deepEqual(result.plan.kept, [
    { start_us: 0, end_us: 2_000_000, output_start_us: 0 },
    { start_us: 5_000_000, end_us: 8_000_000, output_start_us: 2_000_000 },
    { start_us: 9_000_000, end_us: 12_000_000, output_start_us: 5_000_000 },
  ]);
  assert.equal(result.plan.output_duration_us, 8_000_000);
});

test('撤销、重做和撤销后新分支遵循同一编辑历史', () => {
  const first = calculate({ action: 'apply', operation: cut(0, 2_000_000) });
  assert.equal(first.plan.output_duration_us, 10_000_000);
  const undone = calculate({ action: 'undo', history: first.history });
  assert.equal(undone.plan.output_duration_us, 12_000_000);
  const redone = calculate({ action: 'redo', history: undone.history });
  assert.equal(redone.plan.output_duration_us, 10_000_000);
  const branch = calculate({ action: 'apply', history: undone.history, operation: cut(0, 1_000_000) });
  assert.equal(branch.history.operations.length, 1);
  assert.equal(calculate({ action: 'redo', history: branch.history }).plan.output_duration_us, 11_000_000);
});

test('删掉片段后重排字幕，部分切断时标记复核，修字不裁音频', () => {
  const spans = [
    span('missing', 0, 1_000_000, '已删'),
    span('partial', 1_000_000, 3_000_000, '时标不精确'),
    span('keep', 4_000_000, 6_000_000, '保留'),
  ];
  const result = calculate({
    spans,
    history: { operations: [cut(0, 2_000_000), correct('keep', '更正')], cursor: 2 },
  });
  assert.deepEqual(result.plan.partial_span_ids, ['partial']);
  assert.deepEqual(result.plan.captions, [span('keep', 2_000_000, 4_000_000, '更正')]);
  assert.equal(result.plan.srt, '1\n00:00:02,000 --> 00:00:04,000\n更正\n\n');
  assert.equal(result.plan.output_duration_us, 10_000_000);
});

test('整段删空可以撤销，非法边界和坏 JSON 有错误信息', () => {
  const full = calculate({ action: 'apply', operation: cut(0, 12_000_000) });
  assert.deepEqual(full.plan.kept, []);
  assert.equal(calculate({ action: 'undo', history: full.history }).plan.output_duration_us, 12_000_000);
  assert.match(calculate({ action: 'apply', operation: cut(-1, 7) }).error, /区间/);
  assert.throws(() => calculate({ action: 'apply', operation: cut(1, 7.5) }), /整数微秒/);
  assert.match(JSON.parse(dispatch('{')).error, /无法解析/);
});

test('口头禅、重复、停顿均为候选，不更改剪辑计划，并带有可解释原因', () => {
  const result = calculate({ spans: [
    span('a', 0, 1_000_000, '嗯。'),
    span('b', 4_000_000, 5_000_000, '这是一句。'),
    span('c', 5_500_000, 6_500_000, '这是一句。'),
  ] });
  assert.deepEqual(result.suggestions.map(s => s.kind), ['filler', 'pause', 'repeat']);
  assert.deepEqual(result.suggestions.map(s => s.reason), ['口头禅「嗯」', '「嗯」与「这是一句」之间长停顿 3.0 秒', '重复句「这是一句」']);
  assert.deepEqual(result.plan.deleted, []);
});

test('三类建议原因可解释且保留时标边界安全', () => {
  const result = calculate({ spans: [
    span('s1', 2_000_000, 3_000_000, '那个'),
    span('s2', 5_500_000, 6_500_000, '我们开始吧！'),
    span('s3', 6_600_000, 7_600_000, '我们开始吧。'),
  ] });
  const pause = result.suggestions.find(s => s.kind === 'pause');
  assert.equal(pause.reason, '片头长停顿 2.0 秒');
  assert.equal(pause.start_us, 250_000);
  assert.equal(pause.end_us, 1_750_000);

  const filler = result.suggestions.find(s => s.kind === 'filler');
  assert.equal(filler.span_id, 's1');
  assert.equal(filler.reason, '口头禅「那个」');

  const repeat = result.suggestions.find(s => s.kind === 'repeat');
  assert.equal(repeat.span_id, 's3');
  assert.equal(repeat.reason, '重复句「我们开始吧」');
});

test('SRT 适配器识别 UTF-8 BOM、CRLF、边界误差和坏时间码', () => {
  assert.deepEqual(parseSrt('\ufeff1\r\n00:00:00,100 --> 00:00:01,040\r\n你好\r\n', 1_000_000),
    [span('span-1', 100_000, 1_000_000, '你好')]);
  assert.throws(() => parseSrt('1\n00:00:91,100 --> 00:00:01,040\n你好', 1_000_000));
});
