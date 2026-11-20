import test from 'node:test';
import assert from 'node:assert/strict';
import { TJAParser } from 'tja';
import { parseChart } from './chart.js';
import { balloonCounts, balloonIndex, setBalloonCount, replaceBarWithBalloons, replaceBarSourceWithBalloons } from './balloon.js';

const source = 'TITLE:Test\nBPM:120\nCOURSE:Oni\nBALLOON:12,24 // keep\n#START\n7080,\n9080,\n#END\nCOURSE:Easy\nBALLOON:30\n#START\n7080,\n#END\n';
test('balloons map to counts in chart order and stay scoped to the current course', () => {
  const chart = parseChart(source, TJAParser);
  assert.equal(balloonIndex(chart, { bar: 1, numerator: 0, denominator: 4 }), 1);
  const edited = setBalloonCount(source, chart, { bar: 1, numerator: 0, denominator: 4 }, 42);
  assert.deepEqual(balloonCounts(edited, 0), [12, 42]);
  assert.deepEqual(balloonCounts(edited, 1), [30]);
  assert.ok(edited.includes('// keep'));
  assert.equal(parseChart(edited, TJAParser).bars[1].notes, '9080');
});
test('missing BALLOON header is inserted with the original newline format', () => {
  const text = source.split('COURSE:Easy')[0].replace('BALLOON:12,24 // keep\n', '').replaceAll('\n', '\r\n');
  const chart = parseChart(text, TJAParser);
  const edited = setBalloonCount(text, chart, { bar: 1, numerator: 0, denominator: 4 }, 20);
  assert.ok(edited.includes('BALLOON:5,20\r\n#START'));
});
test('adding and removing balloons preserves later balloon counts', () => {
  const chart = parseChart(source, TJAParser);
  const added = replaceBarWithBalloons(source, chart, chart.bars[0], '7708');
  assert.deepEqual(balloonCounts(added, 0), [12, 5, 24]);
  const next = parseChart(added, TJAParser);
  const removed = replaceBarWithBalloons(added, next, next.bars[0], '0708');
  assert.deepEqual(balloonCounts(removed, 0), [5, 24]);
});
test('resampling and switching balloon types retain counts without rewriting the header', () => {
  const chart = parseChart(source, TJAParser);
  assert.equal(replaceBarWithBalloons(source, chart, chart.bars[0], '90008000'), source.replace('7080,', '90008000,'));
});
test('source whitespace and trailing comma do not change balloon counts', () => {
  const text = source.replace('7080,', '0708,');
  const chart = parseChart(text, TJAParser);
  assert.equal(replaceBarWithBalloons(text, chart, chart.bars[0], ' 0 7\n0 8, '), text);
});
test('complete measure source reconciles balloon counts while retaining timing commands', () => {
  const chart = parseChart(source, TJAParser);
  const edited = replaceBarSourceWithBalloons(source, chart, chart.bars[0], '77\n#BPMCHANGE 60\n08,', TJAParser);
  assert.deepEqual(balloonCounts(edited, 0), [12, 5, 24]);
  assert.equal(parseChart(edited, TJAParser).bars[0].events[0].name, 'BPMCHANGE');
  assert.deepEqual(balloonCounts(edited, 1), [30]);
});
test('invalid counts and non-balloon cells are rejected', () => {
  const chart = parseChart(source, TJAParser), cell = { bar: 0, numerator: 0, denominator: 4 };
  for (const count of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => setBalloonCount(source, chart, cell, count), /正整数/);
  assert.throws(() => setBalloonCount(source, chart, { ...cell, numerator: 1 }, 10), /气球音符/);
});