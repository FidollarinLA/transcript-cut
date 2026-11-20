export const time = us => {
  const ms = Math.round(us / 1000);
  const minutes = String(Math.floor(ms / 60000)).padStart(2, '0');
  const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return `${minutes}:${seconds}.${String(ms % 1000).padStart(3, '0')}`;
};

const mismatchLimitUs = 100_000;

function trackUs(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function trackDurationTip(videoUs, audioUs) {
  const video = trackUs(videoUs);
  const audio = trackUs(audioUs);
  if (video === null || audio === null || Math.abs(video - audio) <= mismatchLimitUs) return '';
  return `视频轨 ${time(video)}，音频轨 ${time(audio)}，相差超过 0.1 秒。`;
}

export function appendTrackDurationTip(message, videoUs, audioUs) {
  const tip = trackDurationTip(videoUs, audioUs);
  return tip ? `${message}${tip}` : message;
}
