import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TJAParser } from 'tja';
import { decodeChart, parseChart, insertEmptyBar, deleteBar, replaceBar, resizeNotes, setBaseBpm, setBarSettings, clearBarSettings, barTimeAt, barFractionAt, barStateAt, barStateAtTime, setPositionSettings, clearPositionSettings, barSource, replaceBarSource } from './chart.js';
const chart = body => `TITLE:Test\nBPM:120\nOFFSET:-0.825\nCOURSE:Oni\nLEVEL:7\n#START\n${body}\n#END\n`;

test('playback timing observes command order before and after leading, middle and ending delays', () => {
  const parsed = parseChart(chart('#DELAY 1\n#BPMCHANGE 240\n#SCROLL 2\n10\n#DELAY .5\n#BPMCHANGE 60\n#SCROLL -1\n#MEASURE 3/4\n#GOGOSTART\n20\n#DELAY .25\n#BPMCHANGE 180\n,'), TJAParser);
  const bar = parsed.bars[0], start = .825;
  assert.equal(barStateAtTime(bar, start - .1).bpm, 120);
  assert.equal(barStateAtTime(bar, start + .5).bpm, 120);
  assert.equal(barStateAtTime(bar, start + .5).scroll, 1);
  assert.equal(barStateAtTime(bar, start + .5).delay, 1);
  const first = bar.segments[0], last = bar.segments.at(-1);
  assert.equal(barStateAtTime(bar, first.start + .1).bpm, 240);
  assert.equal(barStateAtTime(bar, first.end + .1).bpm, 240);
  assert.equal(barStateAtTime(bar, first.end + .1).scroll, 2);
  assert.equal(barStateAtTime(bar, last.start + .1).bpm, 60);
  assert.equal(barStateAtTime(bar, last.start + .1).scroll, -1);
  assert.equal(barStateAtTime(bar, last.start + .1).numerator, 3);
  assert.equal(barStateAtTime(bar, last.start + .1).gogo, true);
  assert.equal(barStateAtTime(bar, last.end + .1).bpm, 60);
  assert.equal(barStateAtTime(bar, bar.end).bpm, 180);
  assert.equal(barStateAtTime(bar, bar.end).delay, 0);
});

test('deleting a measure removes its starting and internal instructions and recomputes following timing', () => {
  const source = chart('1000,\n#BPMCHANGE 240\n#DELAY .25\n#MEASURE 3/4\n#SCROLL 2\n#GOGOSTART\n#BARLINEOFF\n70\n#BPMCHANGE 60\n#LYRIC deleted\n80,\n2000,\n#BPMCHANGE 180\n3000,');
  const parsed = parseChart(source, TJAParser), text = deleteBar(source, parsed, parsed.bars[1]);
  const next = parseChart(text, TJAParser);
  assert.deepEqual(next.bars.map(bar => bar.notes), ['1000', '2000', '3000']);
  assert.deepEqual(next.bars.map(bar => bar.bpm), [120, 120, 180]);
  assert.equal(next.bars[1].start, parsed.bars[0].end);
  assert.equal(next.bars[1].duration, 2);
  assert.equal(next.bars[1].numerator, 4); assert.equal(next.bars[1].scroll, 1);
  assert.equal(next.bars[1].gogo, false); assert.equal(next.bars[1].barline, true);
  for (const removed of ['#DELAY', '#MEASURE', '#SCROLL', '#GOGOSTART', '#BARLINEOFF', '#LYRIC', '#BPMCHANGE 60', '#BPMCHANGE 240']) assert.ok(!text.includes(removed), removed);
  assert.throws(() => deleteBar(source, parsed, null), /请先创建/);
  const one = parseChart(chart('1000,'), TJAParser);
  assert.throws(() => deleteBar(chart('1000,'), one, one.bars[0]), /最后一个小节/);
});

test('deletion handles first, middle, last, empty, compact and CRLF measures without touching other players', () => {
  for (const body of ['1000,2000,3000,', '1000, // keep\n2000,\n3000,', ',\n2000,\n3000,', '1000,20\n#DELAY .1\n00,\n3000,']) {
    const source = chart(body).replaceAll('\n', '\r\n') + 'COURSE:Easy\r\n#START P2\r\n4400,\r\n#END\r\n';
    const parsed = parseChart(source, TJAParser);
    for (let index = 0; index < 3; index++) {
      const text = deleteBar(source, parsed, parsed.bars[index]);
      assert.deepEqual(parseChart(text, TJAParser).bars.map(bar => bar.notes), parsed.bars.filter((_, position) => position !== index).map(bar => bar.notes));
      assert.ok(text.endsWith('COURSE:Easy\r\n#START P2\r\n4400,\r\n#END\r\n'));
      assert.ok(!/(?<!\r)\n/.test(text));
    }
  }
});

