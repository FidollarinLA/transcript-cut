import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDrop } from '../web/drop-file.js';

const file = (name, type = '') => ({ name, type });

test('按扩展名区分 MP4、SRT 和项目 JSON', () => {
  assert.equal(classifyDrop([file('Clip.MP4')]).kind, 'video');
  assert.equal(classifyDrop([file('notes.srt', 'text/plain')]).kind, 'srt');
  assert.equal(classifyDrop([file('文字剪视频.transcript-cut.json')]).kind, 'project');
});

test('没有扩展名时接受与文件按钮相同的 MIME', () => {
  assert.equal(classifyDrop([file('capture', 'video/mp4')]).kind, 'video');
  assert.equal(classifyDrop([file('project', 'application/json')]).kind, 'project');
});

test('空拖放、多个文件和无法识别的类型给出可展示的错误', () => {
  assert.match(classifyDrop([]).error, /没有读到可导入的文件/);
  assert.match(classifyDrop([file('a.mp4'), file('b.srt')]).error, /一次只能拖入一个/);
  assert.match(classifyDrop([file('notes.txt', 'text/plain')]).error, /请拖入 MP4、SRT 或项目 JSON/);
});

test('SRT 扩展名优先于容易标错的 JSON 类型', () => {
  assert.equal(classifyDrop([file('captions.srt', 'application/json')]).kind, 'srt');
});
