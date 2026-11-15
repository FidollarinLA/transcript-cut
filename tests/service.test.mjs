import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { exportVideo, probe, probeFrameTimes, run, validateVideoFrames } from '../server/media.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('本机 API 导入、对照原始媒体、导出 MP4/SRT 并重试', { timeout: 90_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'transcript-cut-test-'));
  const service = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
  });
  const exit = once(service, 'exit');
  t.after(async () => {
    service.kill();
    await exit;
    await rm(dir, { recursive: true, force: true });
  });
  const [startup] = await Promise.race([
    once(service.stdout, 'data'),
    exit.then(([code]) => { throw new Error(`服务器启动失败 ${code}`); }),
  ]);
  const base = startup.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  async function post(path, body, status) {
    const response = await fetch(base + path, { method: 'POST', body });
    const value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value;
  }
  async function waitJob(id) {
    for (let attempts = 0; attempts < 400; attempts++) {
      const status = await (await fetch(`${base}/api/jobs/${id}`)).json();
      if (status.state !== 'running') {
        assert.equal(status.state, 'done', JSON.stringify(status));
        return status;
      }
      await delay(150);
    }
    assert.fail('媒体处理超时');
  }
  const demo = await post('/api/demo', undefined, 201);
  assert.equal(demo.duration_us, 12_000_000);
  const range = await fetch(base + demo.media_url, { headers: { Range: 'bytes=0-31' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 32);
  const original = Buffer.from(await (await fetch(base + demo.media_url)).arrayBuffer());
  assert.equal(demo.sha256, digest(original));
  const asset = await post('/api/assets', original, 201);
  assert.equal(asset.sha256, demo.sha256);
  const { spans } = await post(`/api/assets/${asset.id}/srt`, await readFile('tests/demo.srt'), 200);
  const operations = [2, 9].map((start, i) => ({
    kind: 'cut', span_id: '', start_us: start * 1_000_000,
    end_us: [4, 10][i] * 1_000_000, text: '',
  }));
  const endpoint = `/api/assets/${asset.id}/export`;
  await post(endpoint, JSON.stringify({
    spans, history: { cursor: 1, operations: [{ ...operations[0], start_us: 0, end_us: demo.duration_us }] },
  }), 400);
  const tooShort = await post(endpoint, JSON.stringify({
    spans, history: { cursor: 1, operations: [{ ...operations[0], start_us: 20_000, end_us: demo.duration_us }] },
  }), 400);
  assert.match(tooShort.error, /短于平均一帧/);
  const request = JSON.stringify({ spans, history: { cursor: 2, operations } });
  const { id } = await post(endpoint, request, 202);
  await post(endpoint, request, 400);
  const job = await waitJob(id);
  assert.equal(job.result.duration_us, 9_000_000);
  const movieURL = `${base}/api/jobs/${id}/cut.mp4`;
  const movie = await fetch(movieURL);
  assert.equal(movie.status, 200);
  const output = join(dir, '输出 成片.mp4');
  await writeFile(output, Buffer.from(await movie.arrayBuffer()));
  const metadata = await probe(output);
  assert(Math.abs(metadata.duration_us - 9_000_000) < 50_000, JSON.stringify(metadata));
  t.diagnostic(`成片实测 ${metadata.duration_us / 1e6}s，计划 9s`);
  const subtitles = await (await fetch(`${base}/api/jobs/${id}/captions.srt`)).text();
  assert.match(subtitles, /00:00:07,000 --> 00:00:09,000/);
  assert.doesNotMatch(subtitles, /呃/);
  const retry = await post(endpoint, request, 202);
  assert.notEqual(retry.id, id);
  await waitJob(retry.id);
  assert.equal((await fetch(movieURL)).status, 200);
  const stillOriginal = await (await fetch(base + asset.media_url)).arrayBuffer();
  assert.equal(digest(Buffer.from(stillOriginal)), digest(original));

  if (process.env.WHISPER_TEST_INPUT && process.env.WHISPER_MODEL) {
    const bytes = await readFile(resolve(process.env.WHISPER_TEST_INPUT));
    const speech = await post('/api/assets', bytes, 201);
    const task = await post(`/api/assets/${speech.id}/transcribe`, JSON.stringify({ language: 'zh' }), 202);
    const { result } = await waitJob(task.id);
    assert(result.spans.length >= 2);
    const expected = new RegExp(process.env.WHISPER_TEST_PATTERN || '視頻|视频');
    assert.match(result.spans.map(s => s.text).join(''), expected);
    t.diagnostic(`本机 Whisper 实际生成 ${result.spans.length} 段中文转写`);
    const [first] = result.spans;
    const edited = await post(`/api/assets/${speech.id}/export`, JSON.stringify({
      spans: result.spans,
      history: { cursor: 1, operations: [{ ...operations[0], start_us: first.start_us, end_us: first.end_us }] },
    }), 202);
    const exported = await waitJob(edited.id);
    assert.equal(exported.result.duration_us, speech.duration_us - first.end_us + first.start_us);
    const realSrt = await (await fetch(`${base}/api/jobs/${edited.id}/captions.srt`)).text();
    assert(!realSrt.includes(first.text));
    const realVideo = await fetch(`${base}/api/jobs/${edited.id}/cut.mp4`);
    assert.equal(realVideo.status, 200);
    const realOutput = join(dir, '中文转写 成片.mp4');
    await writeFile(realOutput, Buffer.from(await realVideo.arrayBuffer()));
    const realMetadata = await probe(realOutput);
    assert(Math.abs(realMetadata.duration_us - exported.result.duration_us) < 50_000);
    t.diagnostic(`中文素材 ${speech.duration_us / 1e6}s，剪除首句 ${(first.end_us - first.start_us) / 1e6}s，成片实测 ${realMetadata.duration_us / 1e6}s`);
  }
});

