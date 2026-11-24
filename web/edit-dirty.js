export const transcriptReplacePrompt = '替换转写稿会清空当前编辑，继续吗？';
export const assetReplacePrompt = '当前编辑尚未保存，继续会清空这些编辑，要继续吗？';
export const replaceCancelledNotice = '已取消，当前编辑未改动。';

export function editSignature(spans, history) {
  return JSON.stringify({
    spans: spans ?? [],
    history: history ?? { operations: [], cursor: 0 },
  });
}

export function isEditDirty(spans, history, savedSignature) {
  return editSignature(spans, history) !== savedSignature;
}

export function restoreNoticeClearsDirty(text, isError = false) {
  return !isError && String(text || '').includes('转写稿、剪点和撤销记录已恢复');
}

export function saveNoticeClearsDirty(text, isError = false) {
  return !isError && String(text || '').includes('项目文件已生成');
}

export function leavePromptNeeded(dirty) {
  return dirty === true;
}
