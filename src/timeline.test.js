import test from 'node:test';
import assert from 'node:assert/strict';
import { TJAParser } from 'tja';
import { parseChart, barTimeAt } from './chart.js';
import { createBeatTimeline, createTimelineViewport } from './timeline.js';

const chart = (body, bpm = 100, offset = 0) => `TITLE:Beat timeline\nBPM:${bpm}\nOFFSET:${offset}\nCOURSE:Oni\nLEVEL:1\n#START\n${body}\n#END\n`;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('viewport gutters keep the first note fully visible and selectable before the chart start at every zoom', () => {
  for (const bpm of [60, 240]) for (const offset of [-1.25, 0, .825]) {
    const parsed = parseChart(chart(`3${'0'.repeat(126)}7,`, bpm, offset), TJAParser), scale = createBeatTimeline(parsed), bar = parsed.bars[0];
    for (const width of [192, 528, 932]) for (const beats of [2, width / 72, 32]) {
      const viewport = createTimelineViewport(scale, { bars: [bar], startBeat: scale.beatAt(bar.start) }, beats, width);
      near(viewport.x(bar.start), 24);
      near(viewport.timeAt(viewport.x(bar.start)), bar.start);
      const hit = viewport.hitTest(viewport.x(bar.start) - 14);
      assert.equal(hit.item, bar);
      assert.ok(hit.time < bar.start);
      assert.equal(viewport.hitTest(viewport.x(bar.start) - 14.01).item, undefined);
    }
  }
});

test('viewport end gutter keeps the last note selectable beyond the chart end', () => {
  for (const bpm of [60, 240]) for (const offset of [-1.25, 0, .825]) {
    const parsed = parseChart(chart(`3${'0'.repeat(126)}7,`, bpm, offset), TJAParser), scale = createBeatTimeline(parsed), bar = parsed.bars[0];
    const lastNote = barTimeAt(bar, 127 / 128);
    for (const width of [192, 528, 932]) for (const beats of [2, width / 72, 32]) {
      const viewport = createTimelineViewport(scale, { bars: [bar], startBeat: scale.beatAt(bar.end) - beats }, beats, width);
      near(viewport.x(bar.end), width + 24);
      assert.ok(width + 48 - (viewport.x(lastNote) + 16) >= 8);
      const hit = viewport.hitTest(viewport.x(lastNote) + 16);
      assert.equal(hit.item, bar);
      assert.ok(hit.time > bar.end);
      near(viewport.timeAt(viewport.x(lastNote)), lastNote);
      assert.equal(viewport.hitTest(viewport.x(bar.end) + 17).item, undefined);
    }
  }
});

test('100 and 200 BPM measures and note intervals have identical beat widths but different playback durations', () => {
  const parsed = parseChart(chart('1111,\n1111,\n#BPMCHANGE 200\n1111,\n1111,'), TJAParser);
  const scale = createBeatTimeline(parsed);
  for (const [index, bar] of parsed.bars.entries()) {
    near(scale.beatAt(bar.end) - scale.beatAt(bar.start), 4);
    near(bar.duration, index < 2 ? 2.4 : 1.2);
    for (let note = 0; note < 4; note++) near(scale.beatAt(barTimeAt(bar, note / 4)), index * 4 + note);
  }
  near(scale.timeAt(8), 4.8); near(scale.timeAt(12), 6);
});

test('mid-measure BPM changes do not compress notes and meter changes scale by beat count, not seconds', () => {
  const parsed = parseChart(chart('11\n#BPMCHANGE 200\n11,\n#MEASURE 3/4\n111,\n#MEASURE 7/8\n1111111,'), TJAParser);
  const scale = createBeatTimeline(parsed), [first, second, third] = parsed.bars;
  for (let note = 0; note <= 4; note++) near(scale.beatAt(barTimeAt(first, note / 4)), note);
  near(scale.beatAt(second.end) - scale.beatAt(second.start), 3);
  near(scale.beatAt(third.end) - scale.beatAt(third.start), 3.5);
  near(first.duration, 1.8);
});

test('changing base BPM preserves beat positions while offsets, delays and audio-tail extrapolation round trip', () => {
  for (const bpm of [100, 200]) {
    const parsed = parseChart(chart('1111,\n1111,', bpm), TJAParser), scale = createBeatTimeline(parsed);
    near(scale.beatAt(parsed.bars[1].start), 4);
    near(scale.beatAt(parsed.bars[1].end), 8);
  }
  for (const offset of [-.825, 0, 1.25]) {
    for (const delay of [-3, .25, 2]) {
      const parsed = parseChart(chart(`#BPMCHANGE 150\n#DELAY .3\n11\n#BPMCHANGE 200\n#DELAY ${delay}\n11,\n1111,`, 100, offset), TJAParser);
      const scale = createBeatTimeline(parsed);
      near(scale.beatAt(0), 0);
      let previous = -Infinity;
      for (let step = -80; step <= 200; step++) {
        const time = step / 10, beat = scale.beatAt(time);
        assert.ok(beat > previous); previous = beat;
        near(scale.timeAt(beat), time);
      }
    }
  }
});

test('branch tempo maps use only the selected route and keep shared continuation at its real end', () => {
  const text = chart('1111,\n#BRANCHSTART p,50,80\n#N\n#BPMCHANGE 100\n1111,\n#E\n#BPMCHANGE 200\n1111,\n#M\n#BPMCHANGE 300\n1111,\n#BRANCHEND\n1111,');
  for (const route of ['N', 'E', 'M']) {
    const parsed = parseChart(text, TJAParser, 0, [route]), scale = createBeatTimeline(parsed);
    for (const bar of parsed.bars) near(scale.beatAt(bar.end) - scale.beatAt(bar.start), 4);
    near(scale.beatAt(parsed.bars[2].start), 8);
    near(parsed.bars[2].start, parsed.bars[1].end);
  }
  const empty = createBeatTimeline(null);
  near(empty.timeAt(empty.beatAt(-2)), -2);
});
