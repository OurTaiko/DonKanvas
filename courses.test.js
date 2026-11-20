import test from 'node:test';
import assert from 'node:assert/strict';
import { TJAParser } from 'tja';
import { COURSE_NAMES, chartVariants, addCourse, deleteCourse, addPlayerCharts, courseLevel, courseLevelLimit, setCourseLevel } from './courses.js';
import { parseChart, replaceBar } from './chart.js';
import { balloonCounts, setBalloonCount } from './balloon.js';

const mixed = 'TITLE:Mixed\nBPM:120\nCOURSE:Normal\nLEVEL:5\nBALLOON:11\nSTYLE:Double\n#START P1\nA0700080,\n#END\n#START P2\nB0700080,\n#END\nSTYLE:Single\n#START\n3000,\n#END\nCOURSE:Oni\nLEVEL:8\nBALLOON:23\n#START\n7008,\n#END\n';

test('tree creation creates only the requested empty mode and inherits only multiplayer ratings', () => {
  let text = 'TITLE:Tree\r\nBPM:120\r\n';
  for (const course of COURSE_NAMES) {
    for (const player of ['P2', 'single', 'P1']) {
      const before = text, style = player === 'single' ? 'Single' : 'Double';
      const result = addCourse(text, { course, level: 1, style, player });
      assert.ok(result.text.startsWith(before)); text = result.text;
      assert.equal(chartVariants(text)[result.course].player, player);
      assert.equal(parseChart(text, TJAParser, result.course).bars[0].notes, '0');
      assert.equal(courseLevel(text, result.course), 1);
      assert.throws(() => addCourse(text, { course, level: 1, style, player }), /已齐全/);
    }
  }
  assert.equal(chartVariants(text).length, 15);
  const result = addCourse(mixed, { course: 'Oni', level: 1, style: 'Double', player: 'P2' });
  const rated = setCourseLevel(result.text, result.course, 9);
  const counterpart = addCourse(rated, { course: 'Oni', level: 1, style: 'Double', player: 'P1' });
  assert.equal(courseLevel(counterpart.text, counterpart.course), 9);
  assert.equal(chartVariants(counterpart.text).at(-1).body.trim(), ',');
  assert.deepEqual(balloonCounts(counterpart.text, counterpart.course), []);
  assert.equal(courseLevel(counterpart.text, 3), 8);
  const imported = 'BPM:120\nCOURSE:Custom\nLEVEL:3\n#START P1\n1000,\n#END\n';
  const extra = addCourse(imported, { course: 'Custom', level: 1, style: 'Double', player: 'P2' });
  assert.ok(extra.text.startsWith(imported));
  assert.equal(courseLevel(extra.text, extra.course), 3);
  assert.equal(chartVariants(extra.text).at(-1).body.trim(), ',');
  assert.throws(() => addCourse(imported, { course: 'Unknown', level: 1 }), /无效/);
});

test('rating creation and edits enforce exact difficulty caps, including numeric COURSE aliases', () => {
  for (const [index, maximum] of [5, 7, 8, 10, 10].entries()) {
    const course = COURSE_NAMES[index], text = `BPM:120\nCOURSE:${index}\nLEVEL:1\n#START\n1000,\n#END\n`;
    assert.equal(courseLevelLimit(course.toLowerCase()), maximum);
    assert.equal(courseLevelLimit(index), maximum);
    for (let level = 1; level <= maximum; level++) {
      assert.equal(courseLevel(setCourseLevel(text, 0, level), 0), level);
      assert.equal(courseLevel(addCourse('BPM:120\n', { course, level }).text, 0), level);
    }
    for (const level of [0, -1, maximum + 1, 11, 1.5, '2', NaN, Infinity, null]) {
      assert.throws(() => setCourseLevel(text, 0, level), /星级/);
      assert.throws(() => addCourse('BPM:120\n', { course, level }), /星级/);
    }
  }
  assert.equal(courseLevelLimit('constructor'), 10);
  assert.throws(() => setCourseLevel(mixed, 99, 1), /不存在/);
});

