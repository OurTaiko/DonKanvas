import test from 'node:test';
import assert from 'node:assert/strict';
import { TJAParser } from 'tja';
import { parseChart, insertEmptyBar, barSource, branchSource, setBranchSource, replaceBarSource, replaceBar, setPositionSettings, clearPositionSettings } from './chart.js';
import { balloonCounts, balloonIndex, balloonInfo, balloonTotals, setBalloonCount, replaceBarWithBalloons, replaceBarSourceWithBalloons, setBranchSourceWithBalloons, setMeasureBranchWithBalloons, deleteBarWithBalloons } from './balloon.js';
import { measureBranch, setMeasureBranch } from './branch-commands.js';

const chart = (body, header = '') => `TITLE:Branch test\nBPM:120\nOFFSET:0\nCOURSE:Oni\n${header}#START\n${body}\n#END\n`;
const branch = '#BRANCHSTART p,50,80\n#N\n1000,\n#E\n2000,\n#M\n3000,\n#BRANCHEND';
const parse = (text, routes = []) => parseChart(text, TJAParser, 0, routes);

test('measure-level branch starts wrap existing measures in N and preserve later branches and route choices', () => {
  for (const condition of ['p', 'r', 's']) {
    const text = chart(`4000,1000,2000,\n${branch}\n3000,`).replaceAll('\n', '\r\n');
    const parsed = parse(text, ['M']);
    const result = setMeasureBranch(text, parsed, parsed.bars[1], { type: 'condition', condition, lower: -1, upper: 100.5 }, TJAParser);
    const next = parse(result.text, result.branchRoutes);
    assert.deepEqual(result.branchRoutes, ['N', 'M']);
    assert.deepEqual(next.bars.map(bar => bar.notes), parsed.bars.map(bar => bar.notes));
    assert.equal(next.branches[0].value, `${condition},-1,100.5`);
    assert.deepEqual(next.branches[0].routes, ['N']); assert.equal(next.branches[0].barCount, 2);
    assert.equal(measureBranch(next, next.bars[0]), null);
    assert.equal(measureBranch(next, next.bars[1]).index, 0);
    assert.ok(!/(?<!\r)\n/.test(result.text));
    assert.equal(result.text.slice(next.branches[1].start, next.branches[1].end), branch.replaceAll('\n', '\r\n'));
  }
});

