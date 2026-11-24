import {
  assetReplacePrompt,
  editSignature,
  isEditDirty,
  leavePromptNeeded,
  replaceCancelledNotice,
  restoreNoticeClearsDirty,
  saveNoticeClearsDirty,
  transcriptReplacePrompt,
} from '/edit-dirty.js';
import { dispatch } from '/core.js';
import { calculateEdit } from '/edit-core.js';
import { partialReview } from '/review-hint.js';
import { restoreStatus } from '/restore-status.js';
import { appendTrackDurationTip, time } from '/status-tip.js';
import { classifyDrop } from '/drop-file.js';
import { matchShortcut } from '/shortcuts.js';
import { shortcutHelp } from '/shortcuts.js';

const el = id => document.getElementById(id);
const player = el('player');
const unit = 1_000_000;
const THEME_KEY = 'transcript-cut-theme';
let pointerLabel = '';
let focusLabel = '';

function readStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme, source) {
  const root = document.documentElement;
  root.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  root.dataset.themeSource = source;
  root.dataset.themeReady = 'true';
  const button = el('theme');
  if (!button) return;
  const dark = root.dataset.theme === 'dark';
  button.setAttribute('aria-pressed', String(dark));
  const name = dark ? '深色' : '浅色';
  button.title = source === 'saved' ? `当前${name}，点击切换` : `当前跟随系统（${name}），点击切换`;
}

function initTheme() {
  const stored = readStoredTheme();
  applyTheme(stored ?? systemTheme(), stored ? 'saved' : 'system');
  el('theme')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* 隐私模式或配额不足时仍切换当前页 */ }
    applyTheme(next, 'saved');
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!readStoredTheme()) applyTheme(systemTheme(), 'system');
  });
}

function currentUs() {
  const seconds = Number.isFinite(player.currentTime) ? player.currentTime : 0;
  return Math.max(0, Math.round(seconds * unit));
}

function paintTimelineStatus() {
  const readout = el('timeline-readout');
  if (!readout) return;
  const here = state.asset ? `当前位置 ${time(currentUs())}` : '';
  const mark = focusLabel || pointerLabel;
  if (here && mark) readout.textContent = `${here} · ${mark}`;
  else if (mark) readout.textContent = mark;
  else if (here) readout.textContent = here;
  else readout.textContent = '导入视频后，悬停或聚焦时间轴可查看当前位置';
}

function placePlayhead() {
  const head = document.querySelector('#timeline .playhead');
  if (!head || !state.asset?.duration_us) return;
  const ratio = Math.min(1, Math.max(0, currentUs() / state.asset.duration_us));
  head.style.left = ratio >= 1 ? 'calc(100% - 2px)' : `${ratio * 100}%`;
}

const freshHistory = () => ({ operations: [], cursor: 0 });
const state = {
  asset: null, spans: [], history: freshHistory(), plan: null,
  suggestions: [], selection: null, revision: 0, whisper: false,
  busy: false, exporting: false, listenUntil: null,
};
let rows = new Map();
let activeRow;
let savedSignature = editSignature(state.spans, state.history);
initTheme();

function editIsDirty() {
  return isEditDirty(state.spans, state.history, savedSignature);
}

function markClean() {
  savedSignature = editSignature(state.spans, state.history);
}

async function request(path, options) {
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}

const post = (path, data) => request(path, {
  method: 'POST',
  body: data === undefined ? undefined : JSON.stringify(data),
  headers: { 'Content-Type': 'application/json' },
});
const assetPath = action => `/api/assets/${state.asset.id}/${action}`;

function notice(text, error = false) {
  const region = el('status');
  region.textContent = text;
  region.hidden = !text;
  region.classList.toggle('error', error);
  if (restoreNoticeClearsDirty(text, error)) markClean();
}

function controls() {
  const ready = !!state.asset && !state.busy;
  el('demo').disabled = state.busy;
  el('video-file').disabled = state.busy;
  el('srt-file').disabled = !ready;
  el('project-file').disabled = !ready;
  el('save-project').disabled = !ready;
  el('transcribe').disabled = !ready || !state.whisper;
  el('language').disabled = !ready || !state.whisper;
  el('preview').disabled = !state.asset;
  el('undo').disabled = !ready || state.history.cursor === 0;
  el('redo').disabled = !ready || state.history.cursor === state.history.operations.length;
  el('export').disabled = !ready || state.exporting || !state.plan?.kept.length;
  el('remove').disabled = state.busy;
  el('correct').disabled = state.busy || !state.selection?.span;
}

