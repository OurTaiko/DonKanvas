import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLoop, measureStart, measureEnd } from './loop.js';
const bars = [{ start: -0.5, end: 1.5 }, { start: 2, end: 5 }, { start: 5, end: 6.5 }];
test('multi-bar loop includes both endpoints and timing changes', () => {
  assert.deepEqual(resolveLoop(bars, 2, 3, 10), { start: 2, end: 6.5, bars: bars.slice(1) });
});
test('single-bar loop remains supported', () => {
  assert.deepEqual(resolveLoop(bars, 2, 2, 10), { start: 2, end: 5, bars: [bars[1]] });
});
test('loop clips to audio boundaries', () => {
  const range = resolveLoop(bars, 1, 3, 6);
  assert.equal(range.start, 0); assert.equal(range.end, 6);
});
test('invalid ranges and ranges outside audio are rejected', () => {
  for (const [first,last] of [[0,2],[3,2],[1,4],[1.5,2],[NaN,2]]) assert.throws(() => resolveLoop(bars,first,last,10));
  assert.throws(() => resolveLoop(bars,3,3,4));
});
test('loop includes the leading delay of its first measure', () => {
  const delayed = [{ start: .5, end: 2.5, delay: 1 }, { start: 3, end: 5, delay: .5 }];
  assert.equal(resolveLoop(delayed, 2, 2, 10).start, 2.5);
  assert.equal(resolveLoop(delayed, 1, 2, 10).start, 0);
});
test('negative boundary delays include advanced notes rather than the old boundary', () => {
  const advanced = [{ start: 1.5, end: 3.5, delay: -.5 }];
  assert.equal(measureStart(advanced[0]), 1.5);
  assert.equal(resolveLoop(advanced, 1, 1, 10).start, 1.5);
});
test('backward intrabar jumps retain all segments even when the final cursor goes backward', () => {
  const advanced = [{ start: 2, end: 1, segments: [{ start: 2, end: 3 }, { start: 0, end: 1 }] }, { start: 1, end: 2 }];
  assert.equal(measureStart(advanced[0]), 0);
  assert.equal(measureEnd(advanced[0]), 3);
  const range = resolveLoop(advanced, 1, 2, 10);
  assert.equal(range.start, 0);
  assert.equal(range.end, 3);
});