test('blank measure insertion inherits boundary state without copying instructions or notes', () => {
  const text = chart('#BPMCHANGE 180\n#MEASURE 3/4\n#SCROLL 2\n#GOGOSTART\n#BARLINEOFF\n#DELAY .25\n1000,\n#BPMCHANGE 60\n2000,');
  const parsed = parseChart(text, TJAParser);
  const before = parseChart(insertEmptyBar(text, parsed.bars[0], 'before'), TJAParser);
  assert.deepEqual(before.bars.map(bar => bar.notes), ['0'.repeat(16), '1000', '2000']);
  assert.deepEqual(before.bars.slice(0, 2).map(bar => [bar.bpm, bar.numerator, bar.denominator, bar.scroll, bar.gogo, bar.barline]), [[180, 3, 4, 2, true, false], [180, 3, 4, 2, true, false]]);
  assert.equal(before.bars[0].delay, .25); assert.equal(before.bars[1].delay, 0);
  assert.equal(before.bars[1].commands.length, 0);
  const after = parseChart(insertEmptyBar(text, parsed.bars[0], 'after'), TJAParser);
  assert.deepEqual(after.bars.map(bar => bar.bpm), [180, 180, 60]);
  assert.equal(after.bars[1].commands.length, 0);
  assert.equal(after.bars[1].start, parsed.bars[0].end);
  const events = chart('10\n#BPMCHANGE 60\n#MEASURE 7/8\n#SCROLL 3\n#GOGOSTART\n20,\n3000,');
  const changed = parseChart(insertEmptyBar(events, parseChart(events, TJAParser).bars[0], 'after'), TJAParser);
  assert.equal(changed.bars[1].bpm, 60); assert.equal(changed.bars[1].numerator, 7); assert.equal(changed.bars[1].denominator, 8);
  assert.equal(changed.bars[1].scroll, 3); assert.equal(changed.bars[1].gogo, true);
  assert.equal(changed.bars[1].events.length, 0);
});

test('insertion preserves comments, compact source, CRLF, empty measures and other course/player blocks', () => {
  for (const body of ['1000,2000,', '1000, // keep on first\n2000,', ',\n2000,']) {
    for (const side of ['before', 'after']) {
      const source = chart(body).replaceAll('\n', '\r\n') + 'COURSE:Easy\r\n#START P2\r\n4000,\r\n#END\r\n';
      const parsed = parseChart(source, TJAParser);
      const text = insertEmptyBar(source, parsed.bars[0], side), next = parseChart(text, TJAParser);
      assert.deepEqual(next.bars.map(bar => bar.notes), side === 'before' ? ['0'.repeat(16), parsed.bars[0].notes, '2000'] : [parsed.bars[0].notes, '0'.repeat(16), '2000']);
      assert.ok(text.endsWith('COURSE:Easy\r\n#START P2\r\n4000,\r\n#END\r\n'));
      assert.ok(!/(?<!\r)\n/.test(text));
      if (body.includes('//')) assert.ok(text.includes('1000, // keep on first\r\n'));
      const appended = parseChart(insertEmptyBar(source, parsed.bars[1], 'after'), TJAParser);
      assert.equal(appended.bars.at(-1).notes, '0'.repeat(16));
    }
  }
  assert.throws(() => insertEmptyBar('', null, 'after'), /请先创建/);
  const text = chart('1000,');
  assert.throws(() => insertEmptyBar(text, parseChart(text, TJAParser).bars[0], 'invalid'), /插入位置无效/);
});

