function intervalAt(points, value, key) {
  let low = 0, high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle][key] <= value) low = middle + 1;
    else high = middle;
  }
  return points[low - 1];
}

export function createBeatTimeline(chart) {
  const baseBpm = chart?.baseBpm ?? 120;
  const changes = (chart?.bars ?? []).flatMap(bar => [
    ...bar.instructions.filter(event => event.name === 'BPMCHANGE').map(event => ({ time: event.time, bpm: Number(event.value) })),
    ...bar.segments.map(segment => ({ time: segment.start, bpm: segment.bpm }))
  ]).sort((first, second) => first.time - second.time);
  const points = [];
  let time = 0, beat = 0, bpm = baseBpm;
  for (const change of changes) {
    beat += (change.time - time) * bpm / 60;
    time = change.time; bpm = change.bpm;
    if (points.at(-1)?.time === time) points.pop();
    points.push({ time, beat, bpm });
  }
  const rawBeatAt = value => {
    const point = intervalAt(points, value, 'time');
    return point ? point.beat + (value - point.time) * point.bpm / 60 : value * baseBpm / 60;
  };
  const origin = rawBeatAt(0);
  for (const point of points) point.beat -= origin;
  return {
    beatAt(value) {
      const point = intervalAt(points, value, 'time');
      return point ? point.beat + (value - point.time) * point.bpm / 60 : value * baseBpm / 60 - origin;
    },
    timeAt(value) {
      const point = intervalAt(points, value, 'beat');
      return point ? point.time + (value - point.beat) * 60 / point.bpm : (value + origin) * 60 / baseBpm;
    }
  };
}
