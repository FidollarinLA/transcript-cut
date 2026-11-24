import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
  await timelineBars.last().click();
  await page.waitForFunction(() => document.querySelector('#player').currentTime >= 4);

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
