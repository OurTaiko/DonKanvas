import test from 'node:test';
import assert from 'node:assert/strict';
import { longHitTimes } from './long-audio.js';

const options = { from: 10, until: 11, anchor: 10, origin: 0, rate: 1, start: 0, end: 4, loop: false };
const span = { note: '5', start: 0, end: 1 };

for (const note of ['5', '6', '7', '9']) test(`long note ${note} plays sixteen don hits per second, excluding its end`, () => {
  assert.deepEqual(longHitTimes([{ ...span, note }], options), Array.from({ length: 16 }, (_, index) => 10 + index / 16));
});

test('adjacent scheduling windows neither duplicate nor omit hits', () => {
  const times = [];
  for (let index = 0; index < 40; index++) {
    times.push(...longHitTimes([span], { ...options, from: 10 + index * .025, until: 10 + (index + 1) * .025 }));
  }
  assert.deepEqual(times, longHitTimes([span], options));
});

test('seeking into a span retains hit phase and skips earlier hits', () => {
  assert.deepEqual(longHitTimes([span], { ...options, origin: .3, until: 10.2 }), [10.0125, 10.075, 10.1375]);
});

test('loop clips a cross-bar span and repeats hits without doubling the boundary', () => {
  const times = longHitTimes([{ ...span, start: 0, end: 3 }], { ...options, origin: 1, start: 1, end: 2, until: 12.1, loop: true });
  assert.equal(times.length, 34);
  assert.equal(times.filter(time => time === 11).length, 1);
  assert.equal(times.at(-1), 12.0625);
});

test('playback rate changes keep sixteen hits per real second', () => {
  assert.equal(longHitTimes([{ ...span, end: 4 }], { ...options, rate: 2 }).length, 16);
  assert.equal(longHitTimes([span], { ...options, rate: .5 }).length, 16);
});

test('audio boundaries and spans outside the window produce no stray hits', () => {
  assert.deepEqual(longHitTimes([span], { ...options, start: 1 }), []);
  assert.equal(longHitTimes([span], { ...options, end: .25 }).length, 4);
});