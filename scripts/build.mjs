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
process.exitCode = result.status ?? 1;
