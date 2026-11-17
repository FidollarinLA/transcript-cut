import { createReadStream, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { dispatch } from '../_build/js/release/build/core/core.js';
import { calculateEdit } from '../web/edit-core.js';
import {
  exportVideo, hasModel, makeDemo, parseSrt, probe, probeFrameTimes, transcribe,
  validateOutput, validateVideoFrames,
} from './media.mjs';

const port = Number(process.env.PORT || 4317);
const host = '127.0.0.1';
const root = await mkdtemp(join(tmpdir(), 'transcript-cut-'));
const assets = new Map();
const jobs = new Map();
const web = new Map([
  ['/', ['../web/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['../web/app.js', 'text/javascript; charset=utf-8']],
  ['/edit-core.js', ['../web/edit-core.js', 'text/javascript; charset=utf-8']],
  ['/shortcuts.js', ['../web/shortcuts.js', 'text/javascript; charset=utf-8']],
  ['/status-tip.js', ['../web/status-tip.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['../web/style.css', 'text/css; charset=utf-8']],
  ['/core.js', ['../_build/js/release/build/core/core.js', 'text/javascript; charset=utf-8']],
]);
const at = path => fileURLToPath(new URL(path, import.meta.url));

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function body(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求数据过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function streamFile(req, res, file, mime, filename) {
  const { size } = await stat(file);
  const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (filename) headers['Content-Disposition'] = `attachment; filename="${filename}"`;
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (req.headers.range) {
    const range = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    if (range?.[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else if (range?.[2]) {
      start = Math.max(0, size - Number(range[2]));
    }
    if (!range || (!range[1] && !range[2]) || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = size ? end - start + 1 : 0;
  res.writeHead(status, headers);
  if (!size || req.method === 'HEAD') res.end();
  else await pipeline(createReadStream(file, { start, end }), res);
}

async function addAsset(req, demo) {
  const id = randomUUID();
  const dir = join(root, id);
  await mkdir(dir);
  const file = join(dir, 'source.mp4');
  const hash = createHash('sha256');
  try {
    if (demo) {
      await makeDemo(file);
      for await (const chunk of createReadStream(file)) hash.update(chunk);
    } else {
      const limit = 1024 ** 3;
      const size = Number(req.headers['content-length']);
      if (Number.isFinite(size) && size > limit) throw new Error('视频文件上限为 1 GB');
      let bytes = 0;
      const cap = new Transform({
        transform(chunk, _, callback) {
          bytes += chunk.length;
          if (bytes > limit) callback(new Error('视频文件上限为 1 GB'));
          else {
            hash.update(chunk);
            callback(null, chunk);
          }
        },
      });
      await pipeline(req, cap, createWriteStream(file, { flags: 'wx' }));
    }
    const metadata = await probe(file);
    const spans = demo ? parseSrt(await readFile(at('../tests/demo.srt'), 'utf8'), metadata.duration_us) : [];
    const asset = { id, file, metadata, demo };
    assets.set(id, asset);
    return { id, ...metadata, sha256: hash.digest('hex'), demo, spans, media_url: `/api/assets/${id}/media` };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function startJob(asset, kind, work) {
  if ([...jobs.values()].some(job => job.state === 'running' && job.kind === kind)) {
    throw new Error(kind === 'export' ? '请等待当前导出完成' : '请等待当前转写完成');
  }
  const id = randomUUID();
  const dir = join(root, asset.id, id);
  const job = { id, kind, state: 'running', dir };
  jobs.set(id, job);
  try {
    await mkdir(dir);
  } catch (error) {
    jobs.delete(id);
    throw error;
  }
  void work(dir).then(result => {
    Object.assign(job, { state: 'done', result });
  }).catch(async error => {
    Object.assign(job, { state: 'failed', error: error.message });
    await rm(dir, { recursive: true, force: true }).catch(console.error);
  });
  return id;
}

async function route(req, res) {
  const origin = `http://${host}:${server.address().port}`;
  if (req.headers.host !== origin.slice(7) || (req.headers.origin && req.headers.origin !== origin)
    || req.headers['sec-fetch-site'] === 'cross-site') {
    return json(res, 403, { error: '仅允许从本机页面访问' });
  }
  const { pathname } = new URL(req.url, origin);
  const method = req.method;
  const get = method === 'GET' || method === 'HEAD';
  if (get && web.has(pathname)) {
    const [file, mime] = web.get(pathname);
    return streamFile(req, res, at(file), mime);
  }
  if (get && pathname === '/api/config') return json(res, 200, { whisper: hasModel });
  if (method === 'POST' && pathname === '/api/assets') return json(res, 201, await addAsset(req, false));
  if (method === 'POST' && pathname === '/api/demo') return json(res, 201, await addAsset(req, true));
  const assetRoute = pathname.match(/^\/api\/assets\/([a-f0-9-]+)\/(media|srt|transcribe|export)$/);
  if (assetRoute) {
    const [, id, action] = assetRoute;
    const asset = assets.get(id);
    if (!asset) return json(res, 404, { error: '素材不存在，请重新导入' });
    const duration = asset.metadata.duration_us;
    if (get && action === 'media') return streamFile(req, res, asset.file, 'video/mp4');
    if (method === 'POST' && action === 'srt') {
      return json(res, 200, { spans: parseSrt(await body(req, 2_000_000), duration) });
    }
    if (method === 'POST' && action === 'transcribe') {
      if (!hasModel) throw new Error('请设置 WHISPER_MODEL 后重启，或直接导入 SRT');
      const { language } = JSON.parse(await body(req, 512));
      const id = await startJob(asset, 'transcribe', async dir => {
        const spans = await transcribe(asset.file, dir, duration, language);
        await rm(join(dir, 'model.bin'), { force: true });
        return { spans };
      });
      return json(res, 202, { id });
    }
    if (method === 'POST' && action === 'export') {
      const { spans, history } = JSON.parse(await body(req, 10_000_000));
      if (!Array.isArray(spans) || spans.length > 5000 || !Array.isArray(history?.operations) || history.operations.length > 2000) {
        throw new Error('项目数据超过支持范围');
      }
      const { error, plan } = calculateEdit(dispatch, {
        duration_us: duration, spans, history, action: 'plan', operation: null,
      });
      if (error) throw new Error(error);
      validateOutput(plan, asset.metadata);
      const id = await startJob(asset, 'export', async dir => {
        asset.frameTimes ??= await probeFrameTimes(asset.file, asset.metadata.video_index);
        validateVideoFrames(plan.kept, asset.frameTimes);
        await exportVideo(asset.file, plan, join(dir, 'encoding.mp4'), asset.metadata);
        await rename(join(dir, 'encoding.mp4'), join(dir, 'cut.mp4'));
        await writeFile(join(dir, 'captions.srt'), plan.srt);
        return { duration_us: plan.output_duration_us };
      });
      return json(res, 202, { id });
    }
  }
  const jobRoute = pathname.match(/^\/api\/jobs\/([a-f0-9-]+)(?:\/(cut\.mp4|captions\.srt))?$/);
  if (get && jobRoute) {
    const [, id, file] = jobRoute;
    const job = jobs.get(id);
    if (job && !file) {
      const { dir, ...status } = job;
      return json(res, 200, status);
    }
    if (job?.state === 'done' && job.kind === 'export') {
      return streamFile(req, res, join(job.dir, file),
        file.endsWith('.mp4') ? 'video/mp4' : 'application/x-subrip; charset=utf-8', file);
    }
  }
  json(res, 404, { error: '请求的内容不存在' });
}

const server = createServer((req, res) => {
  route(req, res).catch(error => {
    if (!res.headersSent && !res.destroyed) json(res, 400, { error: error.message });
    else if (!res.destroyed) res.destroy();
  });
});
server.listen(port, host, () => {
  const address = `http://${host}:${server.address().port}`;
  console.log(`文字剪视频 ${address}`);
  if (process.platform === 'win32' && process.env.TRANSCRIPT_CUT_OPEN === '1') {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', address], {
      stdio: 'ignore', windowsHide: true,
    });
    browser.on('error', () => console.error(`请在浏览器打开 ${address}`));
    browser.unref();
  }
});
server.once('error', async error => {
  console.error(error.message);
  await rm(root, { recursive: true, force: true });
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => {
      await rm(root, { recursive: true, force: true }).catch(console.error);
    });
  });
}
