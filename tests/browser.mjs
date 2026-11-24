import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { PLAYWRIGHT_MODULE, CHROME_BIN, BROWSER_SCREENSHOT } = process.env;
if (!PLAYWRIGHT_MODULE || !CHROME_BIN) {
  throw new Error('请设置 PLAYWRIGHT_MODULE 和 CHROME_BIN 后运行浏览器验收');
}
const { chromium } = await import(pathToFileURL(resolve(PLAYWRIGHT_MODULE)));
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
});
const exit = once(child, 'exit');
let browser;
let page;
let step = '启动服务';
const errors = [];

async function captureDialogs(decision, action) {
  const dialogs = [];
  const onDialog = async dialog => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    if (decision === 'accept') await dialog.accept();
    else await dialog.dismiss();
  };
  page.on('dialog', onDialog);
  try {
    await action();
  } finally {
    page.off('dialog', onDialog);
  }
  return dialogs;
}

function leaveWouldPrompt() {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}
try {
  const [startup] = await Promise.race([
    once(child.stdout, 'data'),
    exit.then(([code]) => { throw new Error(`服务器启动失败 ${code}`); }),
  ]);
  const address = startup.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  browser = await chromium.launch({ executablePath: CHROME_BIN, headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  step = '主题偏好';
  const previewInk = () => page.evaluate(() => {
    const lum = color => {
      const [r, g, b] = color.match(/\d+/g).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    return {
      screen: lum(getComputedStyle(document.querySelector('.screen')).backgroundColor),
      copy: lum(getComputedStyle(document.querySelector('#empty-video')).color),
      page: getComputedStyle(document.body).backgroundColor,
    };
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(address);
  await page.waitForFunction(() => document.documentElement.dataset.themeReady === 'true');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.evaluate(() => localStorage.getItem('transcript-cut-theme')), null);
  const darkPreview = await previewInk();
  assert.ok(darkPreview.screen < 0.25, `深色预览底 ${darkPreview.screen}`);
  assert.ok(darkPreview.copy > 0.65, `深色预览文字 ${darkPreview.copy}`);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.themeReady === 'true');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  const lightPreview = await previewInk();
  assert.notEqual(lightPreview.page, darkPreview.page);
  assert.ok(lightPreview.screen < 0.25, `浅色主题里预览底 ${lightPreview.screen}`);
  assert.ok(lightPreview.copy > 0.65, `浅色主题里预览文字 ${lightPreview.copy}`);
  const beforeToggle = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByRole('button', { name: '主题' }).click();
  const chosen = await page.evaluate(() => document.documentElement.dataset.theme);
  assert.notEqual(chosen, beforeToggle);
  assert.ok(chosen === 'light' || chosen === 'dark');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.themeReady === 'true');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), chosen);
  assert.equal(await page.evaluate(() => localStorage.getItem('transcript-cut-theme')), chosen);
  await page.emulateMedia({ colorScheme: chosen === 'dark' ? 'light' : 'dark' });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.themeReady === 'true');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), chosen);
  await page.evaluate(() => localStorage.removeItem('transcript-cut-theme'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.themeReady === 'true');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');

  step = '打开样例';
  await page.goto(address);
  await page.getByRole('button', { name: '打开样例' }).click();
  await page.locator('.row').first().waitFor();
  const timelineHeight = await page.locator('#timeline').evaluate(node => node.getBoundingClientRect().height);
  assert.ok(timelineHeight >= 16 && timelineHeight <= 24, `时间轴高度 ${timelineHeight}`);
  await page.waitForFunction(() => document.querySelector('#player').readyState >= 1);
  assert.equal(await page.locator('.row').count(), 5);
  assert.equal(await page.locator('#duration').textContent(), '00:12.000');
  assert.equal(await page.locator('#player').evaluate(video => video.videoWidth > 0), true);

  step = '播放时转写跟随';
  const rowSeen = index => page.evaluate(rowIndex => {
    const box = document.querySelector('#transcript').getBoundingClientRect();
    const row = document.querySelectorAll('#transcript .row')[rowIndex]?.getBoundingClientRect();
    if (!row) return false;
    return Math.min(box.bottom, row.bottom) - Math.max(box.top, row.top) > 1;
  }, index);
  await page.locator('#transcript').evaluate(node => {
    const first = node.querySelector('.row');
    const height = `${Math.ceil(first.getBoundingClientRect().height)}px`;
    node.style.minHeight = '0px';
    node.style.maxHeight = height;
    node.scrollTop = 0;
  });
  assert.equal(await rowSeen(4), false);
  await page.locator('#player').evaluate(async video => {
    video.pause();
    video.currentTime = 0;
    await video.play();
    video.currentTime = 10.2;
  });
  await page.waitForFunction(() => {
    const box = document.querySelector('#transcript').getBoundingClientRect();
    const row = document.querySelector('#transcript .row.active')?.getBoundingClientRect();
    const text = document.querySelector('#transcript .row.active .line')?.textContent || '';
    if (!row || !text.includes('导出成片')) return false;
    return Math.min(box.bottom, row.bottom) - Math.max(box.top, row.top) > 1;
  });
  await page.locator('#player').evaluate(video => video.pause());
  await page.locator('#transcript').evaluate(node => { node.scrollTop = 0; });
  await page.waitForTimeout(400);
  assert.equal(await rowSeen(4), false);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#suggestions button')].find(node => node.textContent.includes('重复句'));
    button.click();
  });
  await page.waitForFunction(() => {
    const box = document.querySelector('#transcript').getBoundingClientRect();
    const row = document.querySelector('#transcript .row.active');
    if (!row || !row.querySelector('.time')?.textContent?.includes('00:06.500')) return false;
    const rect = row.getBoundingClientRect();
    return Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top) > 1;
  });
  await page.locator('#player').evaluate(video => video.pause());
  await page.locator('#transcript').evaluate(node => {
    node.scrollTop = 0;
    node.style.maxHeight = '';
    node.style.minHeight = '';
  });

  step = '用当前位置设起止';
  await page.locator('.row').last().click();
  assert.equal(await page.locator('#start').inputValue(), '10.000');
  assert.equal(await page.locator('#end').inputValue(), '12.000');
  const scrollBeforeMark = await page.locator('#transcript').evaluate(node => node.scrollTop);
  await page.locator('#player').evaluate(video => { video.currentTime = 10.5; });
  await page.locator('#mark-start').click();
  assert.equal(await page.locator('#start').inputValue(), '10.500');
  assert.equal(await page.locator('#end').inputValue(), '12.000');
  assert.ok(Math.abs(await page.locator('#player').evaluate(video => video.currentTime) - 10.5) < 0.05);
  assert.equal(await page.locator('#transcript').evaluate(node => node.scrollTop), scrollBeforeMark);
  await page.locator('#player').evaluate(video => { video.currentTime = 11.5; });
  await page.locator('#mark-end').click();
  assert.equal(await page.locator('#start').inputValue(), '10.500');
  assert.equal(await page.locator('#end').inputValue(), '11.500');
  await page.locator('#player').evaluate(video => { video.currentTime = 10; });
  await page.locator('#mark-end').click();
  assert.match(await page.locator('#status').textContent(), /当前位置需晚于起点/);
  assert.equal(await page.locator('#status').evaluate(node => node.classList.contains('error')), true);
  assert.equal(await page.locator('#start').inputValue(), '10.500');
  assert.equal(await page.locator('#end').inputValue(), '11.500');
  await page.locator('#player').evaluate(video => { video.currentTime = 11.5; });
  await page.locator('#mark-start').click();
  assert.match(await page.locator('#status').textContent(), /当前位置需早于终点/);
  assert.equal(await page.locator('#start').inputValue(), '10.500');
  assert.equal(await page.locator('#end').inputValue(), '11.500');
  await page.getByRole('button', { name: '复听', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#player').paused);
  await page.locator('#mark-start').click();
  assert.equal(await page.locator('#player').evaluate(video => video.paused), true);
  assert.equal(await page.locator('#end').inputValue(), '11.500');
  assert.ok(Math.abs(Number(await page.locator('#start').inputValue()) - await page.locator('#player').evaluate(video => video.currentTime)) < 0.05);
  await page.locator('#player').evaluate(video => { video.currentTime = 10.5; });
  await page.locator('#mark-start').click();
  assert.equal(await page.locator('#start').inputValue(), '10.500');
  await page.getByRole('button', { name: '复听', exact: true }).click();
  await page.getByRole('button', { name: '剪掉区间' }).click();
  assert.equal(await page.locator('#output-duration').textContent(), '00:11.000');
  await page.getByRole('button', { name: '撤销' }).click();
  assert.equal(await page.locator('#output-duration').textContent(), '00:12.000');

  step = '剪除、撤销和重做';
  await page.getByRole('button', { name: /口头禅/ }).click();
  await page.waitForFunction(() => document.querySelector('#player').currentTime >= 2);
  await page.getByRole('button', { name: '剪掉区间' }).click();
  assert.equal(await page.locator('#output-duration').textContent(), '00:10.000');
  assert.equal(await page.locator('.row.removed').count(), 1);
  assert.equal(await page.locator('#review').isHidden(), true);
  await page.getByRole('button', { name: '撤销' }).click();
  assert.equal(await page.locator('#output-duration').textContent(), '00:12.000');
  await page.getByRole('button', { name: '重做' }).click();
  assert.equal(await page.locator('#output-duration').textContent(), '00:10.000');

  // 验证时间轴切段点击跳转定位
  const timelineBars = page.locator('#timeline span');
  assert((await timelineBars.count()) >= 2);
  const paints = await timelineBars.evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node);
    return `${node.className}|${style.backgroundColor}|${style.backgroundImage}`;
  }));
  const keptPaint = paints.find(item => !item.startsWith('removed'));
  const cutPaint = paints.find(item => item.startsWith('removed'));
  assert.ok(keptPaint && cutPaint && keptPaint !== cutPaint);
  await timelineBars.last().hover();
  assert.match(await page.locator('#timeline-readout').textContent(), /当前位置/);
  assert.match(await page.locator('#timeline-readout').textContent(), /保留|剪除/);
  await timelineBars.last().focus();
  assert.match(await page.locator('#timeline-readout').textContent(), /当前位置/);
  const lastBar = await timelineBars.last().boundingBox();
  await page.mouse.click(lastBar.x + lastBar.width * 0.5, lastBar.y + lastBar.height * 0.5);
  await page.waitForFunction(() => {
    const time = document.querySelector('#player').currentTime;
    return time > 6.5 && time < 9.5;
  });
  assert.match(await page.locator('#timeline-readout').textContent(), /当前位置/);

  // 验证键盘快捷键：Ctrl+Z 撤销，Ctrl+Y 重做
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#output-duration').textContent(), '00:12.000');
  await page.keyboard.press('Control+y');
  assert.equal(await page.locator('#output-duration').textContent(), '00:10.000');

  step = '修正最后一句';
  await page.locator('.row').filter({ hasText: /剪好后/ }).click();
  await page.getByRole('button', { name: '修正文字' }).click();
  await page.locator('#correction-text').fill('最后一句字幕已更正。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: /最后一句字幕已更正/ }).waitFor();

  await page.locator('#preview').check();
  await page.evaluate(async () => {
    const video = document.querySelector('#player');
    video.currentTime = 2.2;
    await video.play();
  });
  await page.waitForFunction(() => document.querySelector('#player').currentTime >= 4);
  await page.locator('#player').evaluate(video => video.pause());

  step = '导出并保存项目';
  await page.getByRole('button', { name: '导出成片', exact: true }).click();
  const srtLink = page.getByRole('link', { name: '下载 SRT' });
  await srtLink.waitFor();
  const srt = await (await page.request.get(address + await srtLink.getAttribute('href'))).text();
  assert.match(srt, /00:00:08,000 --> 00:00:10,000\n最后一句字幕已更正/);
  assert.doesNotMatch(srt, /呃/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存项目' }).click();
  const projectPath = await (await download).path();
  const saved = JSON.parse(await readFile(projectPath, 'utf8'));
  assert.equal(saved.history.cursor, 2);
  assert.match(saved.source.sha256, /^[a-f0-9]{64}$/);

  step = '错源拒绝与同源恢复';
  await page.reload();
  await page.getByRole('button', { name: '打开样例' }).click();
  await page.locator('.row').first().waitFor();
  const projectInput = page.locator('#project-file');
  await projectInput.setInputFiles({
    name: 'mismatch.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...saved, source: { ...saved.source, sha256: 'other' } })),
  });
  await page.getByRole('status').filter({ hasText: '项目与当前视频不匹配' }).waitFor();
  assert.match(await page.locator('#status').textContent(), /当前编辑未改动/);
  assert.equal(await page.locator('#output-duration').textContent(), '00:12.000');
  await projectInput.setInputFiles({
    name: 'saved.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await page.getByRole('status').filter({ hasText: '转写稿、剪点和撤销记录已恢复' }).waitFor();
  assert.match(await page.locator('#status').textContent(), /源视频校验通过/);
  assert.match(await page.locator('#status').textContent(), /可撤销 2 步/);
  assert.equal(await page.locator('#output-duration').textContent(), '00:10.000');
  await page.getByRole('button', { name: /最后一句字幕已更正/ }).waitFor();
  await page.getByRole('button', { name: '撤销' }).click();
  await page.locator('.row').filter({ hasText: /剪好后/ }).waitFor();
  await page.locator('.row').nth(2).click();
  await page.locator('.row').nth(3).click({ modifiers: ['Shift'] });
  assert.equal(await page.locator('.row.selected').count(), 2);
  assert.equal(await page.locator('#start').inputValue(), '5.000');
  assert.equal(await page.locator('#end').inputValue(), '7.500');

  // 验证上下键导航选择转写行与 Escape 取消选择
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.row.selected').count(), 0);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.row.selected').count(), 1);
  assert(await page.locator('.row').first().evaluate(node => node.classList.contains('selected')));
  await page.keyboard.press('ArrowDown');
  assert(await page.locator('.row').nth(1).evaluate(node => node.classList.contains('selected')));
  assert.equal(await page.getByRole('button', { name: '修正文字' }).isDisabled(), false);
  assert.deepEqual(errors, []);

  step = '截断字幕复核';
  await page.locator('#start').fill('10.500');
  await page.locator('#end').fill('11.500');
  await page.getByRole('button', { name: '剪掉区间' }).click();
  await page.locator('#review').waitFor();
  assert.equal(await page.locator('#review-text').textContent(), '1 句被切点截断，已从成片字幕略去。');
  assert.equal(await page.locator('#output-duration').textContent(), '00:09.000');
  await page.getByRole('button', { name: '定位 00:10.000' }).click();
  await page.waitForFunction(() => document.querySelector('#player').currentTime >= 10);
  assert.match(await page.locator('#status').textContent(), /1 句被切点截断/);
  await page.getByRole('button', { name: '导出成片', exact: true }).click();
  const partialSrt = page.getByRole('link', { name: '下载 SRT' });
  await partialSrt.waitFor();
  const partialText = await (await page.request.get(address + await partialSrt.getAttribute('href'))).text();
  assert.match(partialText, /今天我们来演示如何用文字剪视频/);
  assert.doesNotMatch(partialText, /剪好后/);
  assert.doesNotMatch(partialText, /呃/);
  await page.getByRole('button', { name: '撤销' }).click();
  assert.equal(await page.locator('#review').isHidden(), true);
  assert.equal(await page.locator('#output-duration').textContent(), '00:10.000');
  if (BROWSER_SCREENSHOT) await page.screenshot({ path: BROWSER_SCREENSHOT, fullPage: true });

  step = '拖放导入';
  const leaveForDrop = await captureDialogs('accept', () => page.goto(address));
  assert.equal(leaveForDrop.length, 1);
  assert.equal(leaveForDrop[0].type, 'beforeunload');
  await page.waitForFunction(() => document.documentElement.dataset.themeReady === 'true');
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'a.txt', { type: 'text/plain' }));
    document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  assert.equal(await page.locator('#drop-overlay').isHidden(), false);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'a.txt', { type: 'text/plain' }));
    document.body.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  assert.equal(await page.locator('#drop-overlay').isHidden(), true);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'a.txt', { type: 'text/plain' }));
    document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    document.body.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }));
  });
  assert.equal(await page.locator('#drop-overlay').isHidden(), true);

  const dropFiles = async files => {
    await page.evaluate(items => {
      const transfer = new DataTransfer();
      for (const item of items) {
        const binary = atob(item.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        transfer.items.add(new File([bytes], item.name, { type: item.type }));
      }
      const init = { bubbles: true, cancelable: true, dataTransfer: transfer };
      document.body.dispatchEvent(new DragEvent('dragenter', init));
      document.body.dispatchEvent(new DragEvent('drop', init));
    }, files.map(file => ({
      name: file.name,
      type: file.type || '',
      base64: Buffer.from(file.buffer).toString('base64'),
    })));
  };
  const dropped = (name, type, buffer) => dropFiles([{ name, type, buffer }]);

  await dropped('fake.mp4', 'video/mp4', Buffer.from('not a video'));
  await page.locator('#status.error').waitFor();
  assert.doesNotMatch(await page.locator('#status').textContent(), /视频已导入/);
  assert.equal(await page.locator('#filename').textContent(), '未导入视频');
  assert.equal(await page.locator('#player').isHidden(), true);
  assert.equal(await page.locator('#drop-overlay').isHidden(), true);

  await dropped('notes.txt', 'text/plain', Buffer.from('hello'));
  await page.getByRole('status').filter({ hasText: '请拖入 MP4、SRT 或项目 JSON' }).waitFor();

  const earlySrt = Buffer.from('1\n00:00:00,000 --> 00:00:00,200\n早了。\n');
  await dropped('early.srt', 'application/x-subrip', earlySrt);
  await page.getByRole('status').filter({ hasText: '请先导入 MP4' }).waitFor();
  assert.equal(await page.locator('.row').count(), 0);

  await dropFiles([
    { name: 'a.mp4', type: 'video/mp4', buffer: Buffer.from('a') },
    { name: 'b.srt', type: 'text/plain', buffer: Buffer.from('b') },
  ]);
  await page.getByRole('status').filter({ hasText: '一次只能拖入一个' }).waitFor();

  const sampleDir = await mkdtemp(join(tmpdir(), 'tc-drop-'));
  const samplePath = join(sampleDir, 'drop-sample.mp4');
  await new Promise((resolvePromise, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', samplePath,
    ], { stdio: 'ignore', windowsHide: true });
    ffmpeg.once('error', reject);
    ffmpeg.once('close', code => (code === 0 ? resolvePromise() : reject(new Error(`ffmpeg 退出 ${code}`))));
  });
  await dropped('drop-sample.mp4', 'video/mp4', await readFile(samplePath));
  await page.getByRole('status').filter({ hasText: '视频已导入' }).waitFor();
  await page.waitForFunction(() => document.querySelector('#player').readyState >= 1);
  assert.equal(await page.locator('#filename').textContent(), 'drop-sample.mp4');
  assert.equal(await page.locator('#duration').textContent() !== '—', true);

  await dropped('bad.srt', 'text/plain', Buffer.from('这不是字幕'));
  await page.getByRole('status').filter({ hasText: '无效时间码' }).waitFor();
  assert.equal(await page.locator('.row').count(), 0);
  assert.equal(await page.locator('#filename').textContent(), 'drop-sample.mp4');

  const clip = Buffer.from('1\n00:00:00,000 --> 00:00:00,200\n拖放进来的一句。\n');
  await dropped('clip.srt', 'application/x-subrip', clip);
  await page.getByRole('status').filter({ hasText: '已导入 1 个句段' }).waitFor();
  await page.getByRole('button', { name: '拖放进来的一句。' }).waitFor();

  const droppedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存项目' }).click();
  const droppedProject = JSON.parse(await readFile(await (await droppedDownload).path(), 'utf8'));
  await dropped('mismatch.json', 'application/json', Buffer.from(JSON.stringify({
    ...droppedProject, source: { ...droppedProject.source, sha256: 'other' },
  })));
  await page.getByRole('status').filter({ hasText: '项目与当前视频不匹配' }).waitFor();
  await page.getByRole('button', { name: '拖放进来的一句。' }).waitFor();
  assert.match(await page.locator('#status').textContent(), /当前编辑未改动/);

  await dropped('saved.json', 'application/json', Buffer.from(JSON.stringify(droppedProject)));
  await page.getByRole('status').filter({ hasText: '转写稿、剪点和撤销记录已恢复' }).waitFor();

  await page.getByRole('button', { name: '拖放进来的一句。' }).click();
  await page.getByRole('button', { name: '剪掉区间' }).click();
  await page.locator('.row.removed').waitFor();
  page.once('dialog', async dialog => {
    const message = dialog.message();
    await dialog.dismiss();
    assert.match(message, /替换转写稿会清空当前编辑/);
  });
  await dropped('clip.srt', 'application/x-subrip', clip);
  assert.equal(await page.locator('.row.removed').count(), 1);

  page.once('dialog', dialog => dialog.accept());
  await dropped('clip.srt', 'application/x-subrip', clip);
  await page.getByRole('status').filter({ hasText: '已导入 1 个句段' }).waitFor();
  assert.equal(await page.locator('.row.removed').count(), 0);
  assert.deepEqual(errors, []);

  if (process.env.WHISPER_TEST_INPUT && process.env.WHISPER_MODEL) {
    await captureDialogs('accept', async () => {
      await page.locator('#video-file').setInputFiles(process.env.WHISPER_TEST_INPUT);
      await page.getByRole('status').filter({ hasText: '视频已导入' }).waitFor();
    });
    await page.getByRole('button', { name: '自动转写' }).click();
    await page.getByRole('status').filter({ hasText: '转写完成' }).waitFor({ timeout: 60_000 });
    assert((await page.locator('.row').count()) >= 2);
    await page.locator('.row').first().click();
    await page.getByRole('button', { name: '剪掉区间' }).click();
    await page.getByRole('button', { name: '导出成片', exact: true }).click();
    await page.getByRole('link', { name: '下载 MP4' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('浏览器实际完成中文转写、选择句段剪辑、MP4 导出');
  }

  step = '未保存编辑';
  await captureDialogs('accept', () => page.goto(address));
  await page.getByRole('button', { name: '打开样例' }).click();
  await page.locator('.row').first().waitFor();
  assert.equal(await leaveWouldPrompt(), false);
  await page.locator('.row').nth(1).click();
  await page.getByRole('button', { name: '剪掉区间' }).click();
  await page.locator('.row.removed').waitFor();
  assert.equal(await leaveWouldPrompt(), true);
  const keptDuration = await page.locator('#output-duration').textContent();
  const keptName = await page.locator('#filename').textContent();
  const keptRow = await page.locator('.row').nth(1).textContent();
  await page.evaluate(() => { document.querySelector('#status').textContent = '等待确认'; });
  const sampleDialogs = await captureDialogs('dismiss', async () => {
    await page.getByRole('button', { name: '打开样例', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已取消，当前编辑未改动' }).waitFor();
  });
  assert.equal(sampleDialogs.length, 1);
  assert.equal(sampleDialogs[0].type, 'confirm');
  assert.equal(sampleDialogs[0].message, '当前编辑尚未保存，继续会清空这些编辑，要继续吗？');
  assert.equal(await page.locator('#output-duration').textContent(), keptDuration);
  assert.equal(await page.locator('#filename').textContent(), keptName);
  assert.equal(await page.locator('.row.removed').count(), 1);
  assert.equal(await page.locator('.row').nth(1).textContent(), keptRow);
  if (process.env.UNSAVED_SCREENSHOT) {
    await page.screenshot({ path: process.env.UNSAVED_SCREENSHOT, fullPage: true });
  }

  await page.evaluate(() => { document.querySelector('#status').textContent = '等待确认'; });
  const srtDialogs = await captureDialogs('dismiss', async () => {
    await page.locator('#srt-file').setInputFiles({
      name: 'other.srt',
      mimeType: 'application/x-subrip',
      buffer: Buffer.from('1\n00:00:00,000 --> 00:00:01,000\n不该替换。\n'),
    });
    await page.getByRole('status').filter({ hasText: '已取消，当前编辑未改动' }).waitFor();
  });
  assert.equal(srtDialogs.length, 1);
  assert.equal(srtDialogs[0].type, 'confirm');
  assert.equal(srtDialogs[0].message, '替换转写稿会清空当前编辑，继续吗？');
  assert.equal(await page.locator('.row.removed').count(), 1);
  assert.equal(await page.locator('#output-duration').textContent(), keptDuration);

  await page.evaluate(() => { document.querySelector('#status').textContent = '等待确认'; });
  const projectDialogs = await captureDialogs('dismiss', async () => {
    await page.locator('#project-file').setInputFiles({
      name: 'other.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{}'),
    });
    await page.getByRole('status').filter({ hasText: '已取消，当前编辑未改动' }).waitFor();
  });
  assert.equal(projectDialogs.length, 1);
  assert.equal(projectDialogs[0].message, '替换转写稿会清空当前编辑，继续吗？');
  assert.equal(await page.locator('.row.removed').count(), 1);
  assert.equal(await page.locator('.row').nth(1).textContent(), keptRow);
  assert.equal(await leaveWouldPrompt(), true);
  const leaveDialogs = await captureDialogs('accept', () => page.reload());
  assert.equal(leaveDialogs.length, 1);
  assert.equal(leaveDialogs[0].type, 'beforeunload');

  await page.getByRole('button', { name: '打开样例' }).click();
  await page.locator('.row').first().waitFor();
  await page.locator('.row').nth(1).click();
  await page.getByRole('button', { name: '剪掉区间' }).click();
  await page.locator('.row.removed').waitFor();
  const guardDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存项目' }).click();
  await guardDownload;
  await page.getByRole('status').filter({ hasText: '项目文件已生成' }).waitFor();
  assert.equal(await leaveWouldPrompt(), false);
  await page.getByRole('button', { name: '撤销' }).click();
  assert.equal(await page.locator('.row.removed').count(), 0);
  assert.equal(await leaveWouldPrompt(), true);
  await page.getByRole('button', { name: '重做' }).click();
  await page.locator('.row.removed').waitFor();
  assert.equal(await leaveWouldPrompt(), false);
  const cleanLeave = await captureDialogs('accept', () => page.reload());
  assert.equal(cleanLeave.length, 0);

  await page.getByRole('button', { name: '打开样例' }).click();
  await page.locator('.row').first().waitFor();
  await page.locator('.row').nth(1).click();
  await page.getByRole('button', { name: '剪掉区间' }).click();
  await page.locator('.row.removed').waitFor();
  const errorsBeforeSave = errors.length;
  await page.evaluate(() => {
    URL.createObjectURL = () => { throw new Error('无法创建项目文件'); };
  });
  await page.getByRole('button', { name: '保存项目' }).click();
  await page.getByRole('status').filter({ hasText: '无法创建项目文件' }).waitFor();
  assert.equal(await page.locator('#status').evaluate(node => node.classList.contains('error')), true);
  assert.equal(await page.locator('.row.removed').count(), 1);
  assert.equal(await leaveWouldPrompt(), true);
  assert.equal(errors.length, errorsBeforeSave);
  await captureDialogs('accept', () => page.reload());

  step = '快捷键说明';
  const errorsBeforeHelp = errors.length;
  const setTheme = async theme => {
    const current = await page.evaluate(() => document.documentElement.dataset.theme);
    if (current !== theme) await page.getByRole('button', { name: '主题', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
  };
  const helpButton = page.getByRole('button', { name: '快捷键', exact: true });
  const helpDialog = page.locator('#shortcuts-dialog');
  await setTheme('light');
  await helpButton.click();
  assert.equal(await helpDialog.evaluate(node => node.open), true);
  const helpText = await helpDialog.textContent();
  assert.match(helpText, /播放或暂停/);
  assert.match(helpText, /剪掉当前选区/);
  assert.match(helpText, /打开快捷键说明/);
  assert.match(helpText, /播放和剪辑快捷键会暂停/);
  if (process.env.SHORTCUT_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHORTCUT_SCREENSHOT_DIR}/light.png` });
  }
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#shortcuts-dialog').open);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'shortcuts-help');
  await setTheme('dark');
  await helpButton.click();
  if (process.env.SHORTCUT_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHORTCUT_SCREENSHOT_DIR}/dark.png` });
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#shortcuts-dialog').open);
  await setTheme('light');

  await page.getByRole('button', { name: '打开样例', exact: true }).click();
  await page.locator('.row').first().waitFor();
  const sampleRow = page.locator('.row').nth(1);
  await sampleRow.click();
  await page.locator('#selection').waitFor();
  const durationBeforeHelp = await page.locator('#output-duration').textContent();
  await page.keyboard.press('?');
  await page.waitForFunction(() => document.querySelector('#shortcuts-dialog').open);
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#output-duration').textContent(), durationBeforeHelp);
  assert.equal(await page.locator('.row.removed').count(), 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#shortcuts-dialog').open);
  assert.equal(await page.locator('#selection').isHidden(), false);
  assert.equal(await page.locator('.row.selected').count(), 1);
  assert.match(await page.evaluate(() => document.activeElement?.className || ''), /row/);
  await page.keyboard.press('Delete');
  await page.locator('.row.removed').waitFor();
  assert.equal(await leaveWouldPrompt(), true);
  const removedBeforePanel = await page.locator('.row.removed').count();
  await helpButton.click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#shortcuts-dialog').open);
  assert.equal(await page.locator('.row.removed').count(), removedBeforePanel);
  assert.equal(await leaveWouldPrompt(), true);
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('.row.removed').count(), 0);

  const startField = page.locator('#start');
  await startField.click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'start');
  await startField.press('?');
  assert.equal(await helpDialog.evaluate(node => node.open), false);
  await page.getByRole('button', { name: '修正文字' }).click();
  await page.waitForFunction(() => document.querySelector('#correction').open);
  await page.keyboard.press('?');
  assert.equal(await helpDialog.evaluate(node => node.open), false);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#correction').open);
  assert.equal(await page.locator('#selection').isHidden(), false);
  assert.equal(errors.length, errorsBeforeHelp);

  step = '建议类型';
  const suggestionTheme = async theme => {
    const current = await page.evaluate(() => document.documentElement.dataset.theme);
    if (current !== theme) await page.getByRole('button', { name: '主题', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
  };
  await suggestionTheme('light');
  const suggestionButtons = page.locator('#suggestions button.suggestion');
  await suggestionButtons.first().waitFor();
  assert.equal(await page.locator('#suggestions button.filler').count(), 1);
  assert.equal(await page.locator('#suggestions button.repeat').count(), 1);
  assert.equal(await page.locator('#suggestions button.pause').count(), 1);
  assert.equal(await page.locator('#suggestion-count').textContent(), '3 个待复听');
  assert.equal(await page.locator('#suggestions button.filler .kind').textContent(), '口头禅');
  assert.equal(await page.locator('#suggestions button.repeat .kind').textContent(), '重复句');
  assert.equal(await page.locator('#suggestions button.pause .kind').textContent(), '长停顿');
  const kindPaint = await suggestionButtons.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  assert.equal(new Set(kindPaint).size, 3);
  const lightFiller = await page.locator('#suggestions button.filler').evaluate(node => getComputedStyle(node).backgroundColor);
  assert.equal(await page.locator('#suggestion-filters').getAttribute('data-filter'), 'all');
  assert.equal(await page.getByRole('tab', { name: '全部 3' }).getAttribute('aria-selected'), 'true');
  const beforeFilterDuration = await page.locator('#output-duration').textContent();
  const beforeFilterRemoved = await page.locator('.row.removed').count();
  assert.equal(await leaveWouldPrompt(), true);
  await page.getByRole('tab', { name: /^长停顿/ }).click();
  assert.equal(await page.locator('#suggestions button.pause').count(), 1);
  assert.equal(await page.locator('#suggestions button.filler').count(), 0);
  assert.equal(await page.locator('#suggestions button.repeat').count(), 0);
  assert.equal(await page.locator('#output-duration').textContent(), beforeFilterDuration);
  assert.equal(await page.locator('.row.removed').count(), beforeFilterRemoved);
  assert.equal(await leaveWouldPrompt(), true);
  await page.locator('#suggestions button.pause').click();
  assert.equal(await page.locator('#selection').isHidden(), false);
  assert.equal(await page.locator('#start').inputValue(), '7.750');
  assert.equal(await page.locator('#end').inputValue(), '9.750');
  assert.match(await page.locator('#selected-text').textContent(), /长停顿/);
  await page.getByRole('tab', { name: /^全部/ }).click();
  assert.equal(await suggestionButtons.count(), 3);
  if (process.env.SUGGESTION_SCREENSHOT_DIR) {
    await page.locator('.suggestion-panel').screenshot({ path: `${process.env.SUGGESTION_SCREENSHOT_DIR}/suggestion-light.png` });
  }
  await suggestionTheme('dark');
  const darkFiller = await page.locator('#suggestions button.filler').evaluate(node => getComputedStyle(node).backgroundColor);
  assert.notEqual(darkFiller, lightFiller);
  if (process.env.SUGGESTION_SCREENSHOT_DIR) {
    await page.locator('.suggestion-panel').screenshot({ path: `${process.env.SUGGESTION_SCREENSHOT_DIR}/suggestion-dark.png` });
  }
  await suggestionTheme('light');

  await page.getByRole('button', { name: /口头禅/ }).click();
  await page.getByRole('button', { name: '剪掉区间' }).click();
  await page.locator('.row.removed').waitFor();
  assert.equal(await page.locator('#suggestions button.filler').count(), 0);
  assert.equal(await page.locator('#suggestion-count').textContent(), '2 个待复听');
  assert.equal(await page.locator('#output-duration').textContent(), '00:10.000');
  await page.getByRole('tab', { name: '口头禅', exact: true }).click();
  assert.equal(await page.locator('#suggestions .empty-copy').textContent(), '这一类里没有待复听的建议。');
  assert.equal(await page.locator('#suggestion-count').textContent(), '2 个待复听');
  assert.equal(await leaveWouldPrompt(), true);

  step = '弹窗拖放与脏状态';
  const dropName = await page.locator('#filename').textContent();
  const dropDuration = await page.locator('#duration').textContent();
  const dropOutput = await page.locator('#output-duration').textContent();
  const dropRemoved = await page.locator('.row.removed').count();
  await page.getByRole('button', { name: '快捷键', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#shortcuts-dialog').open);
  const blocked = [];
  const onBlocked = async dialog => {
    blocked.push(dialog.message());
    await dialog.dismiss();
  };
  page.on('dialog', onBlocked);
  try {
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['x'], 'while-open.txt', { type: 'text/plain' }));
      document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    assert.equal(await page.locator('#drop-overlay').isHidden(), true);
    assert.equal(await page.locator('#shortcuts-dialog').evaluate(node => node.open), true);
    await dropped('drop-sample.mp4', 'video/mp4', await readFile(samplePath));
    assert.doesNotMatch(await page.locator('#status').textContent(), /正在读取|视频已导入|已取消/);
    assert.equal(await page.locator('#drop-overlay').isHidden(), true);
    assert.equal(await page.locator('#shortcuts-dialog').evaluate(node => node.open), true);
    assert.equal(await page.locator('#filename').textContent(), dropName);
    assert.equal(await page.locator('#duration').textContent(), dropDuration);
    assert.equal(await page.locator('#output-duration').textContent(), dropOutput);
    assert.equal(await page.locator('.row.removed').count(), dropRemoved);
  } finally {
    page.off('dialog', onBlocked);
  }
  assert.equal(blocked.length, 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#shortcuts-dialog').open);

  const dirtyVideo = await captureDialogs('dismiss', async () => {
    await dropped('drop-sample.mp4', 'video/mp4', await readFile(samplePath));
    await page.getByRole('status').filter({ hasText: '已取消，当前编辑未改动' }).waitFor();
  });
  assert.equal(dirtyVideo.length, 1);
  assert.equal(dirtyVideo[0].type, 'confirm');
  assert.equal(dirtyVideo[0].message, '当前编辑尚未保存，继续会清空这些编辑，要继续吗？');
  assert.equal(await page.locator('#filename').textContent(), dropName);
  assert.equal(await page.locator('#duration').textContent(), dropDuration);
  assert.equal(await page.locator('#output-duration').textContent(), dropOutput);
  assert.equal(await page.locator('.row.removed').count(), dropRemoved);
  assert.equal(await page.locator('#drop-overlay').isHidden(), true);
  assert.equal(await leaveWouldPrompt(), true);

  const dirtyProject = await captureDialogs('dismiss', async () => {
    await dropped('empty.json', 'application/json', Buffer.from('{}'));
    await page.getByRole('status').filter({ hasText: '已取消，当前编辑未改动' }).waitFor();
  });
  assert.equal(dirtyProject.length, 1);
  assert.equal(dirtyProject[0].type, 'confirm');
  assert.equal(dirtyProject[0].message, '替换转写稿会清空当前编辑，继续吗？');
  assert.equal(await page.locator('#filename').textContent(), dropName);
  assert.equal(await page.locator('.row.removed').count(), dropRemoved);
  assert.equal(await page.locator('#output-duration').textContent(), dropOutput);
  assert.equal(await leaveWouldPrompt(), true);

  const cleanDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存项目' }).click();
  await cleanDownload;
  await page.getByRole('status').filter({ hasText: '项目文件已生成' }).waitFor();
  assert.equal(await leaveWouldPrompt(), false);
  await page.getByRole('tab', { name: /^长停顿/ }).click();
  assert.equal(await page.locator('#suggestion-filters').getAttribute('data-filter'), 'pause');
  assert.equal(await leaveWouldPrompt(), false);
  const cleanDrop = await captureDialogs('accept', async () => {
    await dropped('drop-sample.mp4', 'video/mp4', await readFile(samplePath));
    await page.getByRole('status').filter({ hasText: '视频已导入' }).waitFor();
  });
  assert.equal(cleanDrop.length, 0);
  assert.equal(await page.locator('#filename').textContent(), 'drop-sample.mp4');
  assert.equal(await page.locator('#suggestion-filters').getAttribute('data-filter'), 'all');
  assert.equal(await page.locator('#drop-overlay').isHidden(), true);
  assert.equal(await leaveWouldPrompt(), false);

  step = '窄屏与分屏';
  const fitsViewport = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const headerSharesRow = () => page.evaluate(() => {
    const brand = document.querySelector('.brand').getBoundingClientRect();
    const actions = document.querySelector('.top .actions').getBoundingClientRect();
    return Math.abs(actions.top - brand.top) < 8;
  });
  const insideViewport = locator => locator.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && rect.top >= -1 && rect.left >= -1
      && rect.bottom <= window.innerHeight + 1
      && rect.right <= window.innerWidth + 1;
  });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.top')).flexWrap), 'nowrap');
  assert.equal(await headerSharesRow(), true);
  const desktopLeave = await captureDialogs('accept', () => page.setViewportSize({ width: 768, height: 900 }));
  assert.equal(desktopLeave.length, 0);
  const mediumEnter = await captureDialogs('accept', () => page.goto(address));
  assert.equal(mediumEnter.length, 0);
  assert.equal(mediumEnter.every(dialog => dialog.type === 'beforeunload'), true);
  await page.waitForFunction(() => document.documentElement.dataset.themeReady === 'true');
  await suggestionTheme('light');
  await page.getByRole('button', { name: '打开样例' }).click();
  await page.locator('.row').first().waitFor();
  await page.locator('#suggestions button.pause').waitFor();
  assert.equal(await headerSharesRow(), false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.top')).position), 'sticky');
  assert.equal(await fitsViewport(), true);
  if (process.env.LAYOUT_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.LAYOUT_SCREENSHOT_DIR}/layout-medium-light.png`, fullPage: true });
  }

  const narrowEnter = await captureDialogs('accept', () => page.setViewportSize({ width: 390, height: 844 }));
  assert.equal(narrowEnter.length, 0);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.top')).position), 'static');
  assert.equal(await fitsViewport(), true);
  assert.equal(await leaveWouldPrompt(), false);
  await page.getByRole('tab', { name: /^长停顿/ }).click();
  assert.equal(await page.locator('#suggestion-filters').getAttribute('data-filter'), 'pause');
  assert.equal(await page.locator('#suggestions button.pause').count(), 1);
  assert.equal(await page.locator('#output-duration').textContent(), '00:12.000');
  assert.equal(await leaveWouldPrompt(), false);
  const pauseKind = await page.locator('#suggestions button.pause .kind').evaluate(node => ({
    whiteSpace: getComputedStyle(node).whiteSpace,
    fits: node.scrollWidth <= node.getBoundingClientRect().width + 1,
  }));
  assert.equal(pauseKind.whiteSpace, 'nowrap');
  assert.equal(pauseKind.fits, true);
  assert.equal(await fitsViewport(), true);
  if (process.env.LAYOUT_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.LAYOUT_SCREENSHOT_DIR}/layout-narrow-light.png`, fullPage: true });
  }

  await page.locator('#suggestions button.pause').click();
  assert.equal(await page.locator('#start').inputValue(), '7.750');
  assert.equal(await page.locator('#end').inputValue(), '9.750');
  assert.equal(await page.locator('#selection .actions').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  assert.equal(await fitsViewport(), true);
  await page.getByRole('button', { name: '剪掉区间' }).click();
  assert.equal(await page.locator('#output-duration').textContent(), '00:10.000');
  assert.equal(await leaveWouldPrompt(), true);
  await page.getByRole('button', { name: '撤销' }).click();
  assert.equal(await page.locator('#output-duration').textContent(), '00:12.000');
  assert.equal(await leaveWouldPrompt(), true);
  await page.getByRole('tab', { name: /^全部/ }).click();
  assert.equal(await page.locator('#suggestions button').count(), 3);
  assert.equal(await fitsViewport(), true);

  await page.locator('#start').fill('10.500');
  await page.locator('#end').fill('11.500');
  await page.getByRole('button', { name: '剪掉区间' }).click();
  await page.locator('#review').waitFor();
  const locate = page.locator('#review-locate');
  await locate.scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#review').isHidden(), false);
  assert.equal(await insideViewport(locate), true);
  assert.equal(await fitsViewport(), true);
  await page.locator('.row').last().click();
  await page.getByRole('button', { name: '修正文字' }).click();
  await page.waitForFunction(() => document.querySelector('#correction').open);
  assert.equal(await insideViewport(page.locator('#correction-text')), true);
  assert.equal(await insideViewport(page.getByRole('button', { name: '保存', exact: true })), true);
  assert.equal(await fitsViewport(), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#correction').open);

  const narrowName = await page.locator('#filename').textContent();
  const narrowDuration = await page.locator('#duration').textContent();
  const narrowOutput = await page.locator('#output-duration').textContent();
  const narrowRemoved = await page.locator('.row.removed').count();
  await page.getByRole('button', { name: '快捷键', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#shortcuts-dialog').open);
  assert.equal(await insideViewport(page.locator('#shortcuts-dialog-title')), true);
  assert.equal(await insideViewport(helpDialog.locator('p').first()), true);
  assert.equal(await insideViewport(page.getByRole('button', { name: '关闭', exact: true })), true);
  assert.equal(await fitsViewport(), true);
  if (process.env.LAYOUT_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.LAYOUT_SCREENSHOT_DIR}/layout-narrow-shortcuts-light.png` });
  }
  const narrowBlocked = [];
  const onNarrowBlocked = async dialog => {
    narrowBlocked.push(dialog.message());
    await dialog.dismiss();
  };
  page.on('dialog', onNarrowBlocked);
  try {
    await dropped('drop-sample.mp4', 'video/mp4', await readFile(samplePath));
    assert.doesNotMatch(await page.locator('#status').textContent(), /正在读取|视频已导入|已取消/);
    assert.equal(await helpDialog.evaluate(node => node.open), true);
    assert.equal(await page.locator('#drop-overlay').isHidden(), true);
    assert.equal(await page.locator('#filename').textContent(), narrowName);
  } finally {
    page.off('dialog', onNarrowBlocked);
  }
  assert.equal(narrowBlocked.length, 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#shortcuts-dialog').open);
  const narrowDirtyVideo = await captureDialogs('dismiss', async () => {
    await dropped('drop-sample.mp4', 'video/mp4', await readFile(samplePath));
    await page.getByRole('status').filter({ hasText: '已取消，当前编辑未改动' }).waitFor();
  });
  assert.equal(narrowDirtyVideo.length, 1);
  assert.equal(narrowDirtyVideo[0].type, 'confirm');
  assert.equal(narrowDirtyVideo[0].message, '当前编辑尚未保存，继续会清空这些编辑，要继续吗？');
  assert.equal(await page.locator('#filename').textContent(), narrowName);
  assert.equal(await page.locator('#duration').textContent(), narrowDuration);
  assert.equal(await page.locator('#output-duration').textContent(), narrowOutput);
  assert.equal(await page.locator('.row.removed').count(), narrowRemoved);
  assert.equal(await leaveWouldPrompt(), true);

  await suggestionTheme('dark');
  await page.locator('.workspace').scrollIntoViewIfNeeded();
  if (process.env.LAYOUT_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.LAYOUT_SCREENSHOT_DIR}/layout-narrow-dark.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '快捷键', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#shortcuts-dialog').open);
  assert.equal(await insideViewport(page.locator('#shortcuts-dialog-title')), true);
  assert.equal(await insideViewport(page.getByRole('button', { name: '关闭', exact: true })), true);
  if (process.env.LAYOUT_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.LAYOUT_SCREENSHOT_DIR}/layout-narrow-shortcuts-dark.png` });
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#shortcuts-dialog').open);
  await suggestionTheme('light');

  const restored = await captureDialogs('accept', () => page.setViewportSize({ width: 1280, height: 900 }));
  assert.equal(restored.length, 0);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.top')).flexWrap), 'nowrap');
  assert.equal(await headerSharesRow(), true);
  assert.equal(await fitsViewport(), true);

  step = '任务阶段';
  const jobLeave = await captureDialogs('accept', () => page.goto(address));
  assert.equal(jobLeave.length, 1);
  assert.equal(jobLeave[0].type, 'beforeunload');
  await page.waitForFunction(() => document.documentElement.dataset.themeReady === 'true');
  await suggestionTheme('light');
  await page.getByRole('button', { name: '打开样例' }).click();
  await page.locator('.row').first().waitFor();
  const jobUrls = [];
  let jobMode = 'pass';
  const fulfillJob = body => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route(/\/api\/jobs\/[0-9a-f-]{36}$/, async route => {
    const url = route.request().url();
    jobUrls.push(url);
    if (jobMode === 'encode') {
      return route.fulfill(fulfillJob({
        id: 'simulated', kind: 'export', state: 'running', progress: 0.2, stage: 'encode',
      }));
    }
    if (jobMode === 'fail') {
      return route.fulfill(fulfillJob({ state: 'failed', error: '导出未能完成', progress: 0.2, stage: 'encode' }));
    }
    if (jobMode === 'text') return route.fulfill({ status: 200, contentType: 'text/plain', body: 'not-json' });
    if (jobMode === 'abort') return route.abort('failed');
    return route.continue();
  });
  const waitServerJob = async () => {
    jobMode = 'pass';
    const url = jobUrls.at(-1);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await (await page.request.get(url)).json();
      if (status.state && status.state !== 'running') return status;
      await page.waitForTimeout(200);
    }
    throw new Error('服务端导出没有结束');
  };
  const exportButton = page.getByRole('button', { name: '导出成片', exact: true });
  const statusRoles = () => page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map(node => node.id));

  step = '任务阶段（模拟运行中）';
  jobMode = 'encode';
  const runningExport = exportButton.click();
  await page.locator('#job-text').filter({ hasText: '正在编码成片，完成时间不确定' }).waitFor();
  assert.equal(await page.locator('#job-note').textContent(), '仍可继续编辑。');
  assert.equal(await page.locator('#job-banner').isHidden(), false);
  assert.doesNotMatch(await page.locator('#job-banner').innerText(), /%/);
  assert.equal(await page.locator('#job-wait').getAttribute('aria-valuenow'), null);
  assert.equal(await page.locator('#job-wait').getAttribute('aria-valuemin'), null);
  assert.equal(await page.locator('#job-wait').getAttribute('aria-valuemax'), null);
  assert.equal(await page.locator('#job-wait').getAttribute('aria-valuetext'), '完成时间不确定');
  assert.deepEqual(await statusRoles(), ['status']);
  assert.equal(await exportButton.isDisabled(), true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('#job-wait').evaluate(node => getComputedStyle(node, '::before').animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (process.env.JOB_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.JOB_SCREENSHOT_DIR}/job-desktop-light.png` });
  }
  await suggestionTheme('dark');
  if (process.env.JOB_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.JOB_SCREENSHOT_DIR}/job-desktop-dark.png` });
  }
  await suggestionTheme('light');
  const narrowJob = await captureDialogs('accept', () => page.setViewportSize({ width: 390, height: 844 }));
  assert.equal(narrowJob.length, 0);
  assert.equal(await fitsViewport(), true);
  if (process.env.JOB_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.JOB_SCREENSHOT_DIR}/job-narrow-light.png` });
  }
  await suggestionTheme('dark');
  if (process.env.JOB_SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.JOB_SCREENSHOT_DIR}/job-narrow-dark.png` });
  }
  await suggestionTheme('light');
  const restoreJobViewport = await captureDialogs('accept', () => page.setViewportSize({ width: 1280, height: 900 }));
  assert.equal(restoreJobViewport.length, 0);

  await page.locator('.row').nth(1).click();
  await page.getByRole('button', { name: '剪掉区间' }).click();
  await page.locator('.row.removed').waitFor();
  assert.equal(await page.locator('#job-text').textContent(), '正在编码成片，完成时间不确定');
  assert.doesNotMatch(await page.locator('#status').textContent(), /%|正在编码/);
  assert.equal(await page.locator('#output-duration').textContent(), '00:10.000');
  jobMode = 'pass';
  await runningExport;
  await page.getByRole('status').filter({ hasText: '导出完成' }).waitFor();
  assert.equal(await page.locator('#job-banner').isHidden(), true);
  assert.match(await page.locator('#export-version').textContent(), /上一版成片/);
  await page.getByRole('link', { name: '下载 SRT' }).waitFor();
  assert.doesNotMatch(await page.locator('#status').textContent(), /%/);
  assert.equal(await exportButton.isDisabled(), false);
  const finished = await waitServerJob();
  assert.equal(finished.state, 'done');
  assert.equal(finished.progress, 1);
  assert.equal(finished.stage, 'write');

  step = '任务阶段（模拟失败）';
  jobMode = 'fail';
  await exportButton.click();
  await page.getByRole('status').filter({ hasText: '导出未能完成' }).waitFor();
  assert.equal(await page.locator('#status').evaluate(node => node.classList.contains('error')), true);
  assert.equal(await page.locator('#job-banner').isHidden(), true);
  assert.equal(await exportButton.isDisabled(), false);
  const failedOnServer = await waitServerJob();
  assert.equal(failedOnServer.state, 'done');
  assert.equal(failedOnServer.stage, 'write');

  step = '任务阶段（模拟无法读取）';
  jobMode = 'text';
  await exportButton.click();
  await page.getByRole('status').filter({ hasText: '任务状态暂时无法读取' }).waitFor();
  assert.equal(await page.locator('#job-banner').isHidden(), true);
  assert.equal(await exportButton.isDisabled(), false);
  assert.equal((await waitServerJob()).stage, 'write');

  step = '任务阶段（模拟网络中断）';
  jobMode = 'abort';
  await exportButton.click();
  await page.getByRole('status').filter({ hasText: '网络中断，任务状态暂时无法确认' }).waitFor();
  assert.equal(await page.locator('#job-banner').isHidden(), true);
  assert.equal(await exportButton.isDisabled(), false);
  assert.equal((await waitServerJob()).progress, 1);

  step = '任务阶段（模拟切素材）';
  jobMode = 'encode';
  const switchedExport = exportButton.click();
  await page.locator('#job-text').filter({ hasText: '正在编码成片，完成时间不确定' }).waitFor();
  const switched = await captureDialogs('accept', async () => {
    await dropped('drop-sample.mp4', 'video/mp4', await readFile(samplePath));
    await page.getByRole('status').filter({ hasText: '视频已导入' }).waitFor();
  });
  assert.equal(switched.length, 1);
  assert.match(switched[0].message, /当前编辑尚未保存/);
  assert.equal(await page.locator('#filename').textContent(), 'drop-sample.mp4');
  assert.equal(await page.locator('#job-banner').isHidden(), true);
  jobMode = 'pass';
  await switchedExport;
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#job-banner').isHidden(), true);
  assert.match(await page.locator('#status').textContent(), /视频已导入/);
  assert.doesNotMatch(await page.locator('#status').textContent(), /导出完成|%/);
  await page.unroute(/\/api\/jobs\/[0-9a-f-]{36}$/);

  console.log('浏览器验收通过，剪辑、预览、字幕导出、保存恢复、源文件不匹配校验均可用');
} catch (error) {
  console.error(`浏览器验收失败于「${step}」：${error.message}`);
  if (errors.length) console.error(`页面异常：${errors.join('\n')}`);
  const shot = BROWSER_SCREENSHOT || 'browser-failure.png';
  if (page) {
    await page.screenshot({ path: shot, fullPage: true }).catch(shotError => {
      console.error(`无法保存截图：${shotError.message}`);
    });
    console.error(`失败截图：${shot}`);
  }
  throw error;
} finally {
  if (browser) await browser.close();
  child.kill();
  await exit;
}
