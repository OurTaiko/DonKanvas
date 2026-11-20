import test from 'node:test';
import assert from 'node:assert/strict';
import { createHitBuffer, MIX_DEFAULTS, duckMusic } from './hit-audio.js';
const context = { sampleRate: 48000, createBuffer(channels, length, sampleRate) { const data = new Float32Array(length); return { length, sampleRate, duration: length / sampleRate, getChannelData: () => data }; } };
for (const note of ['1','2','3','4']) test(`note ${note} produces a strong, finite, decaying signal`, () => {
  const buffer = createHitBuffer(context, note), samples = buffer.getChannelData(0);
  assert.ok(samples.every(Number.isFinite));
  assert.ok(Math.max(...samples.map(Math.abs)) > 0.89);
  const rms = Math.sqrt(samples.slice(0,2400).reduce((sum,value) => sum + value * value,0) / 2400);
  assert.ok(rms > 0.15);
  assert.equal(samples[0],0);
  assert.ok(Math.abs(samples.at(-1)) < 0.001);
});
test('don and ka have distinct waveforms', () => {
  const don = createHitBuffer(context,'1'), ka = createHitBuffer(context,'2');
  assert.notEqual(don.duration, ka.duration);
  assert.notDeepEqual(don.getChannelData(0).slice(0,100),ka.getChannelData(0).slice(0,100));
});
test('default mix prioritizes hits and ducks music only around a hit', () => {
  assert.equal(MIX_DEFAULTS.music, 60);
  assert.equal(MIX_DEFAULTS.hits, 150);
  const events = [];
  duckMusic({ cancelScheduledValues: (...args) => events.push(['cancel',...args]), setTargetAtTime: (...args) => events.push(['target',...args]) }, 2);
  assert.deepEqual(events, [['cancel',2],['target',0.7,2,0.003],['target',1,2.05,0.025]]);
});