test('multiplayer ratings update together while solo ratings, notes and balloons remain independent', () => {
  for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2]]) {
    let text = mixed;
    const expected = [5, 5, 5, 8];
    for (const index of order) {
      const value = index + 1;
      text = setCourseLevel(text, index, value);
      if (index < 2) expected[0] = expected[1] = value; else expected[index] = value;
      assert.deepEqual(chartVariants(text).map(variant => courseLevel(text, variant.index)), expected);
    }
    assert.deepEqual(chartVariants(text).map(variant => variant.body), chartVariants(mixed).map(variant => variant.body));
    assert.deepEqual([0, 1, 2, 3].map(index => balloonCounts(text, index)), [[11], [11], [11], [23]]);
  }
});

test('shared LEVEL edits preserve exact no-ops, local comments, CRLF and other difficulties', () => {
  const text = mixed.replace('LEVEL:5', 'level:05  // rating').replace('#START P2', 'LEVEL:6 // P2\n#START P2').replaceAll('\n', '\r\n');
  assert.equal(setCourseLevel(mixed, 0, 5), mixed);
  const synchronized = setCourseLevel(text, 0, 5);
  assert.deepEqual([0, 1, 2, 3].map(index => courseLevel(synchronized, index)), [5, 5, 6, 8]);
  assert.ok(synchronized.includes('level:05  // rating'));
  assert.equal(setCourseLevel(synchronized, 1, 5), synchronized);
  const changed = setCourseLevel(text, 0, 4);
  assert.ok(changed.includes('level:4  // rating'));
  assert.ok(changed.includes('LEVEL:4 // P2\r\n#START P2'));
  assert.ok(changed.includes('LEVEL:6 // P2\r\n#START\r\n3000'));
  assert.ok(!/(?<!\r)\n/.test(changed));
  assert.deepEqual([0, 1, 2, 3].map(index => courseLevel(changed, index)), [4, 4, 6, 8]);
  assert.equal(setCourseLevel(mixed, 3, 10), mixed.replace('LEVEL:8', 'LEVEL:10'));
  const duplicates = mixed.replace('LEVEL:5', 'LEVEL:2 // retained\nLEVEL:5 // effective');
  assert.ok(setCourseLevel(duplicates, 0, 4).includes('LEVEL:2 // retained\nLEVEL:4 // effective'));
});

test('sharing multiplayer ratings preserves unrated and nonstandard solo LEVEL values', () => {
  for (const original of ['', 'LEVEL:12 // imported\n', 'LEVEL:invalid // imported\n', 'LEVEL:1,2\n', 'LEVEL: // unset\n']) {
    const text = `BPM:120\nCOURSE:Easy\n${original}#START P1\n1000,\n#END\n#START P2\n2000,\n#END\nSTYLE:Single\n#START\n3000,\n#END\n`;
    const before = courseLevel(text, 0), changed = setCourseLevel(text, 0, 3);
    assert.equal(courseLevel(changed, 0), 3);
    assert.equal(courseLevel(changed, 1), 3);
    assert.equal(courseLevel(changed, 2), before);
    if (original) assert.ok(changed.includes(`${original}#START\n3000`));
    else assert.ok(changed.includes('LEVEL:0\n#START\n3000'));
  }
  const implicit = 'BPM:120\n#START P1\n1000,\n#END\n#START P2\n2000,\n#END\n';
  assert.equal(courseLevel(setCourseLevel(implicit, 0, 10), 1), 10);
});

test('shared ratings include nonadjacent, aliased and common multiplayer sections without changing solo charts', () => {
  const text = mixed + 'COURSE:1\nLEVEL:2\nSTYLE:Couple\n#START P2\n4000,\n#END\nCOURSE:normal\nLEVEL:3\nSTYLE:2\n#START\n5008,\n#END\n';
  for (const index of [0, 1, 4, 5]) {
    const changed = setCourseLevel(text, index, 7);
    assert.deepEqual(chartVariants(changed).map(variant => courseLevel(changed, variant.index)), [7, 7, 5, 8, 7, 7]);
    assert.deepEqual(chartVariants(changed).map(variant => variant.body), chartVariants(text).map(variant => variant.body));
    assert.equal(setCourseLevel(changed, index, 7), changed);
    assert.throws(() => setCourseLevel(text, index, 8), /星级/);
  }
});