async function perform(message, operation) {
  state.busy = true;
  controls();
  notice(message);
  try {
    await operation();
  } catch (error) {
    notice(error.message, true);
  } finally {
    state.busy = false;
    controls();
  }
}

function requestEdit(action, operation, spans, history) {
  const result = calculateEdit(dispatch, {
    duration_us: state.asset.duration_us, spans, history, action, operation,
  });
  if (result.error) throw new Error(result.error);
  return result;
}

function acceptEdit(result) {
  Object.assign(state, result);
  state.revision++;
  if (!el('downloads').hidden) el('export-version').textContent = '上一版成片';
  render();
}

function recalculate(action = 'plan', operation = null) {
  acceptEdit(requestEdit(action, operation, state.spans, state.history));
}

function replaceSpans(spans) {
  state.spans = spans;
  state.history = freshHistory();
  state.selection = null;
  recalculate();
  showSelection();
}

function allowReplacingTranscript() {
  if (!editIsDirty()) return true;
  if (window.confirm(transcriptReplacePrompt)) return true;
  notice(replaceCancelledNotice);
  return false;
}

function setAsset(asset, name, message) {
  if (editIsDirty() && !window.confirm(assetReplacePrompt)) {
    notice(replaceCancelledNotice);
    return;
  }
  state.asset = asset;
  el('filename').textContent = name;
  el('empty-video').hidden = true;
  el('downloads').hidden = true;
  player.hidden = false;
  player.src = asset.media_url;
  el('preview').checked = false;
  state.listenUntil = null;
  replaceSpans(asset.spans);
  markClean();
  notice(appendTrackDurationTip(message, asset.video_duration_us, asset.audio_duration_us));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function covered(start, end) {
  return state.plan.deleted.some(cut => cut.start_us <= start && cut.end_us >= end);
}

function render() {
  const { plan, asset, spans, history } = state;
  const corrected = new Map();
  for (const op of history.operations.slice(0, history.cursor)) {
    if (op.kind === 'correct') corrected.set(op.span_id, op.text);
  }
  rows = new Map();
  activeRow = undefined;
  const partial = new Set(plan.partial_span_ids);
  const transcript = el('transcript');
  transcript.replaceChildren();
  if (!spans.length) transcript.append(element('p', 'empty-copy', '导入 SRT 或自动转写后，点击文字定位原视频。'));
  el('select-help').hidden = spans.length < 2;
  const review = partialReview(spans, plan.partial_span_ids);
  const reviewBar = el('review');
  reviewBar.hidden = !review;
  if (review) {
    el('review-text').textContent = review.message;
    const locate = el('review-locate');
    locate.textContent = review.locateLabel;
    locate.onclick = () => {
      const span = spans.find(item => partial.has(item.id));
      if (span) selectSpan(span, false);
    };
  }
  for (const span of spans) {
    const removed = covered(span.start_us, span.end_us);
    const button = element('button', `row${removed ? ' removed' : ''}`, '');
    button.type = 'button';
    const text = corrected.get(span.id) ?? span.text;
    const badge = removed ? '已剪除' : partial.has(span.id) ? '字幕需复核' : '';
    button.append(element('span', 'time', time(span.start_us)), element('span', 'line', text || '（空字幕）'), element('small', '', badge));
    button.onclick = event => selectSpan(span, event.shiftKey);
    rows.set(span.id, { button, text });
    transcript.append(button);
  }
  renderTimeline(plan);
  el('duration').textContent = time(asset.duration_us);
  el('output-duration').textContent = time(plan.output_duration_us);
  el('cut-duration').textContent = time(asset.duration_us - plan.output_duration_us);
  const available = state.suggestions.filter(s => !covered(s.start_us, s.end_us));
  const suggestions = el('suggestions');
  suggestions.replaceChildren();
  el('suggestion-count').textContent = available.length ? `${available.length} 个待复听` : '';
  if (!available.length) suggestions.append(element('p', 'empty-copy', spans.length ? '当前没有待复听的建议。' : '载入转写稿后可查看建议。'));
  for (const s of available) {
    const fallback = { filler: '口头禅', repeat: '重复句', pause: '长停顿' }[s.kind] || '建议';
    const label = s.reason || fallback;
    const button = element('button', '', `${label} · ${time(s.start_us)}`);
    button.type = 'button';
    button.title = `${label}（${time(s.start_us)} – ${time(s.end_us)}，点击复听并选定）`;
    button.addEventListener('click', () => {
      state.selection = {
        span: s.kind === 'pause' ? null : spans.find(span => span.id === s.span_id),
        label,
      };
      showSelection(s.start_us, s.end_us);
      listen(s.start_us, s.end_us);
    });
    suggestions.append(button);
  }
  if (state.selection) showSelection();
  updatePlayback();
  controls();
}

function selectSpan(span, extend) {
  const anchor = (extend && state.selection?.anchor) || span.id;
  const anchorIndex = state.spans.findIndex(item => item.id === anchor);
  const nextIndex = state.spans.findIndex(item => item.id === span.id);
  const startIndex = Math.min(anchorIndex, nextIndex);
  const endIndex = Math.max(anchorIndex, nextIndex);
  const selected = state.spans.slice(startIndex, endIndex + 1);
  const start = selected[0].start_us;
  const end = selected.reduce((latest, item) => Math.max(latest, item.end_us), start);
  state.selection = selected.length === 1 ? { anchor, span } : {
    anchor,
    ids: new Set(selected.map(item => item.id)),
    label: `已选 ${selected.length} 行`,
  };
  player.pause();
  state.listenUntil = null;
  el('preview').checked = false;
  player.currentTime = start / unit;
  showSelection(start, end);
}

function showSelection(start, end) {
  const selection = state.selection;
  el('selection').hidden = !selection;
  for (const [id, { button }] of rows) {
    const selected = id === selection?.span?.id || Boolean(selection?.ids?.has(id));
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  if (!selection) return;
  const text = rows.get(selection.span?.id)?.text;
  el('selected-text').textContent = [selection.label, text].filter(Boolean).join(' · ') || '当前字幕为空';
  if (start !== undefined) {
    el('start').value = (start / unit).toFixed(start % 1000 ? 6 : 3);
    el('end').value = (end / unit).toFixed(end % 1000 ? 6 : 3);
  }
  controls();
}

function editRange() {
  const start = el('start').valueAsNumber;
  const end = el('end').valueAsNumber;
  const startUs = Math.round(start * unit);
  const endUs = Math.round(end * unit);
  if (!(startUs >= 0 && startUs < endUs && endUs <= state.asset.duration_us)) throw new Error('请填写视频范围内有效的起止时间');
  return [startUs, endUs];
}

function listen(start, end) {
  el('preview').checked = false;
  player.currentTime = start / unit;
  state.listenUntil = end / unit;
  player.play().catch(error => notice(error.message, true));
}

function renderTimeline(plan) {
  pointerLabel = '';
  focusLabel = '';
  const timeline = el('timeline');
  timeline.replaceChildren();
  const parts = [...plan.kept, ...plan.deleted.map(cut => ({ ...cut, removed: true }))];
  for (const part of parts.sort((a, b) => a.start_us - b.start_us)) {
    const bar = element('span', part.removed ? 'removed' : '', '');
    const label = `${part.removed ? '剪除' : '保留'} ${time(part.start_us)} – ${time(part.end_us)}`;
    bar.style.flexGrow = String(part.end_us - part.start_us);
    bar.tabIndex = 0;
    bar.setAttribute('role', 'button');
    bar.title = `${label}（点击跳转）`;
    bar.setAttribute('aria-label', `${label}（点击跳转）`);
    const jump = () => {
      if (!state.asset) return;
      state.listenUntil = null;
      player.currentTime = part.start_us / unit;
      placePlayhead();
      paintTimelineStatus();
    };
    bar.addEventListener('click', jump);
    bar.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      jump();
    });
    bar.addEventListener('mouseenter', () => {
      pointerLabel = label;
      paintTimelineStatus();
    });
    bar.addEventListener('mouseleave', () => {
      pointerLabel = '';
      paintTimelineStatus();
    });
    bar.addEventListener('focus', () => {
      focusLabel = label;
      paintTimelineStatus();
    });
    bar.addEventListener('blur', () => {
      focusLabel = '';
      paintTimelineStatus();
    });
    timeline.append(bar);
  }
  const playhead = document.createElement('div');
  playhead.className = 'playhead';
  playhead.setAttribute('aria-hidden', 'true');
  timeline.append(playhead);
  placePlayhead();
  paintTimelineStatus();
}

