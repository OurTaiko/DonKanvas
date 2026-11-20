import { message, LocalizedError } from './i18n.js';
export const measureStart = bar => Math.min(bar.start - (bar.delay || 0), bar.start, bar.end, ...(bar.segments || []).map(segment => segment.start));
export const measureEnd = bar => Math.max(bar.start - (bar.delay || 0), bar.start, bar.end, ...(bar.segments || []).map(segment => segment.end));

export function resolveLoop(bars, first, last, duration) {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > bars.length) throw new LocalizedError(message('循环范围须为有效小节编号，且结束小节不能早于起始小节。'));
  const selected = bars.slice(first - 1, last);
  const start = Math.max(0, Math.min(...selected.map(measureStart)));
  const end = Math.min(duration, Math.max(...selected.map(measureEnd)));
  if (end <= start) throw new LocalizedError(message('循环范围没有可播放的正时间区间。'));
  return { start, end, bars: selected };
}