test('creating a missing multiplayer part from solo inherits the existing multiplayer rating, not the solo rating', () => {
  for (const first of ['P1', 'P2']) {
    const second = first === 'P1' ? 'P2' : 'P1';
    const solo = 'BPM:120\nCOURSE:Oni\nLEVEL:3\nBALLOON:5\n#START\n7008,\n#END\n';
    const initial = addPlayerCharts(solo, 0, 'Double', first);
    const text = setCourseLevel(initial.text, 1, 9);
    const result = addPlayerCharts(text, 0, 'Double', second);
    assert.ok(result.text.startsWith(text));
    assert.deepEqual([0, 1, 2].map(index => courseLevel(result.text, index)), [3, 9, 9]);
    assert.equal(chartVariants(result.text)[2].body, chartVariants(solo)[0].body);
    assert.deepEqual(balloonCounts(result.text, 2), [5]);
  }
  const shared = 'BPM:120\nCOURSE:Oni\nSTYLE:Double\n#START\n1000,\n#END\n';
  const split = addPlayerCharts(shared, 0, 'Double', 'P2');
  assert.deepEqual([0, 1].map(index => courseLevel(split.text, index)), [0, 0]);
});

test('COURSE and STYLE inheritance group single and independent P1/P2 charts correctly', () => {
  const variants = chartVariants(mixed);
  assert.deepEqual(variants.map(({ course, style, player }) => [course, style, player]), [['Normal', 'Double', 'P1'], ['Normal', 'Double', 'P2'], ['Normal', 'Single', 'single'], ['Oni', 'Single', 'single']]);
  for (const [index, notes] of ['A0700080', 'B0700080', '3000', '7008'].entries()) {
    const chart = parseChart(mixed, TJAParser, index);
    assert.equal(chart.bars[0].notes, notes);
    assert.equal(chart.variant.index, index);
    const edited = replaceBar(mixed, chart.bars[0], notes.replace(/[AB3]/, '1'));
    for (const other of variants.filter(variant => variant.index !== index)) assert.equal(parseChart(edited, TJAParser, other.index).bars[0].notes, other.body.trim().slice(0, -1));
  }
});

test('new difficulties have validated names and independent empty single or duet blocks', () => {
  const solo = addCourse(mixed, { course: 'Hard', level: 7 });
  assert.deepEqual(chartVariants(solo.text).slice(4).map(variant => variant.player), ['single']);
  for (const style of ['Single', 'Double']) {
    const result = addCourse(mixed.replaceAll('\n', '\r\n'), { course: 'Hard', level: 7, style });
    assert.equal(result.course, 4);
    const variants = chartVariants(result.text);
    assert.deepEqual(variants.slice(4).map(variant => variant.player), style === 'Single' ? ['single'] : ['P1', 'P2']);
    assert.equal(parseChart(result.text, TJAParser, 4).bars[0].notes, '0');
    assert.ok(!/(?<!\r)\n/.test(result.text));
    assert.ok(result.text.startsWith(mixed.replaceAll('\n', '\r\n')));
  }
  for (const settings of [{ course: 'Normal', level: 1, style: 'Single' }, { course: 'Other', level: 1, style: 'Single' }, { course: 'Easy', level: 0, style: 'Single' }, { course: 'Easy', level: 11, style: 'Double' }, { course: 'Easy', level: '3', style: 'Single' }]) assert.throws(() => addCourse(mixed, settings));
});

