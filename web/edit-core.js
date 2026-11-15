export function calculateEdit(dispatch, request) {
  // MoonBit's Int64 JSON codec uses decimal strings. UI and HTTP use safe JS integers.
  const input = JSON.stringify(request, (key, value) => {
    if (key === 'operation' && value === null) return undefined;
    if (key === 'cursor' && !Number.isSafeInteger(value)) throw new Error('编辑历史位置无效');
    if (!key.endsWith('_us')) return value;
    if (!Number.isSafeInteger(value)) throw new Error('无法解析编辑请求：时标必须是整数微秒');
    return String(value);
  });
  return JSON.parse(dispatch(input), (key, value) => key.endsWith('_us') ? Number(value) : value);
}
