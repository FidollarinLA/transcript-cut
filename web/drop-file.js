/**
 * 判断一次拖放里应该走视频、字幕还是项目恢复。
 * 只看文件名和 MIME，不读取内容；真正的导入仍走与按钮相同的请求。
 */
export function classifyDrop(files) {
  const list = [...(files || [])];
  if (list.length === 0) return { error: '没有读到可导入的文件。' };
  if (list.length > 1) return { error: '一次只能拖入一个 MP4、SRT 或项目 JSON。' };
  const file = list[0];
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  let kind = '';
  if (name.endsWith('.mp4') || type === 'video/mp4') kind = 'video';
  else if (name.endsWith('.srt')) kind = 'srt';
  else if (name.endsWith('.json') || type === 'application/json') kind = 'project';
  if (!kind) return { error: '请拖入 MP4、SRT 或项目 JSON。' };
  return { kind, file };
}
