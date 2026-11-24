const stages = {
  export: {
    check: '正在核对保留片段',
    encode: '正在编码成片，完成时间不确定',
    write: '正在保存成片和字幕',
  },
  transcribe: {
    transcribe: '正在本机转写，完成时间不确定',
    finish: '正在整理转写结果',
  },
};

export function jobStageText(kind, stage) {
  return stages[kind]?.[stage] || '正在处理，完成时间不确定';
}

export function jobPollError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!message || /failed to fetch|networkerror|network|net::|aborted|econn|timeout/i.test(message)) {
    return '网络中断，任务状态暂时无法确认';
  }
  if (error instanceof SyntaxError || /unexpected token|not valid json|无法读取/i.test(message)) {
    return '任务状态暂时无法读取';
  }
  return message;
}
