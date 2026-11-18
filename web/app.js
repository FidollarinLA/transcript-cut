import { dispatch } from '/core.js';
import { calculateEdit } from '/edit-core.js';
import { appendTrackDurationTip, time } from '/status-tip.js';
import { matchShortcut } from '/shortcuts.js';

const el = id => document.getElementById(id);
const player = el('player');
const unit = 1_000_000;
const freshHistory = () => ({ operations: [], cursor: 0 });
const state = {
  asset: null, spans: [], history: freshHistory(), plan: null,
  suggestions: [], selection: null, revision: 0, whisper: false,
  busy: false, exporting: false, listenUntil: null,
};
let rows = new Map();
let activeRow;

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
  return !state.history.cursor || window.confirm('替换转写稿会清空当前编辑，继续吗？');
}

function setAsset(asset, name, message) {
  state.asset = asset;
  el('filename').textContent = name;
  el('empty-video').hidden = true;
  el('downloads').hidden = true;
  player.hidden = false;
  player.src = asset.media_url;
  el('preview').checked = false;
  state.listenUntil = null;
  replaceSpans(asset.spans);
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
  const timeline = el('timeline');
  timeline.replaceChildren();
  const parts = [...plan.kept, ...plan.deleted.map(cut => ({ ...cut, removed: true }))];
  for (const part of parts.sort((a, b) => a.start_us - b.start_us)) {
    const bar = element('span', part.removed ? 'removed' : '', '');
    bar.style.flexGrow = String(part.end_us - part.start_us);
    bar.title = `${part.removed ? '剪除' : '保留'} ${time(part.start_us)} – ${time(part.end_us)}（点击跳转）`;
    bar.onclick = () => {
      if (state.asset) {
        state.listenUntil = null;
        player.currentTime = part.start_us / unit;
      }
    };
    timeline.append(bar);
  }
  el('duration').textContent = time(asset.duration_us);
  el('output-duration').textContent = time(plan.output_duration_us);
  el('cut-duration').textContent = time(asset.duration_us - plan.output_duration_us);
  const available = state.suggestions.filter(s => !covered(s.start_us, s.end_us));
  const suggestions = el('suggestions');
  suggestions.replaceChildren();
  el('suggestion-count').textContent = available.length ? `${available.length} 个待复听` : '';
  if (!available.length) suggestions.append(element('p', 'empty-copy', spans.length ? '当前没有待复听的建议。' : '载入转写稿后可查看建议。'));
  for (const s of available) {
    const label = { filler: '口头禅', repeat: '重复句', pause: '长停顿' }[s.kind];
    const button = element('button', '', `${label} · ${time(s.start_us)}`);
    button.type = 'button';
    button.addEventListener('click', () => {
      state.selection = { span: s.kind === 'pause' ? null : spans.find(span => span.id === s.span_id), label };
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

function updatePlayback() {
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
    notice(state.plan.partial_span_ids.length ? '部分切断了句级字幕。这些字幕已从导出中略去，可调整切点后重试。' : '');
  } catch (error) {
    notice(error.message, true);
  }
}

el('demo').onclick = () => perform('正在打开样例…', async () => {
  setAsset(await post('/api/demo'), '样例 · 12 秒测试片', '样例已就绪。请选择一行，复听后剪掉，再导出。');
});
el('video-file').onchange = event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  void perform('正在读取视频…', async () => {
    setAsset(await request('/api/assets', { method: 'POST', body: file }), file.name, '视频已导入。可以导入同源 SRT 或自动转写。');
  });
};
el('srt-file').onchange = event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || !allowReplacingTranscript()) return;
  void perform('正在读取字幕…', async () => {
    const { spans } = await request(assetPath('srt'), { method: 'POST', body: file });
    replaceSpans(spans);
    notice(`已导入 ${spans.length} 个句段。`);
  });
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
      throw new Error('项目与当前视频不匹配，请先导入同一个原视频');
    }
    const edit = requestEdit('plan', null, project.spans, project.history);
    state.spans = project.spans;
    state.selection = null;
    acceptEdit(edit);
    showSelection();
    notice('转写稿、剪点和撤销记录已恢复。');
  });
};
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

window.addEventListener('keydown', event => {
  const isDialogOpen = el('correction').open;
  const action = matchShortcut(event, { isDialogOpen });
  if (!action) return;

  switch (action) {
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