function updatePlayback() {
  placePlayhead();
  paintTimelineStatus();
  if (!state.plan || player.seeking) return;
  if (state.listenUntil !== null && player.currentTime >= state.listenUntil) {
    player.pause();
    state.listenUntil = null;
  }
  const now = Math.round(player.currentTime * unit);
  if (el('preview').checked && !player.paused) {
    const cut = state.plan.deleted.find(cut => cut.start_us <= now && now < cut.end_us);
    if (cut) {
      if (cut.end_us >= state.asset.duration_us) player.pause();
      player.currentTime = cut.end_us / unit;
      return;
    }
  }
  const span = state.spans.find(item => item.start_us <= now && now < item.end_us);
  const next = rows.get(span?.id)?.button;
  if (next !== activeRow) {
    activeRow?.classList.remove('active');
    next?.classList.add('active');
    activeRow = next;
  }
}

async function waitForJob(id, onProgress) {
  for (;;) {
    const job = await request(`/api/jobs/${id}`);
    if (job.progress !== undefined && onProgress) onProgress(job.progress);
    if (job.state === 'done') return job.result;
    if (job.state === 'failed') throw new Error(job.error);
    await new Promise(resolve => setTimeout(resolve, 450));
  }
}

function apply(action, operation) {
  try {
    recalculate(action, operation);
    const review = partialReview(state.spans, state.plan.partial_span_ids);
    notice(review ? review.message : '');
  } catch (error) {
    notice(error.message, true);
  }
}

