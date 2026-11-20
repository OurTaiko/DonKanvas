export function longHitTimes(spans, { from, until, anchor, origin, rate, start, end, loop }) {
  const times = [];
  const duration = end - start;
  if (duration <= 0 || until <= from || rate <= 0) return times;
  const firstCycle = loop ? Math.max(0, Math.floor((origin + (from - anchor) * rate - start) / duration)) : 0;
  const lastCycle = loop ? Math.max(firstCycle, Math.floor((origin + (until - anchor) * rate - start) / duration)) : 0;
  const step = rate / 16;
  for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
    const windowStart = origin + (from - anchor) * rate - cycle * duration;
    const windowEnd = origin + (until - anchor) * rate - cycle * duration;
    for (const span of spans) {
      const lower = Math.max(start, span.start, windowStart);
      const upper = Math.min(end, span.end, windowEnd);
      const firstHit = Math.max(0, Math.ceil((lower - span.start) / step - 1e-9));
      for (let hit = firstHit; ; hit++) {
        const time = span.start + hit * step;
        if (time >= upper) break;
        const when = anchor + (time - origin + cycle * duration) / rate;
        if (time >= start && when >= from && when < until) times.push(when);
      }
    }
  }
  return times.sort((first, second) => first - second);
}