test('metadata-only songs parse as empty editable documents without accepting broken chart bodies', () => {
  const parsed = parseChart('TITLE:Empty song\r\nBPM:150\r\nOFFSET:-.25\r\nWAVE:music.ogg\r\n// preserved\r\n', TJAParser);
  assert.equal(parsed.title, 'Empty song'); assert.equal(parsed.baseBpm, 150);
  assert.equal(parsed.offset, -.25); assert.equal(parsed.wave, 'music.ogg');
  assert.deepEqual(parsed.variants, []); assert.deepEqual(parsed.bars, []); assert.equal(parsed.variant, null);
  for (const body of ['#START\n1000,\n', '#END\n', '1000,\n', 'not metadata\n']) assert.throws(() => parseChart(`BPM:120\n${body}`, TJAParser));
  assert.throws(() => parseChart('BPM:0\n', TJAParser), /BPM/);
  assert.throws(() => parseChart('BPM:120\n', TJAParser, 1), /不存在/);
});

test('preserved position controls insert, update and remove exact off-grid commands without simulating effects', () => {
  const source = chart('1002,\n2000,'), cell = { bar: 0, numerator: 1, denominator: 3 };
  const settings = { lyric: 'Line one\\nLine two', section: true, levelhold: true, senote: 12 };
  const edited = setPositionSettings(source, parseChart(source, TJAParser), cell, settings, TJAParser);
  const parsed = parseChart(edited, TJAParser);
  assert.deepEqual(parsed.bars[0].events.map(item => [item.name, item.fraction]), [['LYRIC', 1 / 3], ['SECTION', 1 / 3], ['LEVELHOLD', 1 / 3], ['SENOTECHANGE', 1 / 3]]);
  assert.equal(parsed.bars[0].duration, 2); assert.equal(parsed.bars[1].duration, 2);
  assert.equal(parsed.bars[0].notes.length, 12);
  const changed = setPositionSettings(edited, parsed, cell, { lyric: '', senote: 1 }, TJAParser);
  assert.match(changed, /#LYRIC \r?\n/); assert.match(changed, /#SENOTECHANGE 1/);
  const removed = setPositionSettings(changed, parseChart(changed, TJAParser), cell, { lyric: null, section: null, levelhold: null, senote: null }, TJAParser);
  assert.deepEqual(parseChart(removed, TJAParser).bars[0].events, []);
});

test('preserved command input rejects invalid values and multiline command injection', () => {
  const source = chart('1000,'), parsed = parseChart(source, TJAParser);
  for (const settings of [{ lyric: 'x\n#BPMCHANGE 60' }, { lyric: 'x\r#END' }, { lyric: '// hidden' }, { lyric: 1 }, { section: false }, { levelhold: 'yes' }, ...[0, 13, 1.5, NaN, '3'].map(senote => ({ senote }))]) {
    assert.throws(() => setBarSettings(source, parsed.bars[0], settings));
  }
});

test('barline visibility defaults to on and inherits without changing notes or timing', () => {
  const parsed = parseChart(chart('#BARLINEOFF\n1000,\n2000,\n#BARLINEON\n3000,'), TJAParser);
  assert.deepEqual(parsed.bars.map(bar => bar.barline), [false, false, true]);
  assert.deepEqual(parsed.bars.map(bar => bar.notes), ['1000', '2000', '3000']);
  assert.deepEqual(parsed.bars.map(bar => bar.duration), [2, 2, 2]);
  assert.equal(parsed.bars[0].commands[0].name, 'BARLINEOFF');
  assert.equal(parsed.bars[2].instructions[0].name, 'BARLINEON');
  assert.equal(parseChart(chart('1000,'), TJAParser).bars[0].barline, true);
});

test('intrabar and end-position barline commands affect following boundaries only', () => {
  const parsed = parseChart(chart('10\n#BARLINEOFF\n20,\n3000\n#BARLINEON\n,\n4000,'), TJAParser);
  const first = parsed.bars[0];
  assert.equal(first.barline, true);
  assert.equal(barStateAt(first, .25).barline, true);
  assert.equal(barStateAt(first, .5).barline, false);
  assert.equal(first.finalState.barline, false);
  assert.equal(first.events[0].fraction, .5);
  assert.deepEqual(parsed.bars.map(bar => bar.barline), [true, false, true]);
  assert.equal(parsed.bars[1].events[0].fraction, 1);
  assert.equal(parsed.bars[1].finalState.barline, true);
  assert.deepEqual(parsed.bars.map(bar => bar.duration), [2, 2, 2]);
});

test('empty measures keep barline commands and a new difficulty resets visibility', () => {
  const source = chart('#BARLINEOFF\n,\n,') + 'COURSE:Easy\nLEVEL:1\n#START\n1000,\n#END\n';
  const parsed = parseChart(source, TJAParser);
  assert.deepEqual(parsed.bars.map(bar => bar.barline), [false, false]);
  assert.equal(parseChart(source, TJAParser, 1).bars[0].barline, true);
  assert.equal(parseChart(replaceBar(source, parsed.bars[0], '2000'), TJAParser).bars[0].barline, false);
});

test('barline switches preserve positive and negative delays and their inherited timing', () => {
  const body = '#BARLINEOFF\n#DELAY .25\n10\n#BARLINEON\n#DELAY -.125\n20,\n3000,';
  const parsed = parseChart(chart(body), TJAParser);
  const baseline = parseChart(chart(body.replace(/^#BARLINE.*\n/gm, '')), TJAParser);
  assert.deepEqual(parsed.bars.map(bar => [bar.start, bar.end, bar.duration]), baseline.bars.map(bar => [bar.start, bar.end, bar.duration]));
  assert.deepEqual(parsed.bars.map(bar => bar.barline), [false, true]);
  assert.equal(barStateAt(parsed.bars[0], .5).barline, true);
});

test('barline settings insert at exact fractions, replace opposite commands and clear to inheritance', () => {
  const source = chart('1002,\n2000,'), position = { bar: 0, numerator: 1, denominator: 3 };
  const edited = setPositionSettings(source, parseChart(source, TJAParser), position, { barline: false }, TJAParser);
  const parsed = parseChart(edited, TJAParser);
  assert.equal(parsed.bars[0].notes, '100000000200');
  assert.equal(parsed.bars[0].events[0].name, 'BARLINEOFF');
  assert.equal(parsed.bars[0].events[0].fraction, 1 / 3);
  assert.equal(parsed.bars[1].barline, false);
  const changed = setPositionSettings(edited, parsed, position, { barline: true }, TJAParser);
  assert.ok(!changed.includes('#BARLINEOFF'));
  assert.equal((changed.match(/#BARLINEON/g) || []).length, 1);
  const removed = setPositionSettings(changed, parseChart(changed, TJAParser), position, { barline: null }, TJAParser);
  assert.ok(!removed.includes('#BARLINE'));
  const restored = clearPositionSettings(changed, parseChart(changed, TJAParser).bars[0], position);
  assert.ok(!restored.includes('#BARLINE'));
  assert.equal(parseChart(restored, TJAParser).bars[1].barline, true);
  for (const value of ['off', 0, undefined]) assert.throws(() => setBarSettings(source, parseChart(source, TJAParser).bars[0], { barline: value }), /小节线/);
});

test('non-simulated commands are reported, located and preserved when parameter commands are reset', () => {
  const source = chart('#LYRIC Header\n#SECTION\n#LEVELHOLD\n#SENOTECHANGE 3\n#BARLINEOFF\n1000,\n2000,');
  const parsed = parseChart(source, TJAParser);
  assert.deepEqual(parsed.unsimulatedCommands, ['LYRIC', 'SECTION', 'LEVELHOLD', 'SENOTECHANGE']);
  assert.equal(parsed.bars[0].instructions.length, 5);
  assert.ok(barSource(source, parsed.bars[0]).startsWith('#LYRIC Header'));
  for (const edited of [clearBarSettings(source, parsed.bars[0]), clearPositionSettings(source, parsed.bars[0], { numerator: 0, denominator: 1 })]) {
    assert.ok(!edited.includes('#BARLINEOFF'));
    for (const name of parsed.unsimulatedCommands) assert.ok(edited.includes(`#${name}`));
  }
});

test('resampling retains exact lyric and note-lyric command positions', () => {
  const source = chart('10\n#LYRIC Middle\n#SENOTECHANGE 4\n20,\n0000,');
  const parsed = parseChart(source, TJAParser);
  const edited = replaceBar(source, parsed.bars[0], '10002000');
  const next = parseChart(edited, TJAParser);
  assert.equal(next.bars[0].notes, '10002000');
  assert.deepEqual(next.bars[0].events.map(event => [event.name, event.slot, event.fraction]), [['LYRIC', 4, .5], ['SENOTECHANGE', 4, .5]]);
  assert.equal(next.bars[0].duration, parsed.bars[0].duration);
  assert.equal(next.bars[1].start, parsed.bars[1].start);
});

test('scroll-mode headers warn rather than claiming game-scroll support and unknown body commands reject', () => {
  for (const name of ['BMSCROLL', 'HBSCROLL']) {
    const parsed = parseChart(chart('1000,').replace('#START', `#${name}\n#START`), TJAParser);
    assert.deepEqual(parsed.unsimulatedCommands, [name]);
  }
  for (const name of ['BRANCHSTART', 'NEXTSONG', 'DIRECTION', 'SUDDEN', 'JPOSSCROLL']) {
    assert.throws(() => parseChart(chart(`#${name} 1\n1000,`), TJAParser));
  }
});

test('scroll-mode and preserved-command warnings belong only to the selected difficulty', () => {
  const source = chart('#LYRIC First course\n1000,').replace('#START', '#HBSCROLL\n#START')
    + 'COURSE:Easy\nLEVEL:1\n#START\n2000,\n#END\n';
  assert.deepEqual(parseChart(source, TJAParser).unsimulatedCommands, ['HBSCROLL', 'LYRIC']);
  assert.deepEqual(parseChart(source, TJAParser, 1).unsimulatedCommands, []);
});
test('offset and variable timing', () => {
  const result = parseChart(chart('1000,\n#BPMCHANGE 60\n#MEASURE 3/4\n#DELAY 0.5\n2000,'), TJAParser);
  assert.equal(result.bars[0].start, 0.825);
  assert.equal(result.bars[0].duration, 2);
  assert.equal(result.bars[1].start, 3.325);
  assert.equal(result.bars[1].duration, 3);
});
test('edit preserves comments and other bars', () => {
  const source = chart('// hello\n10 // keep\n20,\n2000,');
  const parsed = parseChart(source, TJAParser);
  const edited = replaceBar(source, parsed.bars[0], '30004000,');
  assert.ok(edited.includes('// keep'));
  assert.equal(parseChart(edited, TJAParser).bars[0].notes, '30004000');
  assert.equal(parseChart(edited, TJAParser).bars[1].notes, '2000');
});
test('subdivision never silently moves a note', () => {
  assert.equal(resizeNotes('1200', 8), '10200000');
  assert.throws(() => resizeNotes('0100', 3));
});
test('intrabar BPM changes time only the following portion', () => {
  const result = parseChart(chart('10\n#BPMCHANGE 60\n20,\n1000,'), TJAParser);
  assert.equal(result.bars[0].duration, 3);
  assert.equal(barTimeAt(result.bars[0], .5), 1.825);
  assert.equal(barTimeAt(result.bars[0], .75), 2.825);
  assert.equal(result.bars[1].bpm, 60);
});
test('empty bars retain duration and can be edited', () => {
  const source = chart(',\n1000,');
  const parsed = parseChart(source, TJAParser);
  assert.equal(parsed.bars[1].start, 2.825);
  assert.equal(parseChart(replaceBar(source, parsed.bars[0], '2000'), TJAParser).bars[0].notes, '2000');
});
test('explicit double-player parts are editable with their own player identity', () => {
  const parsed = parseChart(chart('A0B0,').replace('#START', '#START P1'), TJAParser);
  assert.equal(parsed.variant.player, 'P1');
  assert.equal(parsed.variant.style, 'Double');
  assert.equal(parsed.bars[0].notes, 'A0B0');
});
test('course edits preserve the other difficulty', () => {
  const source = chart('1000,') + 'COURSE:Easy\nLEVEL:1\n#START\n2000,\n#END\n';
  const parsed = parseChart(source, TJAParser, 1);
  assert.deepEqual(parsed.courses, ['Oni', 'Easy']);
  const edited = replaceBar(source, parsed.bars[0], '3000');
  assert.equal(parseChart(edited, TJAParser, 0).bars[0].notes, '1000');
  assert.equal(parseChart(edited, TJAParser, 1).bars[0].notes, '3000');
});
test('real Shift-JIS chart parses with correct timing and round trips', () => {
  const decoded = decodeChart(readFileSync(new URL('../../夜想陽炎 - short ver.tja', import.meta.url)));
  const parsed = parseChart(decoded.text, TJAParser);
  assert.equal(parsed.title, '夜想陽炎');
  assert.equal(parsed.bars[0].start, 0.825);
  assert.ok(parsed.bars.length > 60);
  assert.equal(replaceBar(decoded.text, parsed.bars[0], parsed.bars[0].notes), decoded.text);
});

test('bar settings update timing, scroll and gogo with normal TJA inheritance', () => {
  const source = chart('1000,\n2000,\n#BPMCHANGE 60\n#MEASURE 4/4\n#SCROLL 1\n#GOGOEND\n1000,');
  const parsed = parseChart(source, TJAParser);
  const edited = setBarSettings(source, parsed.bars[1], { bpm: 180, numerator: 3, denominator: 4, scroll: 2, delay: .5, gogo: true });
  const result = parseChart(edited, TJAParser);
  assert.equal(result.bars[0].duration, 2);
  assert.equal(result.bars[1].duration, 1);
  assert.equal(result.bars[1].start, 3.325);
  assert.equal(result.bars[1].scroll, 2);
  assert.equal(result.bars[1].gogo, true);
  assert.equal(result.bars[2].bpm, 60);
  assert.equal(result.bars[2].duration, 4);
  assert.equal(result.bars[2].scroll, 1);
  assert.equal(result.bars[2].gogo, false);
  assert.equal(result.bars[2].delay, 0);
});

test('replacing settings preserves comments, CRLF and other courses and sums delays', () => {
  const source = (chart('#BPMCHANGE 150 // tempo\n#DELAY .2\n#DELAY .3 // pause\n#GOGOSTART\n1000,') + 'COURSE:Easy\n#START\n2000,\n#END\n').replaceAll('\n', '\r\n');
  const parsed = parseChart(source, TJAParser);
  assert.equal(parsed.bars[0].delay, .5);
  const edited = setBarSettings(source, parsed.bars[0], { bpm: 90, delay: 0, gogo: false });
  const result = parseChart(edited, TJAParser);
  assert.equal(result.bars[0].bpm, 90);
  assert.equal(result.bars[0].start, .825);
  assert.equal(result.bars[0].gogo, false);
  assert.match(edited, /#DELAY 0/);
  assert.ok(edited.includes('// tempo\r\n'));
  assert.ok(edited.includes('// pause\r\n'));
  assert.ok(edited.endsWith('COURSE:Easy\r\n#START\r\n2000,\r\n#END\r\n'));
});

test('empty bars and same-line bars accept settings without moving notes', () => {
  for (const body of [',2000,', '1000,2000,']) {
    const source = chart(body), parsed = parseChart(source, TJAParser);
    const edited = setBarSettings(source, parsed.bars[1], { scroll: -1, numerator: 7, denominator: 8 });
    const result = parseChart(edited, TJAParser);
    assert.equal(result.bars[1].notes, '2000');
    assert.equal(result.bars[1].scroll, -1);
    assert.equal(result.bars[1].duration, 1.75);
  }
});

test('base BPM changes retain explicit tempo overrides and invalid settings fail', () => {
  const source = chart('1000,\n#BPMCHANGE 180\n2000,');
  const result = parseChart(setBaseBpm(source, 60), TJAParser);
  assert.equal(result.baseBpm, 60);
  assert.equal(result.bars[0].duration, 4);
  assert.equal(result.bars[1].bpm, 180);
  for (const settings of [{ bpm: 0 }, { bpm: Infinity }, { numerator: 1.5 }, { denominator: 0 }, { delay: Infinity }, { scroll: NaN }]) {
    assert.throws(() => setBarSettings(source, result.bars[0], settings));
  }
});

test('negative boundary and intrabar delays advance notes and preserve source positions', () => {
  const source = chart('#DELAY -0.5\n10\n#DELAY -0.5\n20,\n1000,').replace('OFFSET:-0.825', 'OFFSET:0');
  const parsed = parseChart(source, TJAParser), bar = parsed.bars[0];
  assert.equal(bar.start, -.5);
  assert.equal(barTimeAt(bar, .5), 0);
  assert.equal(bar.end, 1);
  assert.equal(parsed.bars[1].start, 1);
  const edited = setPositionSettings(source, parsed, { bar: 0, numerator: 1, denominator: 2 }, { delay: -.75 }, TJAParser);
  const changed = parseChart(edited, TJAParser);
  assert.equal(barTimeAt(changed.bars[0], .5), -.25);
  assert.equal(changed.bars[0].notes, '1020');
  assert.ok(edited.includes('#DELAY -0.75'));
  for (const value of ['Infinity', 'NaN', '']) assert.throws(() => parseChart(chart(`#DELAY ${value}\n1000,`), TJAParser));
});

test('inverse timing prefers the later source segment when negative delay overlaps time', () => {
  const bar = parseChart(chart('10\n#DELAY -.5\n20,').replace('OFFSET:-0.825', 'OFFSET:0'), TJAParser).bars[0];
  assert.equal(barFractionAt(bar, .25), .125);
  assert.equal(barFractionAt(bar, .5), .5);
  assert.equal(barFractionAt(bar, .75), .625);
  assert.equal(barFractionAt(bar, 1.25), .875);
  assert.equal(barFractionAt(bar, 1.5), 1);
});

test('intrabar meter and multiple delays produce piecewise times and invert through pauses', () => {
  const result = parseChart(chart('10\n#BPMCHANGE 60\n#MEASURE 3/4\n#DELAY .25\n#DELAY .5\n20,\n1000,'), TJAParser);
  const bar = result.bars[0];
  assert.equal(bar.start, .825);
  assert.equal(bar.duration, 3.25);
  assert.equal(barTimeAt(bar, .25), 1.325);
  assert.equal(barTimeAt(bar, .5), 2.575);
  assert.equal(barTimeAt(bar, .75), 3.325);
  assert.equal(barFractionAt(bar, 2), .5);
  assert.equal(barFractionAt(bar, 3.325), .75);
  assert.equal(result.bars[1].numerator, 3);
  assert.equal(result.bars[1].delay, 0);
  assert.equal(result.bars[1].start, bar.end);
});

test('clearing local settings restores inheritance while preserving notes and comments', () => {
  const source = chart('#SCROLL 2\n#GOGOSTART\n1000,\n#BPMCHANGE 180 // keep\n#SCROLL 3\n#GOGOEND\n#DELAY .5\n2000,');
  const parsed = parseChart(source, TJAParser);
  const edited = clearBarSettings(source, parsed.bars[1]);
  const result = parseChart(edited, TJAParser);
  assert.equal(result.bars[1].bpm, 120);
  assert.equal(result.bars[1].scroll, 2);
  assert.equal(result.bars[1].gogo, true);
  assert.equal(result.bars[1].delay, 0);
  assert.equal(result.bars[1].notes, '2000');
  assert.ok(edited.includes('// keep'));
});

test('intrabar scroll and gogo retain exact positions when editing and resampling notes', () => {
  const source = chart('#SCROLL 1\n30\n#SCROLL .75 // quarter\n30\n#GOGOSTART\n#SCROLL .5\n30\n#SCROLL 4\n40,\n1000,');
  const parsed = parseChart(source, TJAParser), bar = parsed.bars[0];
  assert.equal(bar.scroll, 1);
  assert.equal(bar.gogo, false);
  assert.deepEqual(bar.events.map(event => event.fraction), [.25, .5, .5, .75]);
  assert.equal(parsed.bars[1].scroll, 4);
  assert.equal(parsed.bars[1].gogo, true);
  const edited = replaceBar(source, bar, '1000200030004000');
  const result = parseChart(edited, TJAParser);
  assert.deepEqual(result.bars[0].events.map(event => event.fraction), [.25, .5, .5, .75]);
  assert.equal(result.bars[0].notes, '1000200030004000');
  assert.ok(edited.includes('// quarter'));
  assert.throws(() => replaceBar(source, bar, '100'), /指令位置/);
  const changed = parseChart(setBarSettings(source, bar, { scroll: 2 }), TJAParser);
  assert.equal(changed.bars[0].scroll, 2);
  assert.deepEqual(changed.bars[0].events.map(event => event.fraction), [.25, .5, .5, .75]);
});

test('empty first measure accepts and clears boundary commands', () => {
  const source = chart(',\n1000,');
  const parsed = parseChart(source, TJAParser);
  const edited = setBarSettings(source, parsed.bars[0], { bpm: 90, scroll: 0 });
  const result = parseChart(edited, TJAParser);
  assert.equal(result.bars[0].notes, '0');
  assert.equal(result.bars[0].scroll, 0);
  const cleared = parseChart(clearBarSettings(edited, result.bars[0]), TJAParser);
  assert.equal(cleared.bars[0].bpm, 120);
  assert.equal(cleared.bars[0].scroll, 1);
});

test('arbitrary-position commands resample without shifting notes and replace only that point', () => {
  const source = chart('1002,\n1000,');
  const cell = { bar: 0, numerator: 1, denominator: 3 };
  const edited = setPositionSettings(source, parseChart(source, TJAParser), cell, { bpm: 60, scroll: 2, delay: .5, gogo: true }, TJAParser);
  const parsed = parseChart(edited, TJAParser), bar = parsed.bars[0];
  assert.equal(bar.notes, '100000000200');
  assert.ok(bar.events.every(event => event.fraction === 1 / 3));
  assert.ok(Math.abs(barTimeAt(bar, 1 / 3) - (.825 + 2 / 3 + .5)) < 1e-10);
  const changed = setPositionSettings(edited, parsed, cell, { bpm: 90 }, TJAParser);
  const next = parseChart(changed, TJAParser);
  assert.equal(next.bars[0].events.filter(event => event.name === 'BPMCHANGE').length, 1);
  assert.equal(next.bars[0].events.find(event => event.name === 'SCROLL').value, '2');
  const cleared = parseChart(clearPositionSettings(changed, next.bars[0], cell), TJAParser);
  assert.equal(cleared.bars[0].events.length, 0);
  assert.equal(cleared.bars[0].duration, 2);
  assert.equal(cleared.bars[1].notes, '1000');
});

test('commands at measure end affect the next measure and survive note replacement', () => {
  const source = chart('1000,\n2000,');
  const edited = setPositionSettings(source, parseChart(source, TJAParser), { bar: 0, numerator: 1, denominator: 1 }, { bpm: 60, delay: .5 }, TJAParser);
  const parsed = parseChart(edited, TJAParser);
  assert.equal(parsed.bars[0].duration, 2.5);
  assert.equal(parsed.bars[1].bpm, 60);
  const replaced = parseChart(replaceBar(edited, parsed.bars[0], '2000'), TJAParser);
  assert.equal(replaced.bars[0].events.length, 2);
  assert.equal(replaced.bars[0].notes, '2000');
});

test('complete measure source contains commands and edits them without changing neighbors', () => {
  const source = chart('1000,\n#SCROLL 2\n10\n#BPMCHANGE 60 // keep\n20,\n2000,');
  const parsed = parseChart(source, TJAParser), bar = parsed.bars[1];
  assert.ok(barSource(source, bar).includes('#BPMCHANGE 60'));
  const edited = replaceBarSource(source, parsed, bar, '#MEASURE 3/4\n10\n#DELAY .5\n20,', TJAParser);
  const result = parseChart(edited, TJAParser);
  assert.equal(result.bars[0].notes, '1000');
  assert.equal(result.bars[1].duration, 2);
  assert.equal(result.bars[2].notes, '2000');
  for (const content of ['1000,2000,', '#END\n1000,', '1000,\n#DELAY 1']) assert.throws(() => replaceBarSource(source, parsed, bar, content, TJAParser));
});
test('removing selected command types preserves other commands at the same point', () => {
  const source = chart('10\n#BPMCHANGE 60\n#SCROLL 2\n#GOGOSTART\n20,');
  const parsed = parseChart(source, TJAParser), cell = { bar: 0, numerator: 1, denominator: 2 };
  const edited = setPositionSettings(source, parsed, cell, { bpm: null, gogo: null }, TJAParser);
  const events = parseChart(edited, TJAParser).bars[0].events;
  assert.deepEqual(events.map(event => event.name), ['SCROLL']);
});
test('empty arbitrary-position updates do not resample and invalid positions cannot write', () => {
  const source = chart('1000,'), parsed = parseChart(source, TJAParser);
  assert.equal(setPositionSettings(source, parsed, { bar: 0, numerator: 1, denominator: 7 }, { bpm: null, delay: null }, TJAParser), source);
  for (const [numerator, denominator] of [[-1,4],[5,4],[1,0],[.5,4]]) assert.throws(() => setPositionSettings(source, parsed, { bar: 0, numerator, denominator }, { bpm: 60 }, TJAParser));
  assert.throws(() => replaceBarSource(source, parsed, parsed.bars[0], '1'.repeat(65537) + ',', TJAParser), /65536/);
});