el('demo').onclick = () => perform('正在打开样例…', async () => {
  setAsset(await post('/api/demo'), '样例 · 12 秒测试片', '样例已就绪。请选择一行，复听后剪掉，再导出。');
});

function importVideo(file) {
  if (!file) return;
  void perform('正在读取视频…', async () => {
    setAsset(await request('/api/assets', { method: 'POST', body: file }), file.name, '视频已导入。可以导入同源 SRT 或自动转写。');
  });
}

function importSrt(file) {
  if (!file || !allowReplacingTranscript()) return;
  void perform('正在读取字幕…', async () => {
    const { spans } = await request(assetPath('srt'), { method: 'POST', body: file });
    replaceSpans(spans);
    notice(`已导入 ${spans.length} 个句段。`);
  });
}

function importProject(file) {
  if (!file || !allowReplacingTranscript()) return;
  void perform('正在恢复项目…', async () => {
    if (file.size > 10_000_000) throw new Error('项目文件超过 10 MB');
    let project;
    try {
      project = JSON.parse(await file.text());
    } catch {
      throw new Error('项目文件不是有效的 JSON');
    }
    if (project?.format !== 'transcript-cut' || project.schema_version !== 1) {
      throw new Error('项目文件格式或版本不受支持');
    }
    if (project.source?.sha256 !== state.asset.sha256 || project.source?.duration_us !== state.asset.duration_us) {
      throw new Error(restoreStatus({ matched: false }));
    }
    const edit = requestEdit('plan', null, project.spans, project.history);
    state.spans = project.spans;
    state.selection = null;
    acceptEdit(edit);
    showSelection();
    notice(restoreStatus({ matched: true, cursor: state.history.cursor }));
  });
}

function importByKind(kind, file) {
  if (kind === 'video') importVideo(file);
  else if (kind === 'srt') importSrt(file);
  else importProject(file);
}

el('video-file').onchange = event => {
  const file = event.target.files[0];
  event.target.value = '';
  importVideo(file);
};
el('srt-file').onchange = event => {
  const file = event.target.files[0];
  event.target.value = '';
  importSrt(file);
};
el('save-project').onclick = () => {
  const project = {
    format: 'transcript-cut',
    schema_version: 1,
    source: { sha256: state.asset.sha256, duration_us: state.asset.duration_us },
    spans: state.spans,
    history: state.history,
  };
  const address = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = address;
  link.download = '文字剪视频.transcript-cut.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(address), 30_000);
  notice('项目文件已生成。恢复时请先导入同一个原视频。');
};
el('project-file').onchange = event => {
  const file = event.target.files[0];
  event.target.value = '';
  importProject(file);
};

let dragDepth = 0;

function fileDrag(event) {
  const types = [...(event.dataTransfer?.types || [])];
  return types.includes('Files') || (event.dataTransfer?.files?.length || 0) > 0;
}

function hideDropOverlay() {
  dragDepth = 0;
  el('drop-overlay').hidden = true;
}

