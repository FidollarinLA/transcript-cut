import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobPollError, jobStageText } from '../web/job-status.js';

test('任务阶段用真实文案，未知阶段只说明不确定', () => {
  const texts = [
    jobStageText('export', 'check'),
    jobStageText('export', 'encode'),
    jobStageText('export', 'write'),
    jobStageText('transcribe', 'transcribe'),
    jobStageText('transcribe', 'finish'),
    jobStageText('export', 'mystery'),
    jobStageText('other', 'encode'),
    jobStageText(undefined, undefined),
  ];
  assert.deepEqual(texts, [
    '正在核对保留片段',
    '正在编码成片，完成时间不确定',
    '正在保存成片和字幕',
    '正在本机转写，完成时间不确定',
    '正在整理转写结果',
    '正在处理，完成时间不确定',
    '正在处理，完成时间不确定',
    '正在处理，完成时间不确定',
  ]);
  for (const text of texts) assert.doesNotMatch(text, /%/);
});

test('轮询的网络和无法解析响应有可读说明', () => {
  assert.equal(jobPollError(new TypeError('Failed to fetch')), '网络中断，任务状态暂时无法确认');
  assert.equal(jobPollError(new Error('')), '网络中断，任务状态暂时无法确认');
  let parsed;
  try {
    JSON.parse('not-json');
  } catch (error) {
    parsed = error;
  }
  assert.equal(jobPollError(parsed), '任务状态暂时无法读取');
  assert.equal(jobPollError(new Error('导出未能完成')), '导出未能完成');
});
