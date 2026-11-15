import { spawn } from 'node:child_process';
import { copyFile, link, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ffmpeg = process.env.FFMPEG_BIN ? resolve(process.env.FFMPEG_BIN) : 'ffmpeg';
const ffprobe = process.env.FFPROBE_BIN ? resolve(process.env.FFPROBE_BIN) : 'ffprobe';
const model = process.env.WHISPER_MODEL && resolve(process.env.WHISPER_MODEL);
export const hasModel = Boolean(model);
const second = 1_000_000;

export function run(program, args, { cwd, timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-2500); });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('媒体处理超时'));
      else if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `媒体进程退出，代码 ${code}`));
    });
  });
}

export async function probe(file) {
  const { format, streams } = JSON.parse(await run(ffprobe, [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', file,
  ]));
  const video = streams.filter(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.filter(s => s.codec_type === 'audio');
  if (!format.format_name.split(',').includes('mp4') || video.length !== 1 || audio.length !== 1
    || video[0].codec_name !== 'h264' || audio[0].codec_name !== 'aac') {
    throw new Error('请选择一条 H.264 视频轨和一条 AAC 音频轨的 MP4');
  }
  const [width, height] = [video[0].width, video[0].height];
  const [n, d] = video[0].avg_frame_rate.split('/').map(Number);
  const fps = n / d;
  const duration_us = Math.round(Number(format.duration) * second);
  if (!Number.isSafeInteger(duration_us) || duration_us <= 0 || duration_us > 3_600 * second
    || !Number.isFinite(fps) || fps <= 0 || fps > 60 || width % 2 || height % 2) {
    throw new Error('支持范围为一小时以内、最高 60 fps 且宽高为偶数的 MP4');
  }
  if ([format, video[0], audio[0]].some(s =>
    !Number.isFinite(Number(s.start_time)) || Math.abs(Number(s.start_time)) > 0.001)) {
    throw new Error('该视频的轨道起点不是 0 秒，请先转码后导入');
  }
  return { width, height, fps, duration_us, video_index: video[0].index, audio_index: audio[0].index };
}

function timestamp(hours, minutes, seconds, millis) {
  return (((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(millis)) * 1000;
}

export function parseSrt(input, duration) {
  const spans = [];
  const blocks = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n/);
  if (blocks.length === 1 && !blocks[0]) throw new Error('没有可导入的字幕，请检查是否识别到人声');
  if (blocks.length > 5000) throw new Error('字幕片段超过 5000 条');
  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const times = lines.shift()?.trim().match(/^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})\s+-->\s+(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})(?:\s+.*)?$/);
    const text = lines.join(' ').trim();
    if (!times || !text) throw new Error('SRT 包含无效时间码或空白字幕');
    const start_us = timestamp(...times.slice(1, 5));
    const end_us = timestamp(...times.slice(5, 9));
    if (!Number.isSafeInteger(end_us) || start_us >= duration || end_us <= start_us || end_us > duration + 100_000) {
      throw new Error('字幕时间超出视频范围，请检查字幕和视频是否匹配');
    }
    spans.push({ id: `span-${spans.length + 1}`, start_us, end_us: Math.min(end_us, duration), text });
  }
  return spans.sort((a, b) => a.start_us - b.start_us);
}

export async function makeDemo(file) {
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-n',
    '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=25:duration=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', file,
  ]);
}

export async function transcribe(file, taskDir, duration, language) {
  if (!model) throw new Error('请设置 WHISPER_MODEL 后重启，或直接导入 SRT');
  if (!['zh', 'en', 'auto'].includes(language)) throw new Error('转写语言无效');
  const localModel = resolve(taskDir, 'model.bin');
  try {
    await link(model, localModel);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) throw error;
    await copyFile(model, localModel);
  }
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000',
    '-af', `whisper=model=model.bin:destination=transcript.srt:language=${language}:queue=25:use_gpu=0:format=srt`,
    '-f', 'null', '-',
  ], { cwd: taskDir, timeout: 45 * 60_000 });
  const spans = parseSrt(await readFile(resolve(taskDir, 'transcript.srt'), 'utf8'), duration);
  return spans;
}

