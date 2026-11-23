export function restoreStatus({ matched, cursor }) {
  if (!matched) return '项目与当前视频不匹配，请先导入同一个原视频。当前编辑未改动。';
  const steps = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
  const history = steps === 0
    ? '当前没有可撤销的编辑。'
    : steps === null
      ? '撤销记录已载入。'
      : `可撤销 ${steps} 步。`;
  return `源视频校验通过。转写稿、剪点和撤销记录已恢复。${history}`;
}
