import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const installed = join(homedir(), '.moon', 'bin', process.platform === 'win32' ? 'moon.exe' : 'moon');
const moon = process.env.MOON_BIN || (existsSync(installed) ? installed : 'moon');
const result = spawnSync(moon, ['build', '--target', 'js', '--release'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
if ((result.status ?? 1) !== 0) {
  const version = spawnSync(moon, ['version', '--all'], { encoding: 'utf8' });
  const detected = [version.stdout, version.stderr].filter(Boolean).join('\n').trim()
    || result.error?.message
    || '无法读取版本';
  console.error([
    'MoonBit 构建失败。',
    `检测到的工具：${detected}`,
    '已验证版本：moon 0.1.20261104，moonc 0.10.20+65efd5b93。',
    '可设置 MOON_BIN 指向该版本的 moon，需要独立 SDK 时同时设置 MOON_HOME。',
  ].join('\n'));
}
process.exitCode = result.status ?? 1;