export function validateOutput(plan, metadata) {
  if (!plan.kept.length) throw new Error('成片没有保留片段');
  if (plan.kept.length > 100) throw new Error('当前版本最多导出 100 个保留片段');
  const frameUs = Math.floor(second / metadata.fps);
  if (plan.kept.some(s => s.end_us - s.start_us < frameUs)) {
    throw new Error('有保留片段短于平均一帧，请调整切点后导出');
  }
}

export async function probeFrameTimes(file, videoIndex) {
  const packets = await run(ffprobe, [
    '-v', 'error', '-select_streams', String(videoIndex),
    '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file,
  ]);
  const times = [];
  for (const line of packets.split('\n')) {
    const pts = line.split(',', 1)[0].trim();
    const us = Math.round(Number(pts) * second);
    if (pts && Number.isSafeInteger(us)) times.push(us);
  }
  if (!times.length) throw new Error('视频轨没有可定位的帧');
  return times.sort((a, b) => a - b);
}

export function validateVideoFrames(segments, frameTimes) {
  let frame = 0;
  for (const [index, segment] of segments.entries()) {
    while (frame < frameTimes.length && frameTimes[frame] < segment.start_us) frame++;
    if (!(frameTimes[frame] < segment.end_us)) {
      throw new Error(`第 ${index + 1} 个保留片段没有视频帧，请扩大区间或调整切点`);
    }
  }
}

export async function exportVideo(file, plan, target, metadata) {
  const filters = [
    videoFilter(plan.kept, metadata.video_index),
    ...audioFilters(plan.kept, metadata.audio_index, plan.output_duration_us),
  ];
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-n', '-i', file,
    '-filter_complex', filters.join(';'),
    '-map', '[outv]', '-map', '[outa]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-enc_time_base:v', '1:1000000', '-fps_mode', 'vfr', '-movflags', '+faststart', target,
  ], { timeout: 45 * 60_000 });
}

function videoFilter(segments, index) {
  const { start_us } = segments[0];
  const escape = expression => expression.replaceAll(',', '\\,');
  const keep = segments.map(s => `between(pts,${s.start_us},${s.end_us - 1})`).join('+');
  const shifted = s => `(PTS-(${s.start_us}-${s.output_start_us}))`;
  let mapped = shifted(segments.at(-1));
  for (let i = segments.length - 2; i >= 0; i--) {
    const segment = segments[i];
    mapped = `if(lt(PTS,${segment.end_us}),${shifted(segment)},${mapped})`;
  }
  // Anchor every frame to the plan so encoder rounding does not accumulate at each cut.
  const pts = `${mapped}-(STARTPTS-${start_us})`;
  return `[0:${index}]settb=AVTB,select=${escape(keep)},setpts=${escape(pts)}[outv]`;
}

function audioFilters(segments, index, duration) {
  const seconds = us => (us / second).toFixed(6);
  const length = seconds(duration);
  const finish = `apad=whole_dur=${length},atrim=duration=${length}[outa]`;
  const count = segments.length;
  const filters = [];
  if (count > 1) {
    const branches = segments.map((_, i) => `[a${i}]`).join('');
    filters.push(`[0:${index}]asplit=${count}${branches}`);
  }
  for (const [i, segment] of segments.entries()) {
    const trim = `start=${seconds(segment.start_us)}:end=${seconds(segment.end_us)}`;
    const input = count > 1 ? `[a${i}]` : `[0:${index}]`;
    const output = count > 1 ? `[ca${i}]` : `,${finish}`;
    filters.push(`${input}atrim=${trim},asetpts=PTS-STARTPTS${output}`);
  }
  if (count > 1) {
    const clips = segments.map((_, i) => `[ca${i}]`).join('');
    filters.push(`${clips}concat=n=${count}:v=0:a=1,${finish}`);
  }
  return filters;
}
