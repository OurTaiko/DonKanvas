export const measureStart = bar => Math.min(bar.start - (bar.delay || 0), bar.start, bar.end, ...(bar.segments || []).map(segment => segment.start));
export const measureEnd = bar => Math.max(bar.start - (bar.delay || 0), bar.start, bar.end, ...(bar.segments || []).map(segment => segment.end));

export function resolveLoop(bars, first, last, audioDuration) {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > bars.length) throw new Error('循环范围须为有效小节编号，且结束小节不能早于起始小节。');
  const selected = bars.slice(first - 1, last);
  const start = Math.max(0, Math.min(...selected.map(measureStart)));
  const end = Math.min(audioDuration, Math.max(...selected.map(measureEnd)));
  if (end <= start) throw new Error('循环范围不在音频范围内。');
  return { start, end, bars: selected };
}