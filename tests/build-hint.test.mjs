import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('旧版 MoonBit 构建失败时给出检测到的版本和已验证版本', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'transcript-cut-moon-'));
  const moon = process.platform === 'win32' ? join(dir, 'moon.cmd') : join(dir, 'moon');
  const body = process.platform === 'win32'
    ? '@echo off\r\nif "%~1"=="version" (echo moon 9.9.9& echo moonc v0.0.1& exit /b 0)\r\necho old-moon-failed 1>&2\r\nexit /b 3\r\n'
    : '#!/bin/sh\nif [ "$1" = "version" ]; then printf "%s\\n" "moon 9.9.9" "moonc v0.0.1"; exit 0; fi\necho old-moon-failed >&2\nexit 3\n';
  await writeFile(moon, body);
  if (process.platform !== 'win32') await chmod(moon, 0o755);
  try {
    const child = spawn(process.execPath, ['scripts/build.mjs'], {
      env: { ...process.env, MOON_BIN: moon },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(code, 3);
    assert.match(stderr, /old-moon-failed/);
    assert.match(stderr, /检测到的工具：[\s\S]*moon 9\.9\.9/);
    assert.match(stderr, /moonc v0\.0\.1/);
    assert.match(stderr, /已验证版本：moon 0\.1\.20261104，moonc 0\.10\.20\+65efd5b93/);
    assert.match(stderr, /MOON_BIN/);
    assert.match(stderr, /MOON_HOME/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