test('导出保留实际的源画面，切除不同颜色的中段', { timeout: 30_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'transcript-cut-frames-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ffmpeg = process.env.FFMPEG_BIN ? resolve(process.env.FFMPEG_BIN) : 'ffmpeg';
  const source = join(dir, '三色 原片.mp4');
  const cut = join(dir, '两色 成片.mp4');
  await run(ffmpeg, [
    '-v', 'error',
    '-f', 'lavfi', '-i', 'color=black:s=160x90:r=30:d=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
    '-vf', "drawbox=c=red:t=fill:enable='lt(t,2)',drawbox=c=white:t=fill:enable='gte(t,2)*lt(t,4)',drawbox=c=blue:t=fill:enable='gte(t,4)'",
    '-af', "volume=5:enable='gte(t,2)*lt(t,4)'",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source,
  ]);
  await exportVideo(source, { kept: [
    { start_us: 0, end_us: 2_000_000, output_start_us: 0 },
    { start_us: 4_000_000, end_us: 6_000_000, output_start_us: 2_000_000 },
  ], output_duration_us: 4_000_000 }, cut, await probe(source));
  async function luma(file, time) {
    const value = await run(ffmpeg, [
      '-v', 'error', '-ss', String(time), '-i', file, '-an',
      '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
      '-frames:v', '1', '-f', 'null', '-',
    ]);
    return Number(value.match(/YAVG=([\d.]+)/)?.[1]);
  }
  const before = await luma(source, 1);
  const removed = await luma(source, 3);
  const after = await luma(source, 5);
  assert(before > 50 && removed > 200 && after < 50);
  assert.equal(await luma(cut, 1), before);
  assert.equal(await luma(cut, 2), after);
  assert.equal(await luma(cut, 3), after);
  async function rms(file, time) {
    const value = await run(ffmpeg, [
      '-v', 'error', '-ss', String(time), '-i', file, '-vn', '-t', '0.2',
      '-af', 'astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
      '-f', 'null', '-',
    ]);
    return Number(value.match(/RMS_level=(-?[\d.]+)/)?.[1]);
  }
  const quiet = await rms(source, 1);
  const loud = await rms(source, 3);
  assert(loud > quiet + 10);
  assert(Math.abs(await rms(cut, 3) - quiet) <= 2);
  const metadata = await probe(cut);
  assert(Math.abs(metadata.duration_us - 4_000_000) < 35_000, JSON.stringify(metadata));
  t.diagnostic(`30fps 样片切除了指定画面与响声，输出 ${metadata.duration_us / 1e6}s`);
});

test('40 个非整帧保留段的成片误差不累积', { timeout: 30_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'transcript-cut-dense-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ffmpeg = process.env.FFMPEG_BIN ? resolve(process.env.FFMPEG_BIN) : 'ffmpeg';
  const ffprobe = process.env.FFPROBE_BIN ? resolve(process.env.FFPROBE_BIN) : 'ffprobe';
  const source = join(dir, 'source.mp4');
  const output = join(dir, 'output.mp4');
  await run(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=25:d=12',
    '-f', 'lavfi', '-i', 'sine=frequency=250:sample_rate=48000:duration=12',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source,
  ]);
  const kept = Array.from({ length: 40 }, (_, i) => ({
    start_us: i * 240_000, end_us: i * 240_000 + 75_000, output_start_us: i * 75_000,
  }));
  await exportVideo(source, { kept, output_duration_us: 3_000_000 }, output, await probe(source));
  const { streams } = JSON.parse(await run(ffprobe, [
    '-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', output,
  ]));
  const durationOf = type => Number(streams.find(stream => stream.codec_type === type)?.duration);
  const video = durationOf('video');
  const audio = durationOf('audio');
  assert(Math.abs(audio - 3) <= 0.024, JSON.stringify(streams));
  assert(Math.abs(video - 3) <= 0.042, JSON.stringify(streams));
  t.diagnostic(`计划 3s，视频 ${video}s，音频 ${audio}s`);
});

test('可变帧率素材的空帧区间会报错，可保留有帧区间', { timeout: 30_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'transcript-cut-vfr-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ffmpeg = process.env.FFMPEG_BIN ? resolve(process.env.FFMPEG_BIN) : 'ffmpeg';
  const file = join(dir, 'variable.mp4');
  const output = join(dir, 'edited.mp4');
  await run(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=25:d=6',
    '-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=48000:duration=6',
    '-vf', "select='not(between(t,2,3))'", '-fps_mode', 'vfr',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file,
  ]);
  const original = await probe(file);
  const frames = await probeFrameTimes(file, original.video_index);
  assert.throws(() => validateVideoFrames([{ start_us: 2_200_000, end_us: 2_400_000 }], frames), /没有视频帧/);
  const kept = [
    { start_us: 0, end_us: 2_000_000, output_start_us: 0 },
    { start_us: 3_040_000, end_us: 6_000_000, output_start_us: 2_000_000 },
  ];
  validateVideoFrames(kept, frames);
  await exportVideo(file, { kept, output_duration_us: 4_960_000 }, output, original);
  const edited = await probe(output);
  assert(Math.abs(edited.duration_us - 4_960_000) < 42_000, JSON.stringify(edited));
  t.diagnostic(`源文件含 1 秒空帧区间，输出 ${edited.duration_us / 1e6}s`);
});