test('deleting a chart removes only the selected physical part, including nonadjacent player sections', () => {
  const added = addPlayerCharts(mixed, 3, 'Double');
  const result = deleteCourse(added.text, 4);
  assert.deepEqual(chartVariants(result.text).map(variant => variant.player), ['P1', 'P2', 'single', 'single', 'P2']);
  assert.ok(result.text.startsWith(mixed)); assert.equal(result.course, 3);
  const normalRemoved = deleteCourse(mixed, 1);
  assert.deepEqual(chartVariants(normalRemoved.text).map(variant => [variant.course, variant.player]), [['Normal', 'P1'], ['Normal', 'single'], ['Oni', 'single']]);
  assert.equal(parseChart(normalRemoved.text, TJAParser, 1).bars[0].notes, '3000');
  assert.deepEqual(balloonCounts(normalRemoved.text, 0), [11]);
  assert.ok(normalRemoved.text.endsWith(mixed.slice(mixed.indexOf('COURSE:Oni'))));
  const soloRemoved = deleteCourse(mixed, 2);
  assert.deepEqual(chartVariants(soloRemoved.text).map(variant => variant.player), ['P1', 'P2', 'single']);
  for (const index of [0, 1]) assert.equal(chartVariants(soloRemoved.text)[index].body, chartVariants(mixed)[index].body);
  assert.throws(() => deleteCourse(mixed, 99), /不存在/);
  assert.deepEqual(chartVariants(mixed.replace('COURSE:Normal', 'COURSE:1')).map(variant => variant.key), ['normal', 'normal', 'normal', 'oni']);
});

test('every chart can be deleted while preserving song metadata, including the final chart', () => {
  let text = mixed;
  while (chartVariants(text).length) text = deleteCourse(text, 0).text;
  assert.equal(text, 'TITLE:Mixed\nBPM:120\n');
  assert.deepEqual(parseChart(text, TJAParser).bars, []);
  assert.equal(parseChart(text, TJAParser).variant, null);
});

test('mode deletion retains inherited metadata, comments and CRLF without leaking removed scroll modes', () => {
  const text = 'TITLE:Implicit\nBPM:120\nBALLOON:5\n#BMSCROLL // P1 mode\n#START P1\n7008,\n#END\nBALLOON:9\n#HBSCROLL // P2 mode\n#START P2\n7008,\n#END\nSTYLE:Single\n// retained solo\n#START\n7008,\n#END // solo end\n'.replaceAll('\n', '\r\n');
  const result = deleteCourse(text, 1);
  assert.deepEqual(chartVariants(result.text).map(variant => [variant.course, variant.player]), [['Oni', 'P1'], ['Oni', 'single']]);
  assert.deepEqual(balloonCounts(result.text, 1), [9]);
  assert.deepEqual(parseChart(result.text, TJAParser, 1).unsimulatedCommands, []);
  assert.ok(result.text.includes('// retained solo\r\n#START\r\n7008,\r\n#END // solo end'));
  assert.ok(!/(?<!\r)\n/.test(result.text));
  const duet = deleteCourse(text, 2);
  assert.deepEqual([0, 1].map(index => balloonCounts(duet.text, index)), [[5], [9]]);
  assert.deepEqual([0, 1].map(index => parseChart(duet.text, TJAParser, index).unsimulatedCommands), [['BMSCROLL'], ['HBSCROLL']]);
});

test('adding or splitting player charts preserves originals and copies their course-local fields', () => {
  const original = mixed.replace('LEVEL:8', 'LEVEL:8\nSCOREMODE:2');
  const result = addPlayerCharts(original, 3, 'Double'), variants = chartVariants(result.text);
  assert.ok(result.text.startsWith(original));
  assert.deepEqual(variants.slice(4).map(variant => variant.player), ['P1', 'P2']);
  assert.deepEqual(variants.slice(4).map(variant => variant.body.trim()), ['7008,', '7008,']);
  assert.deepEqual(variants.slice(4).map(variant => variant.fields.SCOREMODE), ['SCOREMODE:2', 'SCOREMODE:2']);
  assert.equal(balloonCounts(result.text, 4)[0], 23); assert.equal(balloonCounts(result.text, 5)[0], 23);
  assert.throws(() => addPlayerCharts(result.text, 4, 'Double'), /已齐全/);
  const shared = 'TITLE:Shared\nBPM:120\nCOURSE:Oni\nSTYLE:Double\nBALLOON:9\n#BMSCROLL // mode\n#START // start\nA07B08,\n#END // tail\n';
  const split = addPlayerCharts(shared, 0, 'Double');
  assert.deepEqual(chartVariants(split.text).map(variant => variant.player), ['P1', 'P2']);
  assert.equal(parseChart(split.text, TJAParser, 0).bars[0].notes, 'A07B08');
  assert.equal(parseChart(split.text, TJAParser, 1).bars[0].notes, 'A07B08');
  assert.ok(split.text.includes('#START P1 // start'));
  assert.deepEqual(chartVariants(split.text).map(variant => variant.prefixCommands), [['#BMSCROLL // mode'], ['#BMSCROLL // mode']]);
  assert.ok(split.text.includes('#END // tail'));
  assert.deepEqual(balloonCounts(split.text, 1), [9]);
  const solo = addPlayerCharts(shared, 0, 'Single');
  assert.equal(chartVariants(solo.text).at(-1).player, 'single');
  assert.deepEqual(chartVariants(solo.text).at(-1).prefixCommands, ['#BMSCROLL // mode']);
});

test('editing inherited balloon pools never rewrites another player or later single-player pool', () => {
  let text = mixed;
  for (const [index, count, slot, denominator] of [[0, 17, 2, 8], [1, 19, 2, 8], [3, 29, 0, 4]]) {
    text = setBalloonCount(text, parseChart(text, TJAParser, index), { bar: 0, numerator: slot, denominator }, count);
  }
  assert.deepEqual([0, 1, 2, 3].map(index => balloonCounts(text, index)[0]), [17, 19, 11, 29]);
  assert.deepEqual(chartVariants(text).map(variant => variant.player), ['P1', 'P2', 'single', 'single']);
});

test('missing counterpart can be added without duplicating an existing player', () => {
  const partial = mixed.slice(0, mixed.indexOf('#START P2')) + 'COURSE:Oni\n#START\n1000,\n#END\n';
  const result = addPlayerCharts(partial, 0, 'Double');
  assert.deepEqual(chartVariants(result.text).filter(variant => variant.course === 'Normal').map(variant => variant.player), ['P1', 'P2']);
});

test('a missing mode tab creates only its requested part and selects that part', () => {
  const p2 = addPlayerCharts(mixed, 3, 'Double', 'P2');
  assert.equal(p2.course, 4); assert.ok(p2.text.startsWith(mixed));
  assert.deepEqual(chartVariants(p2.text).filter(variant => variant.course === 'Oni').map(variant => variant.player), ['single', 'P2']);
  const p1 = addPlayerCharts(p2.text, 4, 'Double', 'P1');
  assert.deepEqual(chartVariants(p1.text).slice(3).map(variant => variant.player), ['single', 'P2', 'P1']);
  assert.deepEqual(balloonCounts(p1.text, p1.course), [23]);
  assert.throws(() => addPlayerCharts(p2.text, 3, 'Double', 'P2'), /已齐全/);
  assert.throws(() => addPlayerCharts(mixed, 3, 'Single', 'P1'), /无效/);
  assert.throws(() => addPlayerCharts(mixed, 3, 'Double', 'P3'), /无效/);
  const solo = addPlayerCharts('TITLE:Solo tab\nBPM:120\nCOURSE:Oni\n#START P2\nB000,\n#END\n', 0, 'Single', 'single');
  assert.deepEqual(chartVariants(solo.text).map(variant => variant.player), ['P2', 'single']);
  assert.equal(parseChart(solo.text, TJAParser, solo.course).bars[0].notes, 'B000');
});

test('a missing player tab splits an inherited shared duet and selects the requested player', () => {
  const text = 'TITLE:Shared tabs\nBPM:120\nCOURSE:Oni\nSTYLE:Double\n#START\nA000,\n#END\nSTYLE:Single\n#START\n1000,\n#END\n';
  const result = addPlayerCharts(text, 1, 'Double', 'P2');
  assert.equal(result.course, 1);
  assert.deepEqual(chartVariants(result.text).map(variant => variant.player), ['P1', 'P2', 'single']);
  assert.deepEqual([0, 1, 2].map(index => parseChart(result.text, TJAParser, index).bars[0].notes), ['A000', 'A000', '1000']);
  const partial = text.replace('STYLE:Single\n#START\n1000,', '#START P1\nB000,');
  const filled = addPlayerCharts(partial, 1, 'Double', 'P2');
  assert.deepEqual(chartVariants(filled.text).map(variant => variant.player), ['P2', 'P1']);
  assert.equal(filled.course, 0);
  assert.deepEqual([0, 1].map(index => parseChart(filled.text, TJAParser, index).bars[0].notes), ['A000', 'B000']);
});