test('route toggles create one empty measure without copying or aligning routes, and the last toggle unwraps the branch', () => {
  let text = chart('#BRANCHSTART p,50,80\n#N\n1000,\n2000,');
  let parsed = parse(text);
  for (const route of ['E', 'M']) {
    const result = setMeasureBranch(text, parsed, parsed.bars[0], { type: 'route', route }, TJAParser);
    text = result.text; parsed = parse(text, result.branchRoutes);
    const candidate = parse(text, [route]);
    assert.equal(candidate.bars.length, 1); assert.equal(candidate.bars[0].notes, '0');
    assert.equal(parsed.bars.length, 2); assert.equal(parsed.bars[1].notes, '2000');
  }
  parsed = parse(text, ['E']);
  const removed = setMeasureBranch(text, parsed, parsed.bars[0], { type: 'route', route: 'E' }, TJAParser);
  assert.deepEqual(removed.branchRoutes, ['N']);
  parsed = parse(removed.text);
  const onlyN = setMeasureBranch(removed.text, parsed, parsed.bars[0], { type: 'route', route: 'M' }, TJAParser);
  parsed = parse(onlyN.text);
  const disabled = setMeasureBranch(onlyN.text, parsed, parsed.bars[0], { type: 'route', route: 'N' }, TJAParser);
  const next = parse(disabled.text, disabled.branchRoutes);
  assert.equal(next.branches.length, 0); assert.deepEqual(next.bars.map(bar => bar.notes), ['1000', '2000']);
  assert.doesNotMatch(disabled.text, /#(?:BRANCHSTART|BRANCHEND|N|E|M)\b/);
});

test('disabling branches retains only the selected route as shared, preserving balloons, later branches and CRLF', () => {
  const body = '#BRANCHSTART p,50,80\n#N\n7080,\n7080,\n#E\n#BPMCHANGE 240\n9080,\n#M\n7080,\n7080,\n7080,\n#BRANCHEND\n9080,';
  for (const header of ['BALLOON:11,12,21,31,32,33,41,999\n', 'BALLOON:41,999\nBALLOONNOR:11,12\nBALLOONEXP:21\nBALLOONMAS:31,32,33\n']) {
    for (const route of ['N', 'E', 'M']) {
      for (const explicit of [true, false]) {
        const text = chart(`${explicit ? body : body.replace('#BRANCHEND\n9080,', '')}\n${branch}`, header).replaceAll('\n', '\r\n');
        const parsed = parse(text, [route, 'M']), count = parsed.branches[0].barCount;
        const result = setMeasureBranchWithBalloons(text, parsed, parsed.bars[0], { type: 'disable' }, TJAParser);
        const next = parse(result.text, result.branchRoutes);
        assert.deepEqual(result.branchRoutes, ['M']); assert.equal(next.branches.length, 1);
        assert.deepEqual(next.bars.map(bar => bar.notes), parsed.bars.map(bar => bar.notes));
        for (let bar = 0; bar < count; bar++) {
          assert.equal(next.bars[bar].branchIndex, null);
          assert.equal(balloonInfo(result.text, next, { bar, numerator: 0, denominator: 1 }).count, balloonInfo(text, parsed, { bar, numerator: 0, denominator: 1 }).count);
          assert.equal(next.bars[bar].start, parsed.bars[bar].start);
        }
        assert.ok(!/(?<!\r)\n/.test(result.text));
        assert.equal(result.text.slice(next.branches[0].start, next.branches[0].end), branch.replaceAll('\n', '\r\n'));
      }
    }
  }
});

test('ending a branch moves the selected measure and route suffix into shared content without truncating other routes', () => {
  for (const ending of ['#BRANCHEND\n1000,', '']) {
    const text = chart('#BRANCHSTART p,50,80\n#N\n1000,2000,3000,\n#E\n#BPMCHANGE 240\n4000,\n' + ending);
    const parsed = parse(text);
    const result = setMeasureBranch(text, parsed, parsed.bars[1], { type: 'end' }, TJAParser);
    const normal = parse(result.text), expert = parse(result.text, ['E']);
    assert.equal(normal.branches[0].barCount, 1); assert.equal(expert.branches[0].barCount, 1);
    assert.deepEqual(normal.bars.slice(0, 3).map(bar => bar.notes), ['1000', '2000', '3000']);
    assert.deepEqual(expert.bars.slice(0, 3).map(bar => bar.notes), ['4000', '2000', '3000']);
    assert.equal(normal.bars[1].branchIndex, null); assert.equal(expert.bars[1].branchIndex, null);
    assert.equal(normal.bars[1].start, 2); assert.equal(expert.bars[1].start, 1);
    assert.equal(expert.bars[1].bpm, 240);
    assert.equal((result.text.match(/#BRANCHEND/g) ?? []).length, 1);
  }
});

test('measure branch edits preserve balloon identities when shared measures become routes and route measures become shared', () => {
  const text = chart('7080,\n7080,\n7080,', 'BALLOON:11,22,33,999\nBALLOONNOR:44,888\n');
  const parsed = parse(text);
  const started = setMeasureBranchWithBalloons(text, parsed, parsed.bars[0], { type: 'condition', condition: 'p', lower: 50, upper: 80 }, TJAParser);
  let next = parse(started.text, started.branchRoutes);
  for (let bar = 0; bar < 3; bar++) assert.equal(balloonInfo(started.text, next, { bar, numerator: 0, denominator: 1 }).count, [11, 22, 33][bar]);
  assert.deepEqual(balloonCounts(started.text, 0), [999]);
  const ended = setMeasureBranchWithBalloons(started.text, next, next.bars[1], { type: 'end' }, TJAParser);
  next = parse(ended.text, ended.branchRoutes);
  for (let bar = 0; bar < 3; bar++) assert.equal(balloonInfo(ended.text, next, { bar, numerator: 0, denominator: 1 }).count, [11, 22, 33][bar]);
  assert.deepEqual(balloonCounts(ended.text, 0), [22, 33, 999]);
  assert.deepEqual(balloonCounts(ended.text, 0, 'BALLOONNOR'), [11, 44, 888]);
});

test('branch commands reject ending without a prior branch or at its first measure, and invalid conditions', () => {
  const text = chart('1000,\n2000,'), parsed = parse(text);
  assert.throws(() => setMeasureBranch(text, parsed, parsed.bars[1], { type: 'end' }, TJAParser), /前面的小节/);
  for (const operation of [
    { type: 'condition', condition: 'x', lower: 1, upper: 2 },
    { type: 'condition', condition: 'p', lower: NaN, upper: 2 }
  ]) assert.throws(() => setMeasureBranch(text, parsed, parsed.bars[0], operation, TJAParser), /分歧条件/);
  const started = setMeasureBranch(text, parsed, parsed.bars[0], { type: 'condition', condition: 'p', lower: 50, upper: 80 }, TJAParser);
  const next = parse(started.text);
  assert.throws(() => setMeasureBranch(started.text, next, next.bars[0], { type: 'end' }, TJAParser), /之后的小节/);
});

test('removing any route preserves the remaining route and shared balloon counts in flat and separate pools', () => {
  const body = '#BRANCHSTART p,50,80\n#N\n7080,\n7080,\n#E\n9080,\n#M\n7080,\n7080,\n7080,\n#BRANCHEND\n9080,';
  for (const header of ['BALLOON:11,12,21,31,32,33,41,999\n', 'BALLOON:41,999\nBALLOONNOR:11,12\nBALLOONEXP:21\nBALLOONMAS:31,32,33\n']) {
    for (const removed of ['N', 'E', 'M']) {
      const text = chart(body, header), parsed = parse(text);
      const result = setMeasureBranchWithBalloons(text, parsed, parsed.bars[0], { type: 'route', route: removed }, TJAParser);
      for (const route of ['N', 'E', 'M'].filter(route => route !== removed)) {
        const next = parse(result.text, [route]), expected = { N: [11, 12], E: [21], M: [31, 32, 33] }[route];
        for (let bar = 0; bar < expected.length; bar++) assert.equal(balloonInfo(result.text, next, { bar, numerator: 0, denominator: 1 }).count, expected[bar]);
        assert.equal(balloonInfo(result.text, next, { bar: expected.length, numerator: 0, denominator: 1 }).count, 41);
      }
      assert.equal(balloonCounts(result.text, 0).at(-1), 999);
    }
  }
});

test('measure deletion preserves route markers and shared commands, shortens only the selected route and reconciles balloon pools', () => {
  const body = '7080,\n#BPMCHANGE 180\n#BRANCHSTART p,50,80\n#N\n7080,\n#E\n9080,\n#M\n7080,\n#BRANCHEND\n9080,';
  for (const header of ['BALLOON:11,22,33,44,55,999\n', 'BALLOON:11,55,999\nBALLOONNOR:22\nBALLOONEXP:33\nBALLOONMAS:44\n']) {
    for (const route of ['N', 'E', 'M']) {
      const source = chart(body, header), parsed = parse(source, [route]);
      const text = deleteBarWithBalloons(source, parsed, parsed.bars[1]);
      assert.ok(text.includes('#BPMCHANGE 180\n#BRANCHSTART p,50,80'));
      for (const marker of ['#N', '#E', '#M', '#BRANCHEND']) assert.ok(text.includes(marker));
      for (const candidate of ['N', 'E', 'M']) {
        const next = parse(text, [candidate]);
        assert.equal(next.bars.length, candidate === route ? 2 : 3);
        assert.equal(next.bars.at(-1).bpm, 180);
        assert.equal(balloonInfo(text, next, { bar: next.bars.length - 1, numerator: 0, denominator: 1 }).count, 55);
        if (candidate !== route) {
          assert.equal(next.bars.at(-1).start, parse(source, [candidate]).bars.at(-1).start);
          assert.equal(balloonInfo(text, next, { bar: 1, numerator: 0, denominator: 1 }).count, { N: 22, E: 33, M: 44 }[candidate]);
        } else assert.equal(next.bars.at(-1).start, parsed.bars[0].end);
      }
      if (header.includes('BALLOONNOR')) {
        assert.deepEqual(balloonCounts(text, 0), [11, 55, 999]);
        assert.deepEqual(balloonCounts(text, 0, { N: 'BALLOONNOR', E: 'BALLOONEXP', M: 'BALLOONMAS' }[route]), []);
      } else assert.deepEqual(balloonCounts(text, 0), [11, 22, 33, 44, 55, 999].filter((_, index) => index !== { N: 1, E: 2, M: 3 }[route]));
    }
  }
});

test('deleting a shared measure retains branch-end markers and the following balloon count', () => {
  const source = chart(`${branch}\n7080,\n9080,`, 'BALLOON:5,9\n');
  const parsed = parse(source), text = deleteBarWithBalloons(source, parsed, parsed.bars[1]);
  for (const route of ['N', 'E', 'M']) {
    const next = parse(text, [route]);
    assert.equal(next.bars.length, 2);
    assert.equal(balloonInfo(text, next, { bar: 1, numerator: 0, denominator: 1 }).count, 9);
    assert.ok(text.includes('#BRANCHEND'));
  }
});

test('blank measures at route boundaries affect only that route without aligning other route endings or changing balloon counts', () => {
  const source = chart(`4000,\n${branch.replaceAll(/[123]000,/g, '7080,')}\n9080,`, 'BALLOON:11,22,33,44\n');
  for (const route of ['N', 'E', 'M']) {
    for (const side of ['before', 'after']) {
      const parsed = parse(source, [route]), text = insertEmptyBar(source, parsed.bars[1], side);
      for (const candidate of ['N', 'E', 'M']) {
        const next = parse(text, [candidate]);
        assert.equal(next.bars.length, candidate === route ? 4 : 3);
        assert.equal(next.bars.at(-1).start, candidate === route ? 6 : 4);
        assert.equal(next.bars.at(-1).end, candidate === route ? 8 : 6);
        assert.equal(balloonInfo(text, next, { bar: candidate === route ? 3 : 2, numerator: 0, denominator: 1 }).count, 44);
      }
      assert.deepEqual(balloonCounts(text, 0), [11, 22, 33, 44]);
    }
  }
  for (const side of ['before', 'after']) {
    const parsed = parse(source), shared = parsed.bars[side === 'before' ? 0 : 2];
    const text = insertEmptyBar(source, shared, side);
    for (const route of ['N', 'E', 'M']) assert.equal(parse(text, [route]).bars.length, 4);
  }
});

test('balloon hit totals use source-order or route-specific pools but sum only active notes', () => {
  const body = '7080,\n#BRANCHSTART p,50,80\n#N\n7080,\n#E\n9080,\n#M\n7080,\n#BRANCHEND\n9080,';
  for (const header of ['BALLOON:11,22,33,44,55,999\n', 'BALLOON:11,55,999\nBALLOONNOR:22\nBALLOONEXP:33\nBALLOONMAS:44\n']) {
    const text = chart(body, header);
    for (const [route, expected] of [['N', { balloon: 33, special: 55 }], ['E', { balloon: 11, special: 88 }], ['M', { balloon: 55, special: 55 }]]) {
      assert.deepEqual(balloonTotals(text, parse(text, [route])), expected, `${header}: ${route}`);
    }
  }
});

test('missing or invalid used balloon hit counts never become a misleading zero or partial total', () => {
  for (const [counts, expected] of [
    ['', { balloon: null, special: null }],
    ['5,11', { balloon: null, special: 11 }],
    ['5,11,0', { balloon: null, special: 11 }],
    ['5,-1,7', { balloon: 12, special: null }],
    ['5,2.5,7', { balloon: 12, special: null }]
  ]) {
    const text = chart('7080,\n9080,\n7080,', `BALLOON:${counts}\n`);
    assert.deepEqual(balloonTotals(text, parse(text)), expected, counts);
  }
  assert.deepEqual(balloonTotals('', null), { balloon: 0, special: 0 });
  assert.throws(() => parse(chart('7080,', 'BALLOON:nope\n')), /Invalid course balloon value/);
});

test('branch insertion adds independent measures and shifts route choices without overwriting common source', () => {
  const text = chart(`${branch}\n4000,\n${branch}`).replaceAll('\n', '\r\n'), parsed = parse(text, ['E', 'M']);
  const result = setBranchSource(text, parsed, { bar: 1, numerator: 0, denominator: 1 }, branch, null, TJAParser);
  const next = parse(result.text, result.branchRoutes);
  assert.deepEqual(result.branchRoutes, ['E', 'N', 'M']);
  assert.deepEqual(next.bars.map(bar => bar.notes), ['2000', '1000', '4000', '3000']);
  assert.ok(!/(?<!\r)\n/.test(result.text));
  assert.equal(next.branches[1].value, 'p,50,80');
  const appended = setBranchSource(chart('4000,'), parse(chart('4000,')), { bar: 0, numerator: 1, denominator: 1 }, branch, null, TJAParser);
  assert.deepEqual(parse(appended.text).bars.map(bar => bar.notes), ['4000', '1000']);
});

test('branch source edits retain other branches, allow different lengths and normalize implicit endings', () => {
  const text = chart(`${branch.replace('\n#BRANCHEND', '')}\n${branch}`), parsed = parse(text, ['E', 'M']);
  assert.ok(branchSource(text, parsed.branches[0]).endsWith('#BRANCHEND'));
  const source = branchSource(text, parsed.branches[0]).replace('p,50,80', 'r,-1,100.5').replace('#E\n2000,', '#E\n2000,\n2000,');
  const result = setBranchSource(text, parsed, null, source, 0, TJAParser), next = parse(result.text, result.branchRoutes);
  assert.deepEqual(result.branchRoutes, ['E', 'M']);
  assert.deepEqual(next.bars.map(bar => bar.notes), ['2000', '2000', '3000']);
  assert.equal(next.branches[0].value, 'r,-1,100.5');
  assert.equal(result.text.slice(next.branches[1].start, next.branches[1].end), branch);
  const removed = setBranchSource(result.text, next, null, source.replace('#E\n2000,\n2000,\n', ''), 0, TJAParser);
  assert.deepEqual(removed.branchRoutes, ['N', 'M']);
});

test('saving unchanged branch structures is idempotent and preserves indentation and inline comments', () => {
  const text = chart(`${branch.replaceAll('#', '  #')} // tail\n4000,`);
  const parsed = parse(text);
  const result = setBranchSource(text, parsed, null, branchSource(text, parsed.branches[0]), 0, TJAParser);
  assert.equal(result.text, text);
});

test('structure mutations reject partial, nested, duplicate and cross-course structures atomically', () => {
  const text = chart(`4000,\n${branch}`), parsed = parse(text);
  for (const source of [branch.replace('#BRANCHEND', ''), `${branch}\n${branch}`, `#START\n${branch}\n#END`, `${branch}\n4000,`, branch.replace('#E', '#N'), branch.replace('p,50,80', 'p,NaN,80')]) {
    assert.throws(() => setBranchSource(text, parsed, null, source, 0, TJAParser));
  }
  for (const cell of [{ bar: 0, numerator: 1, denominator: 2 }, { bar: 1, numerator: 0, denominator: 1 }]) assert.throws(() => setBranchSource(text, parsed, cell, branch, null, TJAParser), /共用小节/);
});

test('branch balloon reconciliation preserves subsequent counts and independent route pools', () => {
  const balloons = branch.replaceAll(/[123]000,/g, '7800,');
  for (const header of ['BALLOON:11,12,13,14,15,99\n', 'BALLOON:11,15,99\nBALLOONNOR:12\nBALLOONEXP:13\nBALLOONMAS:14\n']) {
    const text = chart(`7800,\n${balloons}\n7800,`, header), parsed = parse(text);
    const result = setBranchSourceWithBalloons(text, parsed, { bar: 0, numerator: 1, denominator: 1 }, balloons, null, TJAParser);
    if (header.includes('BALLOONNOR')) {
      assert.deepEqual(balloonCounts(result.text, 0), [11, 15, 99]);
      for (const [field, count] of [['BALLOONNOR', 12], ['BALLOONEXP', 13], ['BALLOONMAS', 14]]) assert.deepEqual(balloonCounts(result.text, 0, field), [5, count]);
    } else assert.deepEqual(balloonCounts(result.text, 0), [11, 5, 5, 5, 12, 13, 14, 15, 99]);
    const edited = setBranchSourceWithBalloons(text, parsed, null, balloons.replace('#E\n7800,\n', ''), 0, TJAParser);
    if (!header.includes('BALLOONNOR')) assert.deepEqual(balloonCounts(edited.text, 0), [11, 12, 14, 15, 99]);
    else {
      assert.deepEqual(balloonCounts(edited.text, 0, 'BALLOONEXP'), []);
      assert.deepEqual(balloonCounts(edited.text, 0, 'BALLOONMAS'), [14]);
    }
  }
});

test('branch routes share a start time instead of being concatenated and common measures rejoin', () => {
  const text = chart(`4000,\n${branch}\n1000,`);
  for (const [route, note] of [['N', '1000'], ['E', '2000'], ['M', '3000']]) {
    const parsed = parse(text, [route]);
    assert.deepEqual(parsed.bars.map(bar => bar.notes), ['4000', note, '1000']);
    assert.deepEqual(parsed.bars.map(bar => bar.start + 0), [0, 2, 4]);
    assert.deepEqual(parsed.bars.map(bar => bar.index), [0, 1, 2]);
    assert.equal(parsed.allBars.length, 5);
    assert.equal(parsed.bars[1].route, route);
    assert.equal(parsed.bars[1].branchStart, true);
    assert.deepEqual(parsed.branchRoutes, [route]);
    assert.deepEqual(parsed.branches[0].routes, ['N', 'E', 'M']);
    assert.equal(parsed.branches[0].value, 'p,50,80');
  }
  assert.deepEqual(parse(text).branchRoutes, ['N']);
});

test('each path resets timing and visual state and only its final state reaches common measures', () => {
  const text = chart(`#GOGOSTART\n#SECTION\n#BRANCHSTART r,5,10\n#N\n#SCROLL 2\n#LYRIC Normal only\n1000,\n#E\n#BPMCHANGE 240\n#MEASURE 2/1\n2000,\n#M\n#BARLINEOFF\n3000,\n#BRANCHEND\n4000,`);
  const normal = parse(text, ['N']), expert = parse(text, ['E']), master = parse(text, ['M']);
  assert.equal(normal.bars[1].scroll, 2);
  assert.equal(expert.bars[0].scroll, 1);
  assert.equal(expert.bars[1].bpm, 240);
  assert.equal(master.bars[0].bpm, 120);
  assert.equal(master.bars[1].barline, false);
  for (const parsed of [normal, expert, master]) {
    assert.deepEqual(parsed.bars.map(bar => bar.start + 0), [0, 2]);
    assert.equal(parsed.bars[0].gogo, true);
    assert.ok(parsed.bars[0].instructions.some(item => item.name === 'SECTION' && item.shared));
  }
  assert.deepEqual(normal.unsimulatedCommands, ['SECTION', 'LYRIC']);
  assert.deepEqual(expert.unsimulatedCommands, ['SECTION']);
});

test('shared commands before branch fences retain delays but cannot leak into route source or reset', () => {
  const text = chart(`#BPMCHANGE 60\n#DELAY .25\n${branch}\n4000,`);
  const parsed = parse(text, ['E']), bar = parsed.bars[0];
  assert.equal(bar.start, .25);
  assert.equal(bar.end, 4.25);
  assert.equal(parsed.bars[1].start, 4.25);
  assert.equal(barSource(text, bar), '2000,');
  assert.equal(clearPositionSettings(text, bar, { numerator: 0, denominator: 1 }), text);
  const edited = replaceBarSource(text, parsed, bar, '1200,', TJAParser);
  assert.ok(edited.includes('#BPMCHANGE 60\n#DELAY .25\n#BRANCHSTART p,50,80'));
  assert.equal(parse(edited, ['N']).bars[0].notes, '1000');
  assert.equal(parse(edited, ['E']).bars[0].notes, '1200');
});

test('route editing and off-grid commands preserve all other routes and original source offsets', () => {
  const text = chart(branch).replaceAll('\n', '\r\n'), parsed = parse(text, ['M']);
  const position = { bar: 0, numerator: 1, denominator: 3 };
  const edited = setPositionSettings(text, parsed, position, { barline: false }, TJAParser);
  const master = parse(edited, ['M']);
  assert.equal(master.bars[0].notes.length, 12);
  assert.equal(master.bars[0].events[0].fraction, 1 / 3);
  assert.equal(parse(edited, ['N']).bars[0].notes, '1000');
  assert.equal(parse(edited, ['E']).bars[0].notes, '2000');
  assert.ok(edited.includes('#N\r\n1000,\r\n#E\r\n2000,'));
  assert.ok(edited.includes('#BARLINEOFF\r\n'));
  const resized = replaceBar(edited, master.bars[0], '300000000000000000000000');
  assert.equal(parse(resized, ['M']).bars[0].events[0].fraction, 1 / 3);
});

test('consecutive and implicit-final branches have independent route choices and allow different measure counts', () => {
  const first = '#BRANCHSTART s,100,200\n#N\n1000,\n1000,\n#E\n#BPMCHANGE 60\n2000,\n#M\n#BPMCHANGE 240\n3000,\n3000,\n3000,\n3000,';
  const text = chart(`${first}\n${branch.replace('\n#BRANCHEND', '')}`);
  const parsed = parse(text, ['E', 'M']);
  assert.deepEqual(parsed.branchRoutes, ['E', 'M']);
  assert.equal(parsed.bars.length, 2);
  assert.deepEqual(parsed.bars.map(bar => bar.start + 0), [0, 4]);
  assert.deepEqual(parsed.branches.map(item => item.firstBarIndex), [0, 1]);
  assert.equal(parsed.bars[1].bpm, 60);
});

test('unequal route durations rejoin at the selected end time and retain selected timing state', () => {
  const text = chart('4000,\n#BRANCHSTART p,50,80\n#N\n1000,\n#E\n#BPMCHANGE 60\n2000,\n2000,\n#M\n#MEASURE 3/4\n#DELAY .25\n3000,\n#BRANCHEND\n4000,');
  for (const [route, starts, end, duration] of [
    ['N', [0, 2, 4], 6, 2],
    ['E', [0, 2, 6, 10], 14, 4],
    ['M', [0, 2.25, 3.75], 5.25, 1.5]
  ]) {
    const parsed = parse(text, [route]);
    assert.deepEqual(parsed.bars.map(bar => bar.start + 0), starts);
    assert.equal(parsed.bars.at(-1).end, end);
    assert.equal(parsed.bars.at(-1).duration, duration);
    assert.equal(parsed.bars.at(-1).route, null);
    assert.equal(parsed.bars[1].route, route);
  }
});

test('implicit branch transitions use actual selected duration without padding or truncating routes', () => {
  const first = '#BRANCHSTART p,-1,0.0001\n#N\n1000,\n#E\n2000,\n2000,\n#M\n3000,\n3000,\n3000,';
  const text = chart(`${first}\n${branch.replace('\n#BRANCHEND', '')}`);
  for (const [route, count, end] of [['N', 1, 2], ['E', 2, 4], ['M', 3, 6]]) {
    const parsed = parse(text, [route, 'M']);
    assert.equal(parsed.branches[1].firstBarIndex, count);
    assert.equal(parsed.bars[count].start, end);
    assert.equal(parsed.bars[count].end, end + 2);
    assert.equal(parsed.bars.length, count + 1);
    assert.equal(parsed.bars.filter(bar => bar.branchIndex === 0).length, count);
  }
});

test('omitted unreachable paths, reordered routes and empty branch blocks are supported', () => {
  const text = chart('#BRANCHSTART p,0,0\n#M\n3000,\n#E\n2000,\n#BRANCHEND\n1000,');
  assert.deepEqual(parse(text).branchRoutes, ['E']);
  assert.deepEqual(parse(text, ['M']).bars.map(bar => bar.notes), ['3000', '1000']);
  assert.throws(() => parse(text, ['N']), /没有路线/);
  const empty = parse(chart('#BRANCHSTART p,50,80\n#BRANCHEND\n1000,'));
  assert.equal(empty.bars.length, 1);
  assert.deepEqual(empty.branchRoutes, [null]);
  assert.deepEqual(empty.branches[0].routes, []);
});

test('mixed single and double-player courses retain their independent contents and branch paths', () => {
  const text = chart(branch) + 'COURSE:Normal\nSTYLE:Double\n#START P1\n1000,\n#END\n#START P2\n2000,\n#END\nSTYLE:Single\n#START\n3000,\n#END\n';
  assert.equal(parse(text, ['M']).bars[0].notes, '3000');
  for (const [index, player] of [[1, 'P1'], [2, 'P2']]) assert.equal(parseChart(text, TJAParser, index).variant.player, player);
  assert.equal(parseChart(text, TJAParser, 3).bars[0].notes, '3000');
  for (const style of ['Double', '2', 'Couple']) assert.equal(parse(chart('1000,').replace('#START', `STYLE:${style}\n#START`)).variant.player, 'shared');
});

test('malformed structure and invalid unselected routes reject instead of flattening or losing data', () => {
  for (const body of [
    '#N\n1000,', '#BRANCHEND\n1000,',
    '#BRANCHSTART p,50\n#N\n1000,',
    '#BRANCHSTART p,,80\n#N\n1000,',
    '#BRANCHSTART p,50,Infinity\n#N\n1000,',
    '#BRANCHSTART p,50,80\n1000,',
    '#BRANCHSTART p,50,80\n#N\n10\n#E\n2000,',
    '#BRANCHSTART p,50,80\n#N\n1000,\n#N\n2000,',
    '#BRANCHSTART p,50,80\n#N\n1000,\n#E\n#BPMCHANGE nope\n2000,'
  ]) assert.throws(() => parse(chart(body)), body);
  assert.throws(() => parse(chart(branch), ['bad']), /选择无效/);
  assert.throws(() => parse(chart(branch), ['N', 'M']), /选择无效/);
  const text = chart(branch), parsed = parse(text);
  assert.throws(() => replaceBarSource(text, parsed, parsed.bars[0], '#BRANCHEND\n1000,', TJAParser), /分歧结构/);
});

test('legacy balloons count unselected paths in source order without damaging their hit counts', () => {
  const text = chart(`7080,\n${branch.replaceAll(/[123]000,/g, '7080,')}\n7080,`, 'BALLOON:11,22,33,44,55 // keep\n');
  const expert = parse(text, ['E']), cell = { bar: 1, numerator: 0, denominator: 4 };
  assert.equal(balloonIndex(expert, cell), 2);
  assert.equal(balloonInfo(text, expert, cell).count, 33);
  const counted = setBalloonCount(text, expert, cell, 77);
  assert.deepEqual(balloonCounts(counted, 0), [11, 22, 77, 44, 55]);
  const edited = replaceBarWithBalloons(text, expert, expert.bars[1], '7708');
  assert.deepEqual(balloonCounts(edited, 0), [11, 22, 33, 5, 44, 55]);
  assert.equal(balloonInfo(edited, parse(edited, ['M']), cell).count, 44);
  assert.equal(balloonInfo(edited, parse(edited, ['E']), { ...cell, bar: 2 }).count, 55);
  assert.ok(edited.includes('// keep'));
});

test('route-specific balloon headers use isolated pools and common sections keep BALLOON', () => {
  const text = chart(`7080,\n${branch.replaceAll(/[123]000,/g, '7080,')}\n7080,`, 'BALLOON:11,55\nBALLOONNOR:22\nBALLOONEXP:33 // expert\nBALLOONMAS:44\n');
  const expert = parse(text, ['E']), cell = { bar: 1, numerator: 0, denominator: 4 };
  assert.deepEqual(balloonInfo(text, expert, cell), { ordinal: 0, field: 'BALLOONEXP', count: 33 });
  assert.equal(balloonInfo(text, expert, { ...cell, bar: 2 }).count, 55);
  const edited = replaceBarSourceWithBalloons(text, expert, expert.bars[1], '7708,', TJAParser);
  assert.deepEqual(balloonCounts(edited, 0, 'BALLOONEXP'), [33, 5]);
  assert.deepEqual(balloonCounts(edited, 0, 'BALLOONNOR'), [22]);
  assert.deepEqual(balloonCounts(edited, 0, 'BALLOONMAS'), [44]);
  assert.deepEqual(balloonCounts(edited, 0), [11, 55]);
  assert.ok(edited.includes('// expert'));
});
