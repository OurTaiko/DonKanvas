import test from 'node:test';
import assert from 'node:assert/strict';
import { TJAParser } from 'tja';
import { parseChart } from './chart.js';
import { balloonCounts, balloonIndex, setBalloonCount, replaceBarWithBalloons, replaceBarSourceWithBalloons, copyMeasures, pasteMeasures } from './balloon.js';

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

test('measure clipboard inserts or overwrites complete measures, preserves counts and appends overflow', () => {
  const text = source.replace('7080,', '#MEASURE 3/4\n70\n#SCROLL 0\n80,').replaceAll('\n', '\r\n');
  const chart = parseChart(text, TJAParser), copied = copyMeasures(text, chart, 0, 1);
  const inserted = pasteMeasures(text, chart, 1, copied, 'insert', TJAParser);
  const next = parseChart(inserted, TJAParser);
  assert.deepEqual(next.bars.map(bar => bar.notes), ['7080', '7080', '9080', '9080']);
  assert.deepEqual(balloonCounts(inserted, 0), [12, 12, 24, 24]);
  assert.deepEqual(balloonCounts(inserted, 1), [30]);
  assert.equal(next.bars[1].events[0].slot, 2);
  assert.equal(next.bars[1].events[0].value, '0');
  assert.equal(next.bars[1].numerator, 3);
  assert.equal(inserted.replaceAll('\r\n', '').includes('\n'), false);
  assert.ok(inserted.endsWith(source.slice(source.indexOf('COURSE:Easy')).replaceAll('\n', '\r\n')));
  const overwritten = pasteMeasures(text, chart, 1, copied, 'overwrite', TJAParser);
  assert.deepEqual(parseChart(overwritten, TJAParser).bars.map(bar => bar.notes), ['7080', '7080', '9080']);
  assert.deepEqual(balloonCounts(overwritten, 0), [12, 12, 24]);
});

test('clipboard projects the displayed route and preserves other routes and their balloon pools', () => {
  const text = 'TITLE:Branch\nBPM:120\nCOURSE:Oni\nBALLOONNOR:11,12\nBALLOONEXP:21\nBALLOONMAS:31\n#START\n1000,\n#BPMCHANGE 90\n#BRANCHSTART p,50,80\n#N\n7080,\n9080,\n#E\n#MEASURE 3/4\n7080,\n#M\n7080,\n#BRANCHEND\n2000,\n#END\n';
  const chart = parseChart(text, TJAParser);
  const copied = copyMeasures(text, chart, 1, 2);
  assert.doesNotMatch(copied[0].source, /#BRANCH|^#N$/m);
  assert.match(copied[0].source, /#BPMCHANGE 90/);
  const inserted = pasteMeasures(text, chart, 2, copied, 'insert', TJAParser);
  const next = parseChart(inserted, TJAParser);
  assert.deepEqual(next.bars.map(bar => bar.notes), ['1000', '7080', '7080', '9080', '9080', '2000']);
  assert.deepEqual(balloonCounts(inserted, 0, 'BALLOONNOR'), [11, 11, 12, 12]);
  assert.deepEqual(balloonCounts(inserted, 0, 'BALLOONEXP'), [21]);
  assert.deepEqual(balloonCounts(inserted, 0, 'BALLOONMAS'), [31]);
  assert.deepEqual(parseChart(inserted, TJAParser, 0, ['E']).bars.map(bar => bar.notes), ['1000', '7080', '2000']);
  assert.deepEqual(next.branches.map(branch => [branch.routes, branch.route]), chart.branches.map(branch => [branch.routes, branch.route]));
  assert.ok(inserted.includes('#E\n#MEASURE 3/4\n7080,\n#M\n7080,\n#BRANCHEND\n2000,'));
  assert.throws(() => pasteMeasures(text, chart, 0, copied, 'overwrite', TJAParser), /分歧边界，无法粘贴/);
  assert.throws(() => pasteMeasures(text, chart, 2, copied, 'overwrite', TJAParser), /分歧边界，无法粘贴/);
  const overwritten = pasteMeasures(text, chart, 1, copied, 'overwrite', TJAParser);
  assert.deepEqual(balloonCounts(overwritten, 0, 'BALLOONNOR'), [11, 12]);
});

test('clipboard keeps missing balloon counts invalid, retains unused counts and works across courses', () => {
  const text = source.replace('BALLOON:12,24 // keep', 'BALLOON:12,24,99 // keep');
  const copied = copyMeasures(text, parseChart(text, TJAParser), 0, 1);
  const chart = parseChart(text, TJAParser, 1);
  const inserted = pasteMeasures(text, chart, 0, copied, 'insert', TJAParser);
  assert.deepEqual(balloonCounts(inserted, 1), [12, 24, 30]);
  assert.deepEqual(balloonCounts(inserted, 0), [12, 24, 99]);
  const missing = source.replace('BALLOON:12,24 // keep\n', '');
  const invalidCopy = copyMeasures(missing, parseChart(missing, TJAParser), 0, 0);
  const invalidPaste = pasteMeasures(source, parseChart(source, TJAParser), 0, invalidCopy, 'insert', TJAParser);
  assert.deepEqual(balloonCounts(invalidPaste, 0), [0, 12, 24]);
  assert.throws(() => pasteMeasures(source, parseChart(source, TJAParser), 0, [], 'insert', TJAParser), /先复制/);
});