window.addEventListener('dragenter', event => {
  if (!fileDrag(event)) return;
  event.preventDefault();
  dragDepth += 1;
  el('drop-overlay').hidden = false;
});
window.addEventListener('dragover', event => {
  if (!fileDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', () => {
  if (dragDepth === 0) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) el('drop-overlay').hidden = true;
});
window.addEventListener('drop', event => {
  if (!fileDrag(event)) return;
  event.preventDefault();
  hideDropOverlay();
  const dropped = classifyDrop(event.dataTransfer?.files);
  if (dropped.error) {
    notice(dropped.error, true);
    return;
  }
  if (state.busy) {
    notice('请等待当前操作完成。', true);
    return;
  }
  if (dropped.kind !== 'video' && !state.asset) {
    notice('请先导入 MP4，再拖入字幕或项目。', true);
    return;
  }
  importByKind(dropped.kind, dropped.file);
});
el('transcribe').onclick = () => {
  if (!allowReplacingTranscript()) return;
  void perform('Whisper 正在本机转写，可以先看原视频。', async () => {
    const { id } = await post(assetPath('transcribe'), { language: el('language').value });
    const { spans } = await waitForJob(id, progress => {
      notice(`Whisper 正在本机转写（${Math.round(progress * 100)}%），可以先看原视频。`);
    });
    replaceSpans(spans);
    notice(`转写完成，共 ${spans.length} 个句段。请复听后确认切点。`);
  });
};
el('undo').onclick = () => apply('undo');
el('redo').onclick = () => apply('redo');
el('listen').onclick = () => {
  try { listen(...editRange()); } catch (error) { notice(error.message, true); }
};
el('remove').onclick = () => {
  try {
    const [start_us, end_us] = editRange();
    apply('apply', { kind: 'cut', span_id: '', start_us, end_us, text: '' });
  } catch (error) { notice(error.message, true); }
};
el('correct').onclick = () => {
  el('correction-text').value = rows.get(state.selection.span.id).text;
  el('correction').returnValue = '';
  el('correction').showModal();
};
el('correction').addEventListener('close', event => {
  if (event.target.returnValue !== 'save') return;
  apply('apply', { kind: 'correct', span_id: state.selection.span.id, start_us: 0, end_us: 0, text: el('correction-text').value });
});
el('preview').onchange = () => {
  state.listenUntil = null;
  if (el('preview').checked) updatePlayback();
};
for (const event of ['timeupdate', 'seeked', 'playing']) player.addEventListener(event, updatePlayback);
player.addEventListener('error', () => notice('浏览器无法播放这段视频，请尝试 Chrome 或 Edge。', true));
if (player.requestVideoFrameCallback) {
  const onFrame = () => { updatePlayback(); player.requestVideoFrameCallback(onFrame); };
  player.requestVideoFrameCallback(onFrame);
}

function anyDialogOpen() {
  return [...document.querySelectorAll('dialog')].some(dialog => dialog.open);
}

function renderShortcutHelp() {
  const list = el('shortcuts-list');
  if (!list) return;
  list.replaceChildren();
  for (const group of shortcutHelp) {
    const section = document.createElement('section');
    section.className = 'shortcut-group';
    const heading = document.createElement('h3');
    heading.textContent = group.title;
    section.append(heading);
    for (const row of group.rows) {
      const line = document.createElement('div');
      line.className = 'shortcut-row';
      const keys = document.createElement('span');
      keys.className = 'shortcut-keys';
      row.keys.forEach((key, index) => {
        if (index > 0) keys.append(document.createTextNode('/'));
        const keycap = document.createElement('kbd');
        keycap.textContent = key;
        keys.append(keycap);
      });
      const label = document.createElement('span');
      label.textContent = row.label;
      line.append(keys, label);
      section.append(line);
    }
    list.append(section);
  }
}

let shortcutHelpFocus = null;

function openShortcutHelp() {
  const dialog = el('shortcuts-dialog');
  if (!dialog || anyDialogOpen()) return;
  const active = document.activeElement;
  shortcutHelpFocus = active instanceof HTMLElement && active !== document.body
    ? active
    : el('shortcuts-help');
  dialog.showModal();
  dialog.scrollTop = 0;
  el('shortcuts-list').scrollTop = 0;
}

renderShortcutHelp();
el('shortcuts-help').onclick = () => openShortcutHelp();
el('shortcuts-dialog').addEventListener('close', () => {
  const target = shortcutHelpFocus;
  shortcutHelpFocus = null;
  if (target?.isConnected) target.focus();
});

window.addEventListener('keydown', event => {
  const action = matchShortcut(event, { isDialogOpen: anyDialogOpen() });
  if (!action) return;

  switch (action) {
    case 'help': {
      event.preventDefault();
      openShortcutHelp();
      break;
    }
    case 'play-pause': {
      if (state.asset) {
        event.preventDefault();
        state.listenUntil = null;
        if (player.paused) {
          player.play().catch(error => notice(error.message, true));
        } else {
          player.pause();
        }
      }
      break;
    }
    case 'undo': {
      if (state.asset && !state.busy && state.history.cursor > 0) {
        event.preventDefault();
        apply('undo');
      }
      break;
    }
    case 'redo': {
      if (state.asset && !state.busy && state.history.cursor < state.history.operations.length) {
        event.preventDefault();
        apply('redo');
      }
      break;
    }
    case 'step-back': {
      if (state.asset) {
        event.preventDefault();
        state.listenUntil = null;
        player.currentTime = Math.max(0, player.currentTime - 1);
      }
      break;
    }
    case 'step-forward': {
      if (state.asset) {
        event.preventDefault();
        state.listenUntil = null;
        const maxTime = state.asset.duration_us / unit;
        player.currentTime = Math.min(maxTime, player.currentTime + 1);
      }
      break;
    }
    case 'cut': {
      if (state.selection && !state.busy) {
        event.preventDefault();
        el('remove').click();
      }
      break;
    }
    case 'select-prev':
    case 'extend-prev':
    case 'select-next':
    case 'extend-next': {
      if (state.spans.length && !state.busy) {
        event.preventDefault();
        const extend = action.startsWith('extend');
        const isNext = action.endsWith('next');
        let targetIndex = 0;
        if (state.selection) {
          const currentAnchor = state.selection.span?.id || state.selection.anchor;
          const currentIndex = state.spans.findIndex(item => item.id === currentAnchor);
          targetIndex = isNext
            ? Math.min(state.spans.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
        } else {
          targetIndex = isNext ? 0 : state.spans.length - 1;
        }
        const targetSpan = state.spans[targetIndex];
        if (targetSpan) {
          selectSpan(targetSpan, extend);
          rows.get(targetSpan.id)?.button?.scrollIntoView({ block: 'nearest' });
        }
      }
      break;
    }
    case 'escape': {
      if (state.selection) {
        event.preventDefault();
        state.selection = null;
        showSelection();
      }
      break;
    }
  }
});

el('export').onclick = async () => {
  const assetId = state.asset.id;
  const revision = state.revision;
  const path = assetPath('export');
  state.exporting = true;
  controls();
  notice('正在导出，仍可继续编辑。');
  try {
    const { id } = await post(path, { spans: state.spans, history: state.history });
    const finished = await waitForJob(id, progress => {
      notice(`正在导出（${Math.round(progress * 100)}%），仍可继续编辑。`);
    });
    if (state.asset.id !== assetId) return;
    const label = element('span', '', `${revision === state.revision ? '成片' : '上一版成片'} · ${time(finished.duration_us)}`);
    label.id = 'export-version';
    const links = [['cut.mp4', '下载 MP4'], ['captions.srt', '下载 SRT']].map(([file, text]) => {
      const anchor = element('a', '', text);
      anchor.href = `/api/jobs/${id}/${file}`;
      anchor.download = file;
      return anchor;
    });
    el('downloads').replaceChildren(label, ...links);
    el('downloads').hidden = false;
    notice('导出完成。');
  } catch (error) {
    if (state.asset.id === assetId) notice(error.message, true);
  } finally {
    state.exporting = false;
    controls();
  }
};

request('/api/config').then(config => {
  state.whisper = config.whisper;
  el('transcribe-help').textContent = state.whisper ? '' : '未配置本地模型，可导入 SRT';
  controls();
}).catch(error => notice(error.message, true));

window.addEventListener('beforeunload', event => {
  if (!leavePromptNeeded(editIsDirty())) return;
  event.preventDefault();
  event.returnValue = '';
});

const saveButton = el('save-project');
const saveProject = saveButton.onclick;
saveButton.onclick = event => {
  try {
    saveProject.call(saveButton, event);
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : '项目文件未能生成，当前编辑仍未保存。';
    notice(message, true);
    return;
  }
  if (saveNoticeClearsDirty(el('status').textContent, el('status').classList.contains('error'))) markClean();
};
