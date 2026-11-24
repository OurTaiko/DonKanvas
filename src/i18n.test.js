import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { computed, reactive, ref } from 'vue';
import { parse, compileScript } from 'vue/compiler-sfc';
import { TJAParser } from 'tja';
import { parseChart } from './chart.js';
import { translations } from './locales.js';
import { SONG_FIELDS, setSongMetadata } from './metadata.js';
import { NOTE_TYPES } from './note-model.js';
import { createTimelineViewport, TIMELINE_GUTTER } from './timeline.js';
import { measureStart, measureEnd } from './loop.js';
import { languages, locale, localePreference, matchLocale, detectLocale, initializeLocale, setLocale, LOCALE_KEY, t, message, formatMessage, LocalizedError } from './i18n.js';

const reset = () => { locale.value = 'zh-CN'; localePreference.value = 'auto'; };
const placeholders = text => [...new Set(text.match(/\{\w+\}/g) || [])].sort();

test('file tabs ellipsize only the filename and retain the full title and separate dirty marker', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'tab-filenames' });
  assert.match(descriptor.template.content, /class="chart-tab-select" :title="document.id === state.activeId \? state.filename : document.filename"/);
  assert.match(descriptor.template.content, /<span class="chart-tab-name">[\s\S]*?<\/span><span v-if=[^>]*class="chart-tab-dirty"/);
  const styles = descriptor.styles[0].content;
  assert.match(styles, /\.chart-tab-name\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
  assert.match(styles, /\.chart-tab-dirty\{flex-shrink:0\}/);
  assert.match(styles, /\.chart-tab\{[^}]*max-width:320px/);
});

test('queued timeline scroll events after switching files cannot access an unmounted viewport', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.match(/function scrollTimeline\(\) \{[\s\S]*?\n\}/)[0];
  const handle = runInNewContext(`${source}; scrollTimeline`, { state: { chart: {} }, viewport: { value: null } });
  assert.doesNotThrow(() => handle());
});

test('timeline waveforms extend beneath both gutter masks using the beat projection and leave audio boundaries blank', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('function drawWave('), script.indexOf('function timelineCell('));
  function brush() {
    const rectangles = [], labels = [], offsets = [];
    let offset = 0;
    return {
      rectangles, labels,
      fillRect(x, y, width, height) { rectangles.push({ x: x + offset, y, width, height, color: this.fillStyle }); },
      fillText(text, x) { labels.push({ text, x: x + offset }); },
      save() { offsets.push(offset); }, restore() { offset = offsets.pop(); }, translate(x) { offset += x; },
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}
    };
  }
  const scale = {
    beatAt: time => time <= 50 ? time : 50 + (time - 50) * 2,
    timeAt: beat => beat <= 50 ? beat : 50 + (beat - 50) / 2
  };
  for (const width of [80, 192]) for (const startBeat of [0, 45, 145]) {
    const timelineBrush = brush(), overviewBrush = brush(), beats = 20;
    const view = { bars: [], startBeat, start: scale.timeAt(startBeat), end: scale.timeAt(startBeat + beats) };
    const timeline = { value: { style: {} } }, overview = { value: {} };
    const state = { chart: { bars: [] }, buffer: { duration: 100 }, peaks: [...Array(500).fill(.25), ...Array(500).fill(.75)], position: -100 };
    const draw = runInNewContext(`${source}; draw`, {
      state, timeline, overview, visible: { value: view }, viewportWidth: { value: width }, viewBeats: { value: beats },
      timelineScale: { value: scale }, timelineBounds: { value: { start: 0, end: 100 } },
      spans: { value: [] }, hover: { value: null }, TIMELINE_GUTTER, createTimelineViewport, syncScroll() {}, t: text => text,
      canvasContext: canvas => ({ brush: canvas === timeline.value ? timelineBrush : overviewBrush, width: width + TIMELINE_GUTTER * 2, height: 250 })
    });
    draw();
    assert.match(descriptor.styles[0].content, /\.timeline-frame #timeline\{height:250px;/);
    const waveArea = timelineBrush.rectangles.find(rect => rect.color === '#f3f7f2');
    const noteArea = timelineBrush.rectangles.find(rect => rect.color === '#f6f7f3');
    assert.equal(noteArea.y - (waveArea.y + waveArea.height), 6);
    const waveform = timelineBrush.rectangles.filter(rect => rect.color === '#72a592');
    const projection = createTimelineViewport(scale, view, beats, width), fullWidth = width + TIMELINE_GUTTER * 2;
    const audiblePixels = Array.from({ length: fullWidth }, (_, x) => x).filter(x => projection.timeAt(x + 1) > 0 && projection.timeAt(x) < 100);
    assert.deepEqual(waveform.map(rect => rect.x), audiblePixels);
    if (startBeat === 45) {
      assert.equal(waveform[0].x, 0); assert.equal(waveform.at(-1).x, fullWidth - 1);
      assert.equal(waveform[0].height, .25 * 59 * 2);
      assert.equal(waveform.at(-1).height, .75 * 59 * 2);
    }
    const masks = timelineBrush.rectangles.filter(rect => rect.color === '#b8b8b880');
    assert.deepEqual(masks.map(rect => [rect.x, rect.width]), [[0, 24], [width + 24, 24]]);
    assert.ok(timelineBrush.rectangles.indexOf(masks[0]) > timelineBrush.rectangles.indexOf(waveform.at(-1)));
    state.buffer = null; draw();
    assert.deepEqual(timelineBrush.labels.at(-1), { text: '无伴奏 · 可播放谱面音符音', x: TIMELINE_GUTTER + 14 });
  }
});

test('overview section bands follow intra-measure Go-Go events and the selected branch duration independently', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('function gogoIntervals('), script.indexOf('function draw()'));
  const text = `TITLE:Overview
BPM:120
OFFSET:1
COURSE:Oni
#START
10
#GOGOSTART
10
#DELAY .5
#GOGOEND
10
#GOGOSTART
10,
#BRANCHSTART p,50,80
#N
#DELAY .25
1000,
#E
#GOGOEND
#DELAY .25
#BPMCHANGE 120
2000,
#BRANCHEND
#GOGOEND
1000,
#END`;
  for (const route of ['N', 'E']) {
    const state = { chart: parseChart(text, TJAParser, 0, [route]) }, rectangles = [];
    const before = JSON.stringify(state);
    const brush = { fillRect(x, y, width, height) { rectangles.push({ x, y, width, height, color: this.fillStyle }); } };
    const draw = runInNewContext(`${source}; drawOverviewSections`, { state, measureStart, measureEnd });
    draw(brush, time => (time + 1) * 10, 40);
    const gogo = rectangles.filter(rect => rect.color === '#d9a032').map(({ x, y, width, height }) => [x, y, width, height]);
    const branches = rectangles.filter(rect => rect.color === '#9270b5').map(({ x, y, width, height }) => [x, y, width, height]);
    assert.deepEqual(gogo, route === 'N' ? [[5, 0, 10, 3], [20, 0, 5, 3], [27.5, 0, 20, 3]] : [[5, 0, 10, 3], [20, 0, 5, 3]]);
    assert.deepEqual(branches, [[25, 37, 22.5, 3]]);
    assert.equal(JSON.stringify(state), before);
    state.chart.bars = []; rectangles.length = 0;
    draw(brush, time => time, 40);
    assert.deepEqual(rectangles, []);
  }
});

test('overview centers a location icon on the exact selected time, including both waveform edges', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.match(/const overviewSelection = computed\(\(\) => \{[\s\S]*?\n\}\);/)[0];
  const cell = ref(null), timelineBounds = ref({ start: -2, end: 8 });
  const position = runInNewContext(`${source}; overviewSelection`, { computed, cell, timelineBounds });
  assert.equal(position.value, null);
  for (const [time, expected] of [[-2, 0], [-1.9, 1], [3, 50], [7.9, 99], [8, 100]]) {
    cell.value = { time };
    assert.ok(Math.abs(position.value - expected) < 1e-10);
  }
  timelineBounds.value = { start: 0, end: 16 };
  assert.equal(position.value, 50);
  cell.value = null;
  assert.equal(position.value, null);
  assert.ok(descriptor.template.content.includes('<svg v-if="overviewSelection !== null" class="overview-selection" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" :style="{ left: `${overviewSelection}%` }"><circle cx="12" cy="12" r="7" /><path d="M12 2v20M2 12h20" /></svg>'));
  const markerStyle = descriptor.styles[0].content.match(/\.overview-selection\{([^}]*)\}/)[1];
  assert.match(markerStyle, /top:50%;width:24px;height:24px;transform:translate\(-50%,-50%\);color:#49638c;stroke-width:2;pointer-events:none/);
  assert.doesNotMatch(markerStyle, /border|background|box-shadow/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /#239eae35|overviewContext\.height - 4/);
});

test('overview measure ranges fill the full height behind the Go-Go and branch bands', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('function gogoIntervals('), script.indexOf('function draw()'));
  const state = { chart: { bars: [
    { index: 0, start: -1, end: 1, events: [] },
    { index: 1, start: 1, end: 3, delay: .5, gogo: true, route: 'N', events: [] },
    { index: 2, start: 3, end: 5, events: [] }
  ] } };
  const selected = new Set([1, 2]), rectangles = [];
  const brush = { fillRect(x, y, width, height) { rectangles.push({ x, y, width, height, color: this.fillStyle }); } };
  const { drawOverviewRange: draw, drawOverviewSections } = runInNewContext(`${source}; ({ drawOverviewRange, drawOverviewSections })`, {
    state, measureStart, measureEnd, measureSelected: index => selected.has(index)
  });
  draw(brush, time => (time + 1) * 20, 40);
  assert.deepEqual(rectangles, [
    { x: 30, y: 0, width: 90, height: 40, color: '#2457d640' },
    { x: 30, y: 0, width: 2, height: 40, color: '#7b91bb' },
    { x: 118, y: 0, width: 2, height: 40, color: '#7b91bb' }
  ]);
  drawOverviewSections(brush, time => (time + 1) * 20, 40);
  assert.deepEqual(rectangles.slice(3), [
    { x: 40, y: 0, width: 40, height: 3, color: '#d9a032' },
    { x: 30, y: 37, width: 50, height: 3, color: '#9270b5' }
  ]);
  assert.match(script, /drawOverviewRange\(overviewContext\.brush, overviewX, overviewContext\.height\);\s*drawOverviewSections\(overviewContext\.brush, overviewX, overviewContext\.height\);/);
  rectangles.length = 0;
  draw(brush, time => (time + 1) / 10, 40);
  assert.ok(rectangles.every(rect => rect.x >= .15 - 1e-10 && rect.x + rect.width <= .6 + 1e-10));
  selected.clear(); rectangles.length = 0;
  draw(brush, time => time, 40);
  assert.deepEqual(rectangles, []);
});

test('overview hover reports music time and one-based measures including delays without modifying studio state', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('function overviewTime('), script.indexOf('function overviewClick('));
  const state = {
    chart: { bars: [{ start: 0, end: 2, delay: 1 }, { start: 2, end: 8 }, { start: 8, end: 12 }] },
    position: 4, playing: true, selected: 1, selectedCell: { bar: 0 }, customLoop: [1, 2]
  };
  const before = JSON.stringify(state), overviewHover = { value: null };
  const overview = { value: { getBoundingClientRect: () => ({ left: 10, right: 210, top: 10, bottom: 50, width: 200 }) } };
  const hoverOverview = runInNewContext(`${source}; hoverOverview`, {
    state, overview, overviewHover, timelineBounds: { value: { start: -2, end: 18 } }, measureStart, measureEnd
  });
  const event = extra => ({ clientX: 40, clientY: 30, pointerType: 'mouse', ...extra });
  for (const [time, measure] of [[-1.5, null], [-.5, 1], [0, 1], [2, 2], [7.5, 2], [8, 3], [12, null], [17, null]]) {
    hoverOverview(event({ clientX: 10 + (time + 2) * 10 }));
    assert.ok(Math.abs(overviewHover.value.time - time) < 1e-8);
    assert.equal(overviewHover.value.measure, measure);
    const { x, y, fraction } = overviewHover.value;
    assert.ok(Math.abs(x - (time + 2) * 10) < 1e-8);
    assert.equal(y, 20);
    for (const tooltipWidth of [60, 150, 200]) {
      const left = x - fraction * tooltipWidth;
      assert.ok(left >= -1e-8 && left + tooltipWidth <= 200 + 1e-8);
    }
  }
  hoverOverview(event({ clientX: 110, clientY: 45 }));
  assert.equal(overviewHover.value.x, 100); assert.equal(overviewHover.value.y, 35);
  for (const extra of [{ clientX: 9 }, { clientX: 211 }, { clientY: 9 }, { clientY: 51 }, { pointerType: 'touch' }]) {
    hoverOverview(event()); assert.notEqual(overviewHover.value, null);
    hoverOverview(event(extra)); assert.equal(overviewHover.value, null);
  }
  assert.equal(JSON.stringify(state), before);
  state.chart = null; hoverOverview(event()); assert.equal(overviewHover.value, null);
  overview.value = null; assert.doesNotThrow(() => hoverOverview(event()));
  const template = descriptor.template.content;
  assert.match(template, /v-if="overviewHover" id="overview-hover"/);
  assert.match(template, /role="tooltip" :style="\{ left: `\$\{overviewHover.x\}px`, top: `\$\{overviewHover.y\}px`, transform: `translate\(\$\{-overviewHover.fraction \* 100\}%, calc\(-100% - 12px\)\)` \}"/);
  assert.match(template, /formatTime\(overviewHover.time\)/);
  assert.match(template, /t\('小节 \{p0\}', \{ p0: overviewHover.measure \?\? '—' \}\)/);
  assert.match(template, /@pointerenter="hoverOverview" @pointerleave="overviewHover = null"/);
});

test('overview dragging pans continuously without seeking or changing selections, while a tap still navigates', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'overview-drag' });
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('let overviewDrag ='), script.indexOf('let suppressMeasureClick ='));
  const calls = [], captured = new Set();
  const state = { chart: { bars: [{ start: 0, end: 50 }, { start: 50, end: 100 }] }, invalid: false };
  const overview = { value: {
    getBoundingClientRect: () => ({ left: 10, width: 100 }),
    setPointerCapture: id => captured.add(id),
    hasPointerCapture: id => captured.has(id),
    releasePointerCapture: id => captured.delete(id)
  } };
  const handlers = runInNewContext(`${source}; ({ startOverviewDrag, moveOverviewDrag, finishOverviewDrag, cancelOverviewDrag })`, {
    state, overview, timelineBounds: { value: { start: 0, end: 100 } },
    visible: { value: { start: 20, end: 40 } }, viewBeats: { value: 20 },
    timelineScale: { value: { beatAt: time => time * 2, timeAt: beat => beat / 2 } },
    measureStart: item => item.start, measureEnd: item => item.end,
    studio: {
      panTimeline: time => calls.push(['pan', time]),
      select: index => calls.push(['select', index]),
      seek: time => calls.push(['seek', time])
    }
  });
  const event = extra => ({ pointerId: 1, isPrimary: true, button: 0, clientX: 40, preventDefault() {}, ...extra });
  handlers.startOverviewDrag(event());
  assert.ok(captured.has(1)); assert.deepEqual(calls, []);
  handlers.moveOverviewDrag(event({ clientX: 42 }));
  handlers.moveOverviewDrag(event({ clientX: 45, pointerId: 2 }));
  assert.deepEqual(calls, []);
  handlers.moveOverviewDrag(event({ clientX: 45 }));
  handlers.moveOverviewDrag(event({ clientX: 46.25 }));
  handlers.finishOverviewDrag(event({ clientX: 47 }));
  assert.deepEqual(calls, [['pan', 25], ['pan', 26.25], ['pan', 27]]);
  assert.equal(captured.size, 0);

  calls.length = 0;
  handlers.startOverviewDrag(event({ clientX: 90 }));
  handlers.moveOverviewDrag(event({ clientX: 95 }));
  handlers.moveOverviewDrag(event({ clientX: 200 }));
  handlers.moveOverviewDrag(event({ clientX: -100 }));
  assert.deepEqual(calls, [['pan', 80], ['pan', 95], ['pan', -5]]);
  handlers.cancelOverviewDrag(event());
  handlers.finishOverviewDrag(event());
  assert.equal(calls.length, 3); assert.equal(captured.size, 0);

  calls.length = 0;
  handlers.startOverviewDrag(event({ clientX: 80 }));
  handlers.finishOverviewDrag(event({ clientX: 81 }));
  assert.deepEqual(calls, [['select', 1], ['seek', 71]]);
  calls.length = 0;
  handlers.startOverviewDrag(event({ button: 2 }));
  handlers.startOverviewDrag(event({ isPrimary: false }));
  state.invalid = true; handlers.startOverviewDrag(event()); state.invalid = false;
  state.chart = null; handlers.startOverviewDrag(event());
  handlers.finishOverviewDrag(event());
  assert.deepEqual(calls, []); assert.equal(captured.size, 0);
  const canvas = descriptor.template.content.match(/<canvas id="overview"[^>]*>/)[0];
  for (const [eventName, handler] of [
    ['pointerdown', 'startOverviewDrag'], ['pointermove', 'hoverOverview($event); moveOverviewDrag($event)'], ['pointerup', 'finishOverviewDrag'],
    ['pointercancel', 'cancelOverviewDrag($event); overviewHover = null'], ['lostpointercapture', 'cancelOverviewDrag']
  ]) assert.ok(canvas.includes(`@${eventName}="${handler}"`));
  assert.doesNotMatch(canvas, /@click=/);
  assert.match(descriptor.template.content, /^\s*<div class="workspace">\s*<section class="editor">/);
  assert.match(descriptor.template.content, /<\/canvas><\/div><\/div><\/div>\s*<section class="overview">[\s\S]*?<\/section>\s*<div class="editor-information">\s*<section class="cell-inspector"/);
  const styles = readFileSync(new URL('sound.css', import.meta.url), 'utf8');
  assert.match(styles, /\.timeline-wrap\{[^}]*overflow-x:auto;[^}]*scrollbar-width:none/);
  assert.match(styles, /\.timeline-wrap::-webkit-scrollbar\{display:none\}/);
  assert.match(descriptor.template.content, /class="timeline-wrap"[^>]*tabindex="0"[^>]*@scroll="scrollTimeline"[^>]*@wheel="wheelTimeline"[^>]*@keydown="keydownTimeline"/);
  const { descriptor: app } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const appStyles = app.styles[0].content;
  assert.match(appStyles, /\.overview\{[^}]*position:relative;[^}]*padding:0;/);
  assert.match(appStyles, /\.overview-wave>#overview-hover\{[^}]*position:absolute;[^}]*pointer-events:none/);
  assert.doesNotMatch(appStyles, /\.overview>#overview-range/);
  assert.match(appStyles, /\.overview canvas\{[^}]*margin-top:0;[^}]*border-radius:0/);
  const overviewTemplate = descriptor.template.content.match(/<section class="overview">[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(overviewTemplate, /全曲总览|section-label/);
  assert.match(overviewTemplate, /<span id="overview-range">/);
  assert.match(overviewTemplate, /<div class="overview-caption"><span class="overview-legend">[\s\S]*?<\/span><span id="overview-range">[\s\S]*?<\/span><\/div>\s*<div class="overview-wave">[\s\S]*?id="overview-hover"[\s\S]*?<canvas id="overview"/);
  assert.match(descriptor.styles[0].content, /\.overview-caption\{[^}]*display:flex;[^}]*justify-content:space-between;[^}]*flex-wrap:wrap;/);
  assert.match(descriptor.styles[0].content, /\.overview-wave\{position:relative\}/);
  assert.doesNotMatch(descriptor.styles[0].content, /\.overview-(?:caption|legend)\{[^}]*position:absolute/);
  assert.match(canvas, /:aria-label="t\('全曲波形，点击跳转，拖动浏览'\)"/);
});

test('the new-document tab follows the last file inside the left-aligned scrolling tab content', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'new-document-tab' });
  const tabs = descriptor.template.content.match(/<nav class="chart-tabs"[\s\S]*?<\/nav>/)[0];
  assert.match(tabs, /class="chart-tabs-content">[\s\S]*class="chart-tab"[\s\S]*<\/div>\s*<button id="new-chart-tab"/);
  assert.match(tabs, /id="new-chart-tab"[^>]*:aria-label="t\('新建谱面'\)"[^>]*@click="studio.newChart"/);
  assert.match(tabs, /<Plus aria-hidden="true" \/><\/button>\s*<\/div>\s*<\/div>\s*<div v-if="tabsScrollMax/);
  assert.doesNotMatch(tabs, /empty-session|尚未打开谱面/);
  assert.doesNotMatch(tabs, /chart-tabs-scroll-region/);
  assert.match(descriptor.styles[0].content, /\.chart-tabs \.new-chart-tab\{[^}]*flex-shrink:0/);
  assert.match(descriptor.styles[0].content, /\.chart-tabs-content\{[^}]*min-height:43px/);
  assert.match(descriptor.template.content, /<section v-if="studio.bar.value" class="document-toolbar">/);
  assert.match(descriptor.template.content, /<div v-if="state.notice && \(studio.bar.value \|\| state.error\)" id="notice"/);
});

test('the header file menu groups file actions and shortcuts without occupying the tab row', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'action-scopes' });
  const template = descriptor.template.content, header = template.match(/<header>[\s\S]*?<\/header>/)[0];
  for (const id of ['file-toggle', 'language-toggle', 'project-toggle']) assert.ok(header.includes(`id="${id}"`), id);
  const actions = header.match(/<details ref="fileMenu"[\s\S]*?<\/details>/)[0];
  for (const id of ['new-chart', 'open-chart', 'save', 'save-as']) {
    assert.ok(actions.includes(`id="${id}"`), id);
    assert.equal([...template.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
  }
  assert.equal([...actions.matchAll(/:disabled="!state.chart \|\| state.saving"/g)].length, 3);
  for (const action of ['studio.newChart', 'chooseCharts', 'studio.saveChart', 'studio.saveAs']) assert.ok(actions.includes(`@click="runFileAction(${action})"`), action);
  assert.match(descriptor.scriptSetup.content, /function runFileAction\(action\) \{\s*closePopover\(fileMenu.value\);\s*return action\(\);/);
  assert.match(actions, /t\('保存（Ctrl\+S）'\)/);
  assert.match(actions, /t\('另存为（Ctrl\+Shift\+S）'\)/);
  assert.match(actions, /<kbd aria-hidden="true">Ctrl\+S<\/kbd>/);
  assert.match(actions, /<kbd aria-hidden="true">Ctrl\+Shift\+S<\/kbd>/);
  assert.match(actions, /<kbd aria-hidden="true">Ctrl\+Alt\+N<\/kbd>/);
  assert.match(actions, /<kbd aria-hidden="true">Ctrl\+O<\/kbd>/);
  assert.match(actions, /aria-keyshortcuts="Control\+Alt\+n"/);
  assert.match(actions, /aria-keyshortcuts="Control\+o Meta\+o"/);
  assert.doesNotMatch(template, /document-actions|document-bar/);
  const tabs = template.match(/<nav class="chart-tabs"[\s\S]*?<\/nav>/)[0];
  assert.doesNotMatch(tabs, /id="save"|id="save-as"/);
  const styles = descriptor.styles[0].content;
  assert.match(styles, /\.chart-tabs\{[^}]*flex-shrink:0/);
  assert.match(styles, /\.file-actions \.file-panel button span\{display:inline;/);
  assert.match(styles, /\.file-panel\{position:fixed;/);
});

test('new and open shortcuts use existing actions from inputs, suppress repeat and protect native shortcuts and dialogs', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  assert.ok(script.includes("document.addEventListener('keydown', fileKeydown)"));
  assert.ok(script.includes("document.removeEventListener('keydown', fileKeydown)"));
  assert.match(script, /else chartFile.value.click\(\)/);
  const calls = [], document = { activeElement: { tagName: 'INPUT' } };
  const keydown = runInNewContext(`(${script.match(/function fileKeydown\(event\) \{[\s\S]*?\n\}/)[0]})`, {
    document, studio: { newChart: () => calls.push('new') }, chooseCharts: () => calls.push('open'), runFileAction: action => action()
  });
  let prevented = 0;
  const press = overrides => keydown({ key: 'o', ctrlKey: true, preventDefault() { prevented++; }, ...overrides });
  press({ key: 'n', altKey: true }); press({});
  press({ key: 'N', altKey: true }); press({ key: 'O', ctrlKey: false, metaKey: true });
  assert.deepEqual(calls, ['new', 'open', 'new', 'open']);
  press({ repeat: true }); press({ key: 'n', altKey: true, repeat: true });
  assert.equal(prevented, 6); assert.equal(calls.length, 4);
  for (const overrides of [
    { key: 'n' }, { altKey: true }, { ctrlKey: false },
    { shiftKey: true }, { isComposing: true }, { defaultPrevented: true },
    { key: 'n', altKey: true, metaKey: true },
    { key: 'n', altKey: true, getModifierState: key => key === 'AltGraph' },
    { key: 's' }, { key: 'w' }
  ]) press(overrides);
  document.activeElement = { closest: () => ({}) };
  press({}); press({ key: 'n', altKey: true });
  assert.equal(prevented, 6); assert.equal(calls.length, 4);
});

test('Alt activates menu keyboard navigation, skips disabled items and restores focus without consuming Alt combinations', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('const topMenus ='), script.indexOf('function dismissPopovers('));
  const document = { activeElement: null };
  function element(id) {
    return { id, tagName: 'BUTTON', isConnected: true, closest: () => null, getClientRects: () => [1], focus() { document.activeElement = this; }, blur() { document.activeElement = null; } };
  }
  function menu(id, disabled = false) {
    const entry = element(`${id}-item`), summary = { ...element(`${id}-toggle`), tagName: 'SUMMARY' };
    const panel = { ...element(`${id}-panel`), querySelectorAll: () => disabled ? [] : [entry] };
    summary.nextElementSibling = panel;
    const result = { open: false, summary, entry, panel, querySelector: () => summary, contains(target) { return [this, summary, entry, panel].includes(target); } };
    entry.closest = selector => selector === 'details' ? result : null;
    return result;
  }
  const menus = [menu('file'), menu('edit', true), menu('selection'), menu('settings')];
  const handlers = runInNewContext(`${source}; ({ altMenuKeydown, altMenuKeyup, popoverKeydown })`, {
    document, fileMenu: { value: menus[0] }, editMenu: { value: menus[1] }, selectionMenu: { value: menus[2] }, settingsMenu: { value: menus[3] },
    positionPopover() {}, closePopover(menu) { menu.open = false; menu.summary.focus(); }
  });
  const original = element('editor'); original.focus();
  const press = key => handlers.popoverKeydown({ key, target: document.activeElement, preventDefault() {}, stopPropagation() {} }, menus.find(menu => menu.contains(document.activeElement)));
  const alt = { key: 'Alt', preventDefault() {} };
  handlers.altMenuKeydown(alt); handlers.altMenuKeyup(alt);
  assert.equal(document.activeElement, menus[0].summary);
  press('ArrowDown'); assert.equal(document.activeElement, menus[0].entry); assert.equal(menus[0].open, true);
  press('ArrowRight'); assert.equal(document.activeElement, menus[1].panel);
  assert.equal(menus[0].open, false); assert.equal(menus[1].open, true);
  press('ArrowRight'); assert.equal(document.activeElement, menus[2].entry);
  press('Escape'); assert.equal(menus[2].open, false); assert.equal(document.activeElement, menus[2].summary);
  press('Escape'); assert.equal(document.activeElement, original);
  handlers.altMenuKeydown(alt); handlers.altMenuKeydown({ key: 'n', ctrlKey: true, altKey: true });
  handlers.altMenuKeyup(alt); assert.equal(document.activeElement, original);
  handlers.altMenuKeydown({ ...alt, isComposing: true }); handlers.altMenuKeyup(alt);
  assert.equal(document.activeElement, original);
  const settings = menus[3], child = menu('language'), last = element('about');
  child.summary.parentElement = { parentElement: { closest: () => settings } };
  last.closest = selector => selector === 'details' ? settings : null;
  settings.panel.querySelectorAll = () => [settings.entry, child.summary, last];
  const contains = settings.contains;
  settings.contains = target => contains.call(settings, target) || child.contains(target) || target === last;
  settings.open = true; child.summary.focus();
  const childKey = key => handlers.popoverKeydown({ key, target: document.activeElement, preventDefault() {}, stopPropagation() {} }, child);
  childKey('ArrowDown'); assert.equal(document.activeElement, last); assert.equal(child.open, false);
  child.summary.focus(); childKey('ArrowUp'); assert.equal(document.activeElement, settings.entry); assert.equal(child.open, false);
  child.summary.focus(); childKey('ArrowRight'); assert.equal(document.activeElement, child.entry); assert.equal(child.open, true);
  childKey('ArrowLeft'); assert.equal(document.activeElement, child.summary); assert.equal(child.open, false);
});

test('folder authorization and automatic matching have no UI or runtime entry points', () => {
  const app = readFileSync(new URL('App.vue', import.meta.url), 'utf8');
  const studio = readFileSync(new URL('useStudio.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /media-directory|media-folder|mediaFolder|mediaDirectory|webkitdirectory|showDirectoryPicker/);
  assert.doesNotMatch(studio, /autoAudio|chooseMediaDirectory|setMediaFiles|media-files|sourceHandle|chartPath/);
});

test('language options are grouped beneath the single settings toolbar trigger', () => {
  const source = readFileSync(new URL('App.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const { bindings } = compileScript(descriptor, { id: 'i18n-test' });
  assert.ok(bindings.changeLanguage);
  assert.ok(bindings.localePreference);
  assert.ok(bindings.popoverKeydown);
  assert.ok(bindings.dismissPopovers);
  const header = descriptor.template.content.match(/<header>[\s\S]*?<\/header>/)[0];
  assert.match(header, /id="language-toggle"/);
  assert.match(header, /@click="changeLanguage\(language.code\)"/);
  assert.match(header, /:aria-pressed="localePreference === language.code"/);
  assert.match(header, /<details ref="settingsMenu"[\s\S]*id="settings-toggle"[\s\S]*<details ref="languageMenu"/);
  assert.doesNotMatch(header.match(/<div class="brand">[\s\S]*?<\/div>/)[0], /<strong>|<small>/);
});

test('the project popover shows only draft failures and retains project links and copyright', () => {
  const source = readFileSync(new URL('App.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const header = descriptor.template.content.match(/<header>[\s\S]*?<\/header>/)[0];
  const project = header.match(/<details ref="projectMenu"[\s\S]*?<\/details>/)[0];
  assert.doesNotMatch(descriptor.template.content, /<footer\b/);
  assert.match(project, /id="project-toggle"/);
  assert.match(project, /v-if="draftUnavailable" id="save-state" role="alert"/);
  assert.match(header, /id="settings-toggle"[\s\S]*v-if="draftUnavailable" class="status-dot session-dot error"/);
  assert.doesNotMatch(project, /id="check-update"|id="update-notice"/);
  assert.match(header, /id="settings-panel"[^>]*>\s*<button id="check-update"/);
  assert.match(descriptor.template.content, /id="update-notice"[\s\S]*aria-live="polite"/);
  assert.doesNotMatch(project, /t\('本地会话'\)/);
  assert.match(project, /t\(state.saveState\)/);
  assert.match(project, /© 2026 Dafrok/);
  const links = [...project.matchAll(/<a\b([^>]*)>/g)].map(match => match[1]);
  assert.equal(links.length, 3);
  for (const [index, url] of ['https://github.com/OurTaiko/web-tja-studio', 'https://github.com/OurTaiko', 'https://github.com/OurTaiko/web-tja-studio/blob/HEAD/LICENSE'].entries()) {
    assert.ok(links[index].includes(`href="${url}"`));
    assert.match(links[index], /target="_blank"/);
    assert.match(links[index], /rel="noopener noreferrer"/);
  }
  assert.match(readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'), /^MIT License/);
  assert.match(project, /MIT 开源协议/);
});

test('header popovers dismiss on outside pointerdown and completed focus changes, never during focusout', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  for (const event of ['pointerdown', 'focusin']) {
    assert.ok(script.includes(`document.addEventListener('${event}', dismissPopovers)`));
    assert.ok(script.includes(`document.removeEventListener('${event}', dismissPopovers)`));
  }
  assert.match(script, /menu\?\.open && !menu.contains\(event.target\)/);
  assert.doesNotMatch(script, /event.type === 'focusout'/);
  assert.doesNotMatch(descriptor.template.content, /@focusout="dismissPopovers"/);
  assert.match(script, /\[fileMenu.value, editMenu.value, selectionMenu.value, settingsMenu.value, languageMenu.value, shortcutMenu.value, projectMenu.value\]/);
  assert.equal([...descriptor.template.content.matchAll(/@keydown="popoverKeydown\(\$event, (?:fileMenu|editMenu|selectionMenu|settingsMenu|languageMenu|shortcutMenu|projectMenu)\)"/g)].length, 7);
});

test('scrolling or focusing the shared settings panel retains expanded help, while sibling opening and outside clicks dismiss it', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const refs = Object.fromEntries(['fileMenu', 'editMenu', 'selectionMenu', 'settingsMenu', 'languageMenu', 'shortcutMenu', 'projectMenu'].map(name => [name, {
    value: { open: false, contains: target => target === name || name === 'settingsMenu' && ['panel', 'scrollbar', 'languageMenu', 'shortcutMenu', 'projectMenu'].includes(target) }
  }]));
  const script = descriptor.scriptSetup.content;
  const { dismiss, toggle } = runInNewContext(`({
    dismiss: ${script.match(/function dismissPopovers\(event\) \{[\s\S]*?\n\}/)[0]},
    toggle: ${script.match(/function toggleSettingsSection\(event\) \{[\s\S]*?\n\}/)[0]}
  })`, refs);
  refs.settingsMenu.value.open = true; refs.shortcutMenu.value.open = true;
  for (const target of ['scrollbar', 'panel', 'shortcutMenu']) {
    dismiss({ target }); assert.equal(refs.settingsMenu.value.open, true); assert.equal(refs.shortcutMenu.value.open, true);
  }
  refs.languageMenu.value.open = true; toggle({ target: refs.languageMenu.value });
  assert.equal(refs.shortcutMenu.value.open, false);
  dismiss({ target: 'outside' });
  assert.equal(refs.settingsMenu.value.open, false); assert.equal(refs.languageMenu.value.open, false);
  assert.match(descriptor.template.content, /id="settings-panel"[^>]*tabindex="0"/);
});

test('startup update checks announce a new release without installing it; unchanged passive checks stay quiet and errors remain explicit', async () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const refs = Object.fromEntries(['checkingUpdate', 'installingUpdate', 'updateError', 'updateVisible', 'pendingUpdate', 'updateNotice'].map(name => [name, { value: null }]));
  let worker = { state: 'installed' }, failure = null, installed = 0;
  const source = script.match(/async function checkUpdate\(passive = false\) \{[\s\S]*?\n\}/)[0]
    .replaceAll('import.meta.env.DEV', 'false').replaceAll('import.meta.env.BASE_URL', "'./'");
  const checkUpdate = runInNewContext(`(${source})`, {
    ...refs, appDisposed: false, navigator: { serviceWorker: {} }, location: { href: 'https://example.com/web-tja-studio/' }, URL, message, LocalizedError,
    waitForPwaRegistration: async (_container, scope) => { assert.equal(scope, 'https://example.com/web-tja-studio/'); return {}; },
    checkPwaUpdate: async () => { if (failure) throw failure; return worker; },
    installUpdate: async () => { installed++; }
  });
  await checkUpdate(true);
  assert.equal(refs.pendingUpdate.value, worker); assert.equal(refs.updateVisible.value, true); assert.equal(installed, 0);
  refs.updateVisible.value = false; await checkUpdate(false); assert.equal(installed, 1);
  refs.pendingUpdate.value = null; refs.updateVisible.value = false; worker = null;
  await checkUpdate(true); assert.equal(refs.updateVisible.value, false);
  await checkUpdate(false); assert.equal(refs.updateNotice.value.key, '已经是最新版本。');
  failure = new Error('Offline'); await checkUpdate(true);
  assert.equal(refs.updateVisible.value, true); assert.equal(refs.updateError.value, true);
  assert.equal(refs.updateNotice.value.key, '检测或安装更新失败：{p0}');
  assert.match(script, /if \(!import.meta.env.DEV && 'serviceWorker' in navigator\) void checkUpdate\(true\)/);
});

test('shortcut help is accessible without a chart and documents implemented bindings and scope', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'shortcut-help' });
  const help = descriptor.template.content.match(/<details ref="shortcutMenu"[\s\S]*?<\/details>/)[0];
  assert.match(help, /id="shortcuts-toggle"[\s\S]*aria-controls="shortcuts-panel"/);
  assert.match(help, /id="shortcuts-panel"[\s\S]*role="region"[\s\S]*tabindex="0"/);
  assert.match(help, /v-for="group in shortcutGroups"/);
  assert.doesNotMatch(help, /v-if="state.chart"/);
  for (const keys of ['Ctrl+Alt+N', 'Ctrl+O', 'Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+Alt+W', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Space', '1–9', '- / =', '0 / Delete / Backspace', 'A / D', 'W / S', 'Q / E', 'F', 'Shift+F', '← / →', 'Esc', 'PageUp / PageDown', 'Home / End']) assert.ok(descriptor.scriptSetup.content.includes(`'${keys}'`), keys);
  assert.doesNotMatch(descriptor.scriptSetup.content, /'A \/ B'/);
  const { descriptor: measure } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  const palette = measure.template.content.match(/<div id="palette"[\s\S]*?<\/div>/)[0];
  assert.equal(palette.split('type.shortcut ?? type.value').length - 1, 3);
  assert.match(palette, /:data-value="type.value"/);
  assert.match(palette, /@click="studio.chooseNote\(type.value\)"/);
  assert.match(help, /音符操作需先选中位置/);
  assert.match(help, /macOS：文件/);
});

test('global navigation displays the pending F loop endpoint and documents cancellation', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'keyboard-loop-selection' });
  assert.match(descriptor.template.content, /<output v-if="state.loopAnchor !== null" id="measure-loop-anchor">/);
  assert.match(descriptor.template.content, /p0: state.loopAnchor \+ 1/);
  assert.match(descriptor.template.content, /'loop-anchor': item.index === state.loopAnchor/);
  assert.doesNotMatch(descriptor.template.content, /measure-loop-range|measure-loop-hint|循环范围：第|单击跳转，拖动或按两次 F/);
  assert.match(descriptor.styles[0].content, /#measures button.loop-anchor\{outline:2px dashed var\(--green\)/);
});

test('all snap grids draw dashed subdivisions and solid meter beats without duplicate guides', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('    const guideDivisions ='), script.indexOf("    brush.fillStyle = '#68776e'"));
  for (const [snap, numerator] of [[4, 4], [12, 4], [24, 4], [7, 4], [12, 3], [14, 7], [16, 4], [16, 3]]) {
    const strokes = [];
    const brush = {
      strokeStyle: '', dash: [], setLineDash(dash) { this.dash = [...dash]; }, beginPath() {}, lineTo() {},
      moveTo(x) { this.x = x; },
      stroke() { strokes.push({ x: this.x, color: this.strokeStyle, dash: this.dash }); }
    };
    runInNewContext(source, {
      controls: { snap }, GRID_DIVISIONS: 16,
      item: { numerator, barline: true, branchStart: false },
      brush, barTimeAt: (_, fraction) => fraction, x: fraction => fraction * 3360, height: 278
    });
    const expected = new Set([
      ...Array.from({ length: snap }, (_, step) => Math.round(step / snap * 3360) + .5),
      ...Array.from({ length: numerator }, (_, step) => Math.round(step / numerator * 3360) + .5)
    ]);
    assert.deepEqual(new Set(strokes.map(line => line.x)), expected);
    assert.equal(strokes.length, expected.size);
    assert.ok(strokes.every(line => line.color !== '#e3e9e1'));
    assert.equal(strokes.filter(line => line.color !== '#b7cbd0').length, numerator);
    for (const line of strokes) assert.deepEqual(line.dash, line.color === '#b7cbd0' ? [2, 3] : []);
  }
});

test('audio loading is the rightmost control in the active chart transport', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const template = descriptor.template.content;
  assert.doesNotMatch(template.match(/<header>[\s\S]*?<\/header>/)[0], /id="open-audio"/);
  const transport = template.match(/<section[^>]*class="transport">[\s\S]*?<\/section>/)[0];
  const button = transport.match(/<button id="open-audio"[\s\S]*?<\/button>/)[0];
  assert.match(button, /class="primary"/);
  assert.match(button, /:disabled="!state.chart"/);
  assert.match(button, /@click="audioFile.click\(\)"/);
  assert.match(button, /:aria-label="t\('载入音频'\)"/);
  assert.equal([...template.matchAll(/id="open-audio"/g)].length, 1);
  assert.match(transport, /<\/details>\s*<button id="open-audio"[\s\S]*?<\/button>\s*<\/div><\/section>/);
  assert.match(descriptor.styles[0].content, /@container\(max-width:640px\)\{\.transport\{grid-template-columns:minmax\(0,1fr\)\}/);
});

test('dropping TJA files anywhere opens them sequentially, preserves native text drags and reports unsupported files or modal guards', async () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'chart-drop' });
  const source = descriptor.scriptSetup.content.slice(descriptor.scriptSetup.content.indexOf('function dragOverFiles('));
  const state = { error: false, fileErrors: [] }, opened = [], notices = [];
  let modal = false, prevented = 0;
  const handlers = runInNewContext(`${source}; ({ dragOverFiles, dropFiles })`, {
    state, document: { querySelector: () => modal },
    message: (key, values) => ({ key, values }),
    studio: { openChart: async file => { await Promise.resolve(); opened.push(file); }, notice: (message, error) => notices.push({ ...message, error }), reportFileError: message => { state.fileErrors.push(message); notices.push({ ...message, error: true }); } }
  });

  test('audio drops use the active chart, load charts first, reject multiple audio files and preserve load errors', async () => {
    const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
    const source = descriptor.scriptSetup.content.slice(descriptor.scriptSetup.content.indexOf('function dragOverFiles('));
    const state = { error: false, fileErrors: [] }, opened = [], notices = [];
    const { dropFiles } = runInNewContext(`${source}; ({ dropFiles })`, {
      state, document: { querySelector: () => null }, message,
      studio: {
        openChart: async file => { opened.push(`chart:${file.name}`); },
        openAudio: async file => { opened.push(`audio:${file.name}`); },
        notice: (value, error) => notices.push({ ...value, error }),
        reportFileError: value => { state.fileErrors.push(value); notices.push({ ...value, error: true }); }
      }
    });
    const drop = files => dropFiles({ dataTransfer: { types: ['Files'], files }, preventDefault() {} });
    await drop([{ name: 'music.M4A' }, { name: 'song.tja' }]);
    assert.deepEqual(opened, ['chart:song.tja', 'audio:music.M4A']);
    await drop([{ name: 'unknown-extension', type: 'audio/ogg' }]);
    assert.equal(opened.at(-1), 'audio:unknown-extension');
    await drop([{ name: 'first.mp3' }, { name: 'second.wav' }]);
    assert.equal(opened.length, 3);
    assert.equal(notices.at(-1).key, '一次只能拖入一个音频文件，未载入音频。');
    state.error = true; const count = notices.length;
    await drop([{ name: 'song.wav' }, { name: 'image.png' }]);
    assert.equal(notices.length, count);
  });

  test('the edit menu reuses guarded editing actions and labels only implemented shortcuts', () => {
    const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
    compileScript(descriptor, { id: 'edit-menu' });
    const menu = descriptor.template.content.match(/<details ref="editMenu"[\s\S]*?<\/details>/)[0];
    assert.match(menu, /:disabled="!state.undo.length"[\s\S]*studio.history\(\)/);
    assert.match(menu, /:disabled="!state.redo.length"[\s\S]*studio.history\(true\)/);
    assert.match(menu, /:disabled="!studio.cell.value \|\| state.invalid"[\s\S]*studio.chooseNote\(type.value\)/);
    assert.doesNotMatch(menu, /studio.markLoop|studio.clearLoop/);
    assert.match(menu, /Ctrl\+Z/); assert.match(menu, /Ctrl\+Shift\+Z/);
    const actions = descriptor.scriptSetup.content.match(/const measureActions = computed\(\(\) => \[[\s\S]*?\n\]\);/)[0];
    for (const [label, icon] of [['前插小节', 'BetweenHorizontalStart'], ['后插小节', 'BetweenHorizontalEnd'], ['删除小节', 'Trash2'], ['清空本小节', 'Eraser']]) {
      assert.ok(actions.includes(`label: '${label}', icon: ${icon},`));
    }
    assert.match(menu, /@click="runEditAction\(item.action\)"><component :is="item.icon" aria-hidden="true" \/>/);
  });

  test('the central title identifies difficulty before the song and mode after it, without a duplicate inspector header', () => {
    const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
    compileScript(descriptor, { id: 'document-context' });
    const context = descriptor.template.content.match(/<div class="document-title">[\s\S]*?<\/div>/)[0];
    assert.match(context, /courseLabel\(state.chart.variant.course\)/);
    assert.match(context, /<DifficultyIcon :course="state.chart.variant.course" \/>[\s\S]*<h1 id="song-title"/);
    assert.match(context, /<\/h1><span id="document-mode"[\s\S]*variantLabel\(state.chart.variant\)/);
    assert.doesNotMatch(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'), /measure-context|DifficultyIcon|courseLabel|variantLabel/);
  });
  const native = { dataTransfer: { types: ['text/plain'] }, preventDefault() { assert.fail('Text drags must stay native'); } };
  handlers.dragOverFiles(native); await handlers.dropFiles(native);
  const event = files => ({ dataTransfer: { types: ['Files'], files, dropEffect: 'none' }, preventDefault() { prevented++; } });
  const first = { name: 'first.tja' }, second = { name: 'SECOND.TJA' };
  const drop = event([first, { name: 'image.png' }, second]);
  handlers.dragOverFiles(drop); assert.equal(drop.dataTransfer.dropEffect, 'copy');
  await handlers.dropFiles(drop);
  assert.deepEqual(opened, [first, second]); assert.equal(prevented, 2);
  assert.equal(notices.at(-1).values.p0, 'image.png'); assert.equal(notices.at(-1).error, true);
  await handlers.dropFiles(event([{ name: 'image.png' }]));
  assert.equal(opened.length, 2); assert.equal(notices.at(-1).key, '请拖入 .tja 谱面或音频文件。');
  modal = true; await handlers.dropFiles(event([first]));
  assert.equal(opened.length, 2); assert.match(notices.at(-1).key, /当前对话框/);
  modal = false; state.error = true; const count = notices.length;
  await handlers.dropFiles(event([first, { name: 'other.txt' }]));
  assert.equal(notices.length, count);
  for (const event of ['dragover', 'drop']) {
    assert.ok(descriptor.scriptSetup.content.includes(`document.addEventListener('${event}'`));
    assert.ok(descriptor.scriptSetup.content.includes(`document.removeEventListener('${event}'`));
  }
});

test('branch route controls use localized names while raw N/E/M identifiers remain stable and sidebar statistics are absent', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'branch-route-names' });
  assert.doesNotMatch(descriptor.template.content, /branch-route-/);
  assert.doesNotMatch(descriptor.template.content, /note-summary|id="(?:don-count|ka-count|other-count)"|音符统计/);
  const branches = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8')).descriptor;
  compileScript(branches, { id: 'route-display-names' });
  assert.match(branches.scriptSetup.content, /BRANCH_ROUTE_NAMES as names/);
  assert.match(branches.template.content, /\{\{ route \}\} · \{\{ t\(names\[route\]\) \}\}/);
  const chart = readFileSync(new URL('chart.js', import.meta.url), 'utf8');
  assert.match(chart, /BRANCH_ROUTES = \['N', 'E', 'M'\]/);
  assert.match(chart, /BRANCH_ROUTE_NAMES = \{ N: '普通', E: '玄人', M: '达人' \}/);
});

test('the selection menu owns measure and note operations; playback has no independent loop switch or range inputs', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'clear-loop-action' });
  const menu = descriptor.template.content.match(/<details ref="selectionMenu"[\s\S]*?<\/details>/)[0];
  assert.match(menu, /studio.setLoop\(state.selected \+ 1, state.selected \+ 1\)/);
  assert.match(menu, /studio.setLoop\(1, state.chart.bars.length\)/);
  assert.match(menu, /runSelectionAction\(studio.markLoop\)[\s\S]*<kbd aria-hidden="true">F/);
  assert.match(menu, /runSelectionAction\(studio.clearLoop\)[\s\S]*Shift\+F/);
  assert.match(menu, /studio.selectAdjacentNote\(-1\)/); assert.match(menu, /studio.selectAdjacentNote\(1\)/);
  assert.match(menu, /runSelectionAction\(studio.clearNoteSelection\)/);
  assert.doesNotMatch(descriptor.template.content, /id="loop"|id="loop-first"|id="loop-last"|controls.loop/);
  assert.match(descriptor.scriptSetup.content, /\['Shift\+F', '取消小节选择'\]/);
});

test('global navigation previews and commits pointer-drag loop ranges without consuming ordinary clicks', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'measure-loop-selection' });
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('let suppressMeasureClick = false;'), script.indexOf('\nwatch(() => [state.activeId'));
  const state = { chart: {}, invalid: false }, measureDrag = { value: null }, writes = [], captured = new Set();
  const buttons = Array.from({ length: 4 }, (_, index) => {
    const button = { dataset: { measureIndex: String(index) }, setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id) };
    button.closest = () => button;
    return button;
  });
  let hit = buttons[0];
  const handlers = runInNewContext(`${source}; ({ startMeasureLoop, moveMeasureLoop, cancelMeasureLoop, finishMeasureLoop, measureLoopKeydown, measureLoopClick })`, {
    state, measureDrag, measures: { value: { contains: button => buttons.includes(button) } },
    document: { elementFromPoint: () => hit }, studio: { setLoop: (...args) => writes.push(args) }
  });
  const event = overrides => ({ isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0, target: hit, ...overrides });
  const drag = (first, last, distance = 20) => {
    hit = buttons[first]; handlers.startMeasureLoop(event());
    hit = buttons[last]; handlers.moveMeasureLoop(event({ clientX: distance }));
  };
  handlers.startMeasureLoop(event({ isPrimary: false })); assert.equal(measureDrag.value, null);
  handlers.startMeasureLoop(event({ button: 2 })); assert.equal(measureDrag.value, null);
  state.invalid = true; handlers.startMeasureLoop(event()); assert.equal(measureDrag.value, null); state.invalid = false;
  drag(0, 3);
  assert.equal(measureDrag.value.end, 3); assert.equal(measureDrag.value.dragged, true); assert.equal(writes.length, 0);
  handlers.finishMeasureLoop(event({ clientX: 20 }));
  assert.deepEqual(writes.at(-1), [1, 4]); assert.equal(measureDrag.value, null); assert.equal(captured.size, 0);
  let prevented = 0, stopped = 0;
  const click = { detail: 1, preventDefault: () => prevented++, stopPropagation: () => stopped++ };
  handlers.measureLoopClick(click); assert.equal(prevented, 1); assert.equal(stopped, 1);
  handlers.measureLoopClick(click); assert.equal(prevented, 1);
  drag(3, 0); handlers.finishMeasureLoop(event({ clientX: 20 })); assert.deepEqual(writes.at(-1), [1, 4]);
  drag(2, 2, 6); handlers.finishMeasureLoop(event({ clientX: 6 })); assert.deepEqual(writes.at(-1), [3, 3]);
  const count = writes.length;
  drag(1, 1, 4); handlers.finishMeasureLoop(event({ clientX: 4 })); assert.equal(writes.length, count);
  handlers.measureLoopClick(click); assert.equal(prevented, 1);
  drag(1, 3);
  handlers.measureLoopKeydown({ key: 'Escape', preventDefault: () => prevented++, stopPropagation: () => stopped++ });
  assert.equal(measureDrag.value, null); assert.equal(writes.length, count); assert.equal(captured.size, 0);
  handlers.measureLoopClick({ ...click, detail: 0 }); assert.equal(prevented, 2);
  drag(2, 3);
  handlers.cancelMeasureLoop(event({ pointerId: 2 })); assert.notEqual(measureDrag.value, null);
  handlers.cancelMeasureLoop(event()); assert.equal(measureDrag.value, null); assert.equal(writes.length, count);
  drag(0, 2); hit = null;
  handlers.finishMeasureLoop(event({ clientX: 100 })); assert.deepEqual(writes.at(-1), [1, 3]);
  assert.match(script, /watch\(\(\) => \[state.activeId, state.chart, state.invalid\], \(\) => \{ cancelMeasureLoop\(\); cancelOverviewDrag\(\); overviewHover.value = null; \}, \{ flush: 'sync' \}\)/);
  assert.match(descriptor.template.content, /@pointercancel="cancelMeasureLoop" @lostpointercapture="cancelMeasureLoop"/);
  assert.match(descriptor.template.content, /@click.capture="measureLoopClick"/);
  assert.match(descriptor.template.content, /:data-measure-index="item.index"/);
  assert.match(descriptor.template.content, /@click="viewMeasure\(\$event, item.index\)"/);
});

test('Shift-click chooses an inclusive range from the viewed measure or pending F anchor without navigating', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const state = { selected: 2, loopAnchor: null }, ranges = [], views = [];
  const viewMeasure = runInNewContext(`(${descriptor.scriptSetup.content.match(/function viewMeasure\(event, index\) \{[\s\S]*?\n\}/)[0]})`, {
    state, studio: { select: index => views.push(index), setLoop: (...args) => ranges.push(args) }
  });
  viewMeasure({ shiftKey: false }, 1); assert.deepEqual(views, [1]); assert.equal(ranges.length, 0);
  viewMeasure({ shiftKey: true }, 0); assert.deepEqual(ranges.at(-1), [1, 3]); assert.deepEqual(views, [1]);
  state.loopAnchor = 1;
  viewMeasure({ shiftKey: true }, 3); assert.deepEqual(ranges.at(-1), [2, 4]);
  assert.match(descriptor.template.content, /:aria-pressed="measureSelected\(item.index\)"/);
  assert.match(descriptor.template.content, /:aria-current="item.index === state.selected \? 'location' : undefined"/);
  assert.match(descriptor.template.content, /'note-selected': item.index === state.selectedCell\?\.bar/);
});

test('the header keeps title and history while global navigation contains full-chart statistics', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'editor-header' });
  const template = descriptor.template.content;
  assert.match(template, /<div class="editor-core" :inert="state.editorBlocked">\s*<section v-if="studio.bar.value" class="document-toolbar">/);
  const toolbar = template.match(/<section v-if="studio.bar.value" class="document-toolbar">[\s\S]*?<\/section>/)[0];
  assert.match(toolbar, /<div class="document-title">[\s\S]*<h1 id="song-title"[\s\S]*?<\/h1><span id="document-mode"[\s\S]*<span v-if="state.encoding" id="encoding">[\s\S]*?<\/span><\/div>/);
  const timeline = readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8');
  const navigation = timeline.match(/<section class="measure-section">[\s\S]*?<\/section>/)[0];
  assert.match(navigation, /t\('全局导航'\)/);
  assert.doesNotMatch(timeline, /小节导航/);
  const heading = navigation.slice(0, navigation.indexOf('<div class="chart-statistics"'));
  assert.match(heading, /<SectionHeading :icon="Map" :title="t\('全局导航'\)"/);
  assert.match(heading, /t\('全局导航'\)[\s\S]*id="selection-summary"[\s\S]*t\('已选小节：\{p0\}–\{p1\}'/);
  assert.match(heading, /<output v-if="range" id="selection-summary">/);
  assert.doesNotMatch(heading, /音符所在小节|selected-note-label/);
  assert.match(timeline, /:aria-describedby="range \? 'selection-summary' : undefined"/);
  assert.match(heading, /<button v-if="range \|\| state.loopAnchor !== null"[^>]*@click="studio.clearLoop"[\s\S]*t\('取消选择'\)/);
  assert.doesNotMatch(heading, /id="total-notes"/);
  assert.match(navigation, /<div class="chart-statistics"[\s\S]*id="total-notes"[\s\S]*stats.all/);
  const ids = ['bar-count', 'total-notes', 'chart-don-count', 'chart-ka-count', 'chart-roll-seconds', 'chart-balloon-hits'];
  for (const id of ids) {
    assert.ok(navigation.includes(`id="${id}"`), id);
    assert.equal(timeline.split(`id="${id}"`).length - 1, 1);
    assert.ok(!toolbar.includes(`id="${id}"`), id);
  }
  for (const id of ['undo', 'redo']) assert.ok(!toolbar.includes(`id="${id}"`), id);
  const measure = readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8');
  for (const id of ids) assert.ok(!measure.includes(`id="${id}"`), `Duplicate measure ID: ${id}`);
  assert.match(navigation, /chartStats.rollSeconds.toFixed\(3\)/);
  assert.match(navigation, /t\('气球 \/ 特殊连打'\)/);
  assert.match(navigation, /balloonHits \?\? t\('未完整设置'\)/);
  assert.doesNotMatch(navigation, /chart-special-hits/);
  assert.match(timeline, /balloon === null \|\| special === null \? null : balloon \+ special/);
  assert.match(template, /<\/section>\s*<div class="editor-scroll">/);
  assert.doesNotMatch(template, /id="chart-name"|document-status|command-warning|未关联文件|撤销 \{p0\}\/50/);
  assert.doesNotMatch(template, /id="undo"|id="redo"|document-history/);
  for (const [id, action] of [['undo', 'studio.history()'], ['redo', 'studio.history(true)']]) {
    assert.equal(timeline.split(`id="${id}"`).length - 1, 1);
    const button = timeline.match(new RegExp(`<button id="${id}"[^>]*>`))[0];
    assert.ok(button.includes(`:disabled="!state.${id}.length"`));
    assert.ok(button.includes(`@click="${action}"`));
  }
});

test('note choices fill responsive equal-width columns with consistent height, rounded large rolls and cartoon balloons', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'note-palette' });
  const styles = readFileSync(new URL('sound.css', import.meta.url), 'utf8');
  assert.match(styles, /\.measure-editor \.palette\{[^}]*display:grid;grid-template-columns:repeat\(auto-fit,minmax\(60px,1fr\)\)/);
  assert.match(styles, /\.measure-editor \.palette button\{[^}]*width:100%;height:72px;min-width:0/);
  assert.match(styles, /\.measure-editor \.palette button\{[^}]*padding:16px 3px 3px/);
  assert.match(styles, /\.measure-editor \.palette small\{[^}]*font-size:12px;line-height:16px;font-weight:600;color:var\(--ink\)/);
  assert.doesNotMatch(styles, /\.measure-editor \.palette button\{[^}]*(?:width:60px|flex:0 0 60px)/);
  assert.match(styles, /\.choice-icon\{display:grid;place-items:center;width:34px;height:28px;flex-shrink:0/);
  assert.match(styles, /\.choice-name\{[^}]*height:22px;flex-shrink:0/);
  assert.match(styles, /\.choice-name\{[^}]*display:flex;align-items:center;justify-content:center;text-align:center/);
  assert.match(styles, /\.choice-name>span\{[^}]*-webkit-line-clamp:2/);
  assert.match(descriptor.template.content, /<span class="choice-name"><span>\{\{ t\(type.name\) \}\}<\/span><\/span>/);
  assert.match(descriptor.template.content, /<span class="choice-icon" aria-hidden="true"><span class="choice-symbol" :class="type.shape"><\/span><\/span><span class="choice-name">/);
  assert.doesNotMatch(descriptor.styles[0].content, /#palette\{grid-template-columns/);
  assert.match(styles, /\.choice-symbol\.roll\{[^}]*border-radius:999px/);
  assert.match(styles, /\.choice-symbol\.roll\.large\{width:34px;height:24px/);
  assert.match(styles, /\.choice-symbol\.balloon::before\{[^}]*border-bottom:2px solid/);
  assert.match(styles, /\.choice-symbol\.balloon\.special\{[^}]*border-radius:7px/);
  assert.match(descriptor.template.content, /:title="`\$\{t\(type.name\)\}/);
  assert.match(descriptor.template.content, /:aria-label="`\$\{t\(type.name\)\}/);
});

test('the note editor uses compact wrapping attributes and stable value slots', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const { bindings } = compileScript(descriptor, { id: 'stable-note-inspector' });
  assert.ok(bindings.cellAttributes);
  const template = descriptor.template.content;
  assert.match(template, /class="cell-inspector" :aria-label="t\('落点信息'\)"/);
  assert.doesNotMatch(template, /cell-heading|cell-current/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /cell-bar/);
  assert.match(descriptor.scriptSetup.content, /\.\.\.\(selected\?\.span \? \[\{ id: 'cell-long'/);
  assert.match(descriptor.scriptSetup.content, /id: 'cell-fraction', label: '位置'/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /cell-location|小节内位置|小节 \/ 格位/);
  assert.match(template, /v-for="attribute in cellAttributes"/);
  assert.match(template, /<dd :id="attribute.id" :title="attribute.value">/);
  assert.doesNotMatch(template, /balloon-count|balloon-control/);
  const styles = readFileSync(new URL('sound.css', import.meta.url), 'utf8');
  assert.match(styles, /\.cell-inspector dl\{display:flex;flex-wrap:wrap;/);
  assert.match(styles, /\.cell-inspector dl>div\{[^}]*max-width:100%;height:24px/);
  assert.match(styles, /\.cell-inspector dd\{[^}]*line-height:24px;[^}]*text-overflow:ellipsis;white-space:nowrap/);
  for (const id of ['cell-time', 'cell-fraction', 'cell-long']) assert.match(styles, new RegExp(`#${id}\\{width:\\d+ch\\}`));
  assert.doesNotMatch(readFileSync(new URL('SongWorkspace.vue', import.meta.url), 'utf8'), /离开输入框时自动应用/);
});

test('position attributes omit branch information while preserving timing details', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('const cellAttributes ='), script.indexOf('const timeline ='));
  const currentTiming = ref({ bpm: 120, scroll: 1, numerator: 4, denominator: 4 });
  const attributes = runInNewContext(`${source}; cellAttributes`, {
    computed, cell: ref(null), currentTiming, t
  });
  assert.ok(!attributes.value.some(attribute => attribute.id === 'cell-branch' || attribute.label === '分歧路线'));
  assert.equal(attributes.value.find(attribute => attribute.id === 'cell-bpm').value, '120');
  currentTiming.value.bpm = 180;
  assert.equal(attributes.value.find(attribute => attribute.id === 'cell-bpm').value, '180');
});

test('balloon and special roll counts are edited in the right note panel', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'balloon-inspector' });
  const section = descriptor.template.content.match(/<section[^>]*aria-labelledby="note-palette-title">[\s\S]*?<\/section>/)[0];
  assert.match(section, /id="balloon-count"/);
  assert.match(section, /v-if="cell && cell.ordinal >= 0" class="balloon-control command-field"/);
  assert.ok(section.includes('<label for="balloon-count">{{ t(\'气球 / 特殊连打（#{p0}）敲击次数\', { p0: cell.ordinal + 1 }) }}</label>'));
  assert.match(section, /:disabled="state.invalid"/);
  assert.match(section, /@change="studio.setBalloon\(Number\(\$event.target.value\)\)"/);
  assert.match(section, /@keydown.enter="!\$event.isComposing && \$event.keyCode !== 229 && \$event.target.blur\(\)"/);
  assert.doesNotMatch(section, /balloon-count-state|气球敲击次数|balloonStatus/);
});

test('current position timing lives in note attributes and measure selection lives in the header', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'live-measure-timing' });
  for (const field of ['bpm', 'scroll', 'numerator', 'denominator', 'gogo', 'delay']) assert.ok(descriptor.scriptSetup.content.includes(`timing.${field}`), field);
  for (const id of ['cell-bpm', 'cell-scroll', 'cell-meter']) assert.ok(descriptor.scriptSetup.content.includes(`id: '${id}'`), id);
  const nav = descriptor.template.content.match(/<div class="measure-nav">[\s\S]*?<\/div>/)[0];
  assert.match(nav, /<label for="bar-number">{{ t\('查看小节'\) }}<\/label>\s*<input id="bar-number" type="number" min="1" :max="state.chart\?\.bars.length" step="1"/);
  assert.doesNotMatch(descriptor.template.content, /id="bar-prev"|id="bar-next"|measure-stepper/);
  const styles = descriptor.styles[0].content;
  assert.match(styles, /\.measure-nav input\{[^}]*height:28px;min-height:28px;[^}]*background:#fff/);
  assert.match(styles, /\.editor \.editor-bar\{padding:4px 12px\}/);
  assert.match(styles, /\.lane-head\.editor-tools\{[^}]*padding:4px 12px/);
  assert.match(styles, /\.editor-tools input\[type=number\],\.editor-tools select\{background:#fff\}/);
  assert.match(styles, /\.editor-tools :is\(input\[type=number\],select,button\)\{box-sizing:border-box;height:28px;min-height:28px;/);
  assert.match(styles, /\.editor-tools :is\(input\[type=number\],select,button\)\{[^}]*padding-block:0;line-height:normal;/);
  assert.match(styles, /\.editor-tools label\{min-height:28px;line-height:normal;/);
  assert.match(styles, /\.lane-head\.editor-tools\{[^}]*font:400 11px\/normal system-ui,sans-serif;/);
  assert.match(styles, /\.editor-tools :is\(label,input,select,button,option\)\{font:inherit\}/);
  assert.match(styles, /\.measure-actions\{[^}]*border:0;/);
  const measure = readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8');
  for (const id of ['bar-number']) {
    assert.ok(nav.includes(`id="${id}"`), id);
    assert.ok(!measure.includes(`id="${id}"`), id);
    assert.equal(descriptor.template.content.split(`id="${id}"`).length - 1, 1);
  }
  assert.match(nav, /@change="studio.select\(Number\(\$event.target.value\) - 1\)/);
  assert.doesNotMatch(descriptor.template.content, /id="meter"|id="selection"/);
  assert.match(descriptor.template.content, /state.playing && currentTiming.bar.index !== state.selected/);
});

test('toolbar commands use scoped transparent surfaces with hover, pressed, focus and playback states', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'compact-toolbar-commands' });
  const styles = descriptor.styles[0].content;
  const rules = styles.slice(styles.indexOf(':is(.studio-panel,.transport-host) :is(.document-toolbar'));
  for (const surface of ['document-toolbar', 'editor-bar', 'transport', 'inspector-heading', 'aside-actions']) {
    assert.ok(rules.includes(`.${surface}`));
  }
  assert.match(rules, /border-color:transparent;background:transparent;color:var\(--ink\);box-shadow:none;border-radius:4px/);
  assert.match(rules, /button:not\(\.primary\),/);
  assert.match(rules, /button:not\(\.primary\):not\(:disabled\):hover/);
  assert.match(rules, /button:not\(\.primary\):not\(:disabled\):active/);
  assert.match(rules, /button:not\(\.primary\):focus-visible/);
  assert.match(rules, /outline:2px solid var\(--green\);outline-offset:-2px/);
  assert.doesNotMatch(rules, /\.play\.playing\{/);
  assert.match(descriptor.template.content, /id="play" class="play icon primary"/);
  assert.match(descriptor.template.content, /id="open-audio" class="primary"/);
  assert.match(rules, /\[open\]>summary\{background:#16745b18;color:var\(--green\)\}/);
  assert.doesNotMatch(rules, /\.file-panel|\.selection-dialog|\.palette|\.course-dialog/);
  assert.match(descriptor.template.content, /id="play"[^>]*:class="\{ playing: state.playing \}"/);
});

test('measure toolbars have a separate tinted surface and a bottom border above the timeline', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  assert.match(descriptor.styles[0].content, /\.editor-bar,\.lane-head\.editor-tools\{background:var\(--paper\)\}/);
  assert.match(descriptor.styles[0].content, /\.lane-head\.editor-tools\{[^}]*border-bottom:1px solid var\(--line\)/);
  const { descriptor: app } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  assert.match(app.styles[0].content, /\.document-toolbar\{[^}]*border-bottom:1px solid var\(--line\)/);
  assert.match(app.styles[0].content, /\.editor-core \.workspace\{[^}]*border-top:0\}/);
  const { descriptor: branch } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  assert.match(branch.styles[0].content, /\.branch-context\{[^}]*border-bottom:1px solid var\(--line\)/);
});

test('the sidebar uses peer sections rather than nesting all editing under a measure heading', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'inspector-hierarchy' });
  const aside = descriptor.template.ast.children.find(node => node.tag === 'aside');
  const sections = aside.children.filter(node => ['section', 'form'].includes(node.tag));
  const attribute = (node, name) => node.props.find(prop => prop.name === name)?.value?.content;
  const ids = ['note-palette-title', 'selected-position-title', 'measure-properties-title', 'command-editor-title', 'measure-command-list-title', 'measure-source-title'];
  assert.deepEqual(sections.map(node => attribute(node, 'aria-labelledby')), ids);
  for (const [index, section] of sections.entries()) {
    const header = section.children.find(node => node.tag === 'div' && attribute(node, 'class')?.includes('inspector-heading'));
    const heading = header.children.find(node => node.tag === 'h2');
    assert.equal(attribute(heading, 'id'), ids[index]);
  }
  assert.match(descriptor.template.content, /<aside class="measure-editor" :aria-label="t\('编辑面板'\)"/);
  assert.doesNotMatch(descriptor.template.content, /t\('小节编辑'\)/);
  const [palette, selection, properties, commands, list, source] = sections.map(node => node.loc.source);
  assert.ok(palette.includes('id="palette"'));
  assert.match(palette, /:disabled="!cell \|\| state.invalid"/);
  assert.match(palette, /:aria-pressed="cell\?\.note === type.value"/);
  assert.doesNotMatch(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'), /id="palette"/);
  for (const id of ['command-numerator', 'command-denominator', 'command-time']) {
    assert.ok(selection.includes(`id="${id}"`), id);
    assert.ok(!commands.includes(`id="${id}"`), id);
    assert.equal(descriptor.template.content.split(`id="${id}"`).length - 1, 1, id);
  }
  assert.ok(selection.includes('@focusin="state.playing && studio.pause()"'));
  assert.equal(selection.split('@change="movePosition"').length - 1, 2);
  assert.match(selection, /t\('当前选择的位置'\)/);
  assert.doesNotMatch(selection, /指令位置分子|指令位置分母/);
  for (const id of ['bar-badge', 'bar-time', 'division']) assert.ok(properties.includes(`id="${id}"`), id);
  for (const id of ['position-commands', 'measure-commands']) assert.ok(commands.includes(`id="${id}"`), id);
  assert.doesNotMatch(commands, /id="insert-branch-source"|id="command-player-structure"|id="bar-commands"|id="source"/);
  for (const id of ['branch-condition', 'branch-lower', 'branch-upper', 'branch-end']) assert.ok(!commands.includes(`id="${id}"`), id);
  assert.doesNotMatch(descriptor.template.content, /branch-structure-title|insert-branch-source/);
  assert.doesNotMatch(descriptor.template.content, /command-player-structure|插入双人谱结构/);
  assert.ok(list.includes('id="bar-commands"'));
  for (const section of [commands, list]) assert.ok(section.includes('@focusin="state.playing && studio.pause()"'));
  assert.match(source, /<h2 id="measure-source-title"><label for="source">/);
  assert.ok(source.includes('id="source-state"')); assert.ok(source.includes('id="source"'));
  assert.match(descriptor.styles[0].content, /\.inspector-heading h2\{[^}]*font-size:13px;font-weight:600/);
  assert.match(descriptor.styles[0].content, /\.command-group legend\{[^}]*font-size:11px;font-weight:500/);
});

test('command inputs share full-column sizing and height without resizing checkboxes or losing paired fields', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  const controls = descriptor.styles[0].content.match(/\.command-group input:not\(\[type=checkbox\]\),\.command-group select\{([^}]+)\}/)[1];
  for (const declaration of ['width:100%', 'min-width:0', 'max-width:none', 'height:32px', 'min-height:32px', 'padding:6px 8px', 'border:1px solid var(--line)', 'box-sizing:border-box']) assert.ok(controls.split(';').includes(declaration), declaration);
  assert.match(descriptor.styles[0].content, /\.command-group \.meter-inputs input\{width:0;flex:1 1 0\}/);
  assert.match(descriptor.template.content, /class="command-field command-wide" @change="apply\('lyric'/);
});

test('graphical branch selection supports reversed endpoints and rejects crossing occupied measures without touching loop selection', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.replace(/^import .*;\n/gm, '');
  const writes = [], loop = [2, 4], state = reactive({
    selected: 4, customLoop: loop, chart: { branches: [], bars: Array.from({ length: 6 }, (_, index) => ({ index, branchIndex: index === 3 ? 0 : null })) }
  });
  const manager = runInNewContext(`${source}; ({ create, chooseMeasure, submit, first, last, anchor, error, fields, mode })`, {
    ref, reactive, computed, inject: () => ({ state, bar: ref(null), applyMeasureBranch: (operation, measure) => { writes.push({ operation, measure }); return true; } }), t
  });
  manager.create(); manager.submit();
  assert.equal(writes.length, 0); assert.match(manager.error.value, /选择有效的小节/);
  manager.chooseMeasure(2); manager.chooseMeasure(0);
  assert.equal(manager.first.value, 0); assert.equal(manager.last.value, 2); assert.equal(manager.anchor.value, null);
  manager.chooseMeasure(1); manager.chooseMeasure(5);
  assert.match(manager.error.value, /分歧覆盖/); assert.equal(manager.last.value, 1);
  manager.chooseMeasure(2); manager.fields.route = 'E'; manager.fields.source = '';
  manager.submit();
  assert.equal(writes.length, 1); assert.equal(writes[0].measure, 1);
  assert.equal(writes[0].operation.last, 2); assert.equal(writes[0].operation.empty, true);
  assert.equal(writes[0].operation.route, 'E');
  assert.equal(manager.mode.value, '');
  assert.equal(state.selected, 4); assert.deepEqual([...state.customLoop], loop);
});

test('branch cards count each created route independently of the viewed route and shared measures', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.replace(/^import .*;\n/gm, '');
  const state = reactive({ chart: null });
  const manager = runInNewContext(`${source}; ({ routeNoteCount })`, {
    ref, reactive, computed, inject: () => ({ state, bar: ref(null) }), t
  });
  const text = 'TITLE:Route counts\nBPM:120\nCOURSE:Oni\n#START\n1111,\n#BRANCHSTART p,50,80\n#N\n1A00,\n7080,\n#E\n0000,\n0000,\n#M\n234B,\n9080,\n#BRANCHEND\n2222,\n#END\n';
  for (const route of ['N', 'E', 'M']) {
    const chart = parseChart(text, TJAParser, 0, [route]);
    state.chart = chart;
    assert.equal(manager.routeNoteCount(chart.branches[0], 'N'), 4);
    assert.equal(manager.routeNoteCount(chart.branches[0], 'E'), 0);
    assert.equal(manager.routeNoteCount(chart.branches[0], 'M'), 6);
  }
  const updated = parseChart(text.replace('1A00,', '1A20,'), TJAParser);
  state.chart = updated;
  assert.equal(manager.routeNoteCount(updated.branches[0], 'N'), 5);
  assert.match(descriptor.template.content, /<span v-if="branch.routes.includes\(route\)" class="route-note-count">.*routeNoteCount\(branch, route\)/);
});

test('branch titles use inclusive measure ranges and readable conditions with all branches sorted', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('const sortedBranches ='), script.indexOf('async function open()'));
  const parser = script.slice(script.indexOf('function branchCondition('), script.indexOf('function updateCondition('));
  const branch = { index: 0, firstBarIndex: 6, barCount: 3, value: 'p,50,80' };
  const branches = ref([branch]);
  const labels = runInNewContext(`${source}\n${parser}\n({ branchLabel, conditionLabel, sortedBranches })`, { computed, branches, t });
  reset();
  try {
    assert.equal(labels.branchLabel(branch), '7-9 小节（共 3 小节）');
    assert.equal(labels.branchLabel({ firstBarIndex: 0, barCount: 1 }), '1-1 小节（共 1 小节）');
    assert.equal(labels.branchLabel({ firstBarIndex: 4, barCount: 0 }), '空分歧');
    assert.equal(labels.conditionLabel(branch), '精度：普通 < 50% · 玄人 50%–<80% · 达人 ≥ 80%');
    assert.equal(labels.conditionLabel({ value: 'r, 10, 20' }), '连打数：普通 < 10 · 玄人 10–<20 · 达人 ≥ 20');
    assert.equal(labels.conditionLabel({ value: 's,100.5,200' }), '分数：普通 < 100.5 · 玄人 100.5–<200 · 达人 ≥ 200');
    locale.value = 'en';
    assert.equal(labels.branchLabel(branch), 'Measures 7-9 (3 total)');
    assert.equal(labels.conditionLabel(branch), 'Accuracy: Normal < 50% · Expert 50%–<80% · Master ≥ 80%');
    const later = { ...branch, index: 1, firstBarIndex: 9, barCount: 9 };
    const earlier = { ...branch, index: 2, firstBarIndex: 1 };
    branches.value = [later, branch, earlier];
    assert.deepEqual(Array.from(labels.sortedBranches.value, item => item.index), [2, 0, 1]);
    assert.deepEqual(branches.value.map(item => item.index), [1, 0, 2]);
    assert.equal((descriptor.template.content.match(/<strong>\{\{ branchLabel\(branch\) \}\}<\/strong><small>\{\{ conditionLabel\(branch\) \}\}<\/small>/g) || []).length, 2);
    assert.doesNotMatch(descriptor.template.content, /t\('分歧 \{p0\}'|\{\{ branch\.value \}\}/);
  } finally { reset(); }
});

test('inline branch conditions preserve other values, target the correct branch and surface rejected changes', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.replace(/^import .*;\n/gm, '');
  const writes = [], branch = { firstBarIndex: 6, value: 'p,50,80' };
  const state = { notice: 'invalid condition' };
  const controls = runInNewContext(`${source}; ({ updateCondition, mode, error })`, {
    ref, reactive, computed, inject: () => ({
      state, bar: ref(null), applyMeasureBranch(operation, measure) {
        writes.push({ operation, measure });
        return Number.isFinite(operation.lower) && Number.isFinite(operation.upper);
      }
    })
  });
  controls.updateCondition(branch, 'lower', '60');
  assert.equal(writes[0].measure, 6);
  assert.equal(writes[0].operation.type, 'condition');
  assert.equal(writes[0].operation.condition, 'p');
  assert.equal(writes[0].operation.lower, 60);
  assert.equal(writes[0].operation.upper, 80);
  controls.updateCondition(branch, 'condition', 's');
  assert.equal(writes[1].operation.condition, 's');
  assert.equal(writes[1].operation.lower, 50);
  controls.updateCondition(branch, 'upper', '');
  assert.ok(Number.isNaN(writes[2].operation.upper));
  assert.equal(controls.error.value, 'invalid condition');
  controls.updateCondition(branch, 'upper', '90');
  assert.equal(writes[3].operation.upper, 90);
  assert.equal(controls.error.value, '');
  assert.equal(controls.mode.value, '');
});

test('branch manager submits explicit route sources and retained notes to the target branch, and keeps failed forms open', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.replace(/^import .*;\n/gm, '');
  const branch = { index: 1, firstBarIndex: 6, route: 'N', routes: ['N', 'E'], value: 's,10,20' };
  const writes = [], state = reactive({ chart: { branches: [branch] }, notice: 'failed' });
  let success = true, confirmed = false;
  const manager = runInNewContext(`${source}; ({ edit, submit, removeRoute, fields, mode, error })`, {
    ref, reactive, computed, inject: () => ({ state, bar: ref(null), applyMeasureBranch: (operation, measure) => { writes.push({ operation, measure }); return success; } }),
    confirm: () => confirmed, t, names: { N: '普通', E: '玄人' }
  });
  manager.edit(branch, 'route', 'M'); manager.fields.source = 'E'; manager.submit();
  assert.equal(writes[0].operation.source, 'E'); assert.equal(writes[0].operation.route, 'M'); assert.equal(writes[0].measure, 6);
  manager.edit(branch, 'route', 'M'); manager.fields.source = ''; manager.submit();
  assert.equal(writes[1].operation.source, null);
  manager.edit(branch, 'remove'); manager.fields.keep = 'E'; manager.submit();
  assert.equal(writes[2].operation.keep, 'E');
  success = false;
  manager.edit(branch, 'remove'); manager.fields.keep = ''; manager.submit();
  assert.equal(writes[3].operation.keep, null); assert.equal(manager.error.value, 'failed'); assert.equal(manager.mode.value, 'remove');
  manager.removeRoute(branch, 'E'); assert.equal(writes.length, 4);
  confirmed = true; manager.removeRoute(branch, 'E');
  assert.equal(writes.length, 5); assert.equal(writes[4].operation.clearLast, true);
});

test('duet creation stays in the chart tree without an injected duplicate sidebar entry', () => {
  for (const name of ['App.vue', 'SongWorkspace.vue', 'CourseControls.vue', 'MeasureEditor.vue']) {
    const text = readFileSync(new URL(name, import.meta.url), 'utf8'), { descriptor } = parse(text);
    compileScript(descriptor, { id: 'duet-entry-' + name });
    assert.doesNotMatch(text, /openPlayers|command-player-structure|player-style|mode === 'players'/, name);
  }
  const courses = readFileSync(new URL('CourseControls.vue', import.meta.url), 'utf8');
  assert.match(courses, /\['single', 'P1', 'P2', 'shared'\]/);
  assert.match(courses, /draft.course = group.course; draft.player = entry.player; open\('create'\)/);
  assert.match(courses, /studio.createCourse\(\{ course: draft.course, player: draft.player/);
  assert.match(courses, /defineExpose\(\{ focusTree \}\)/);
});

test('command groups separate arbitrary positions from measure-start controls', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'command-groups' });
  const position = descriptor.template.content.match(/<fieldset id="position-commands"[\s\S]*?<\/fieldset>/)[0];
  const measure = descriptor.template.content.match(/<fieldset id="measure-commands"[\s\S]*?<\/fieldset>/)[0];
  assert.match(position, /<legend>{{ t\('任意落点指令'\) }}<\/legend>/);
  assert.match(measure, /<legend>{{ t\('小节级指令'\) }}<\/legend>/);
  assert.ok(!position.includes('id="command-numerator"'));
  assert.ok(!measure.includes('id="command-numerator"'));
  for (const [group, other, keys] of [[position, measure, ['bpm', 'scroll', 'delay', 'gogo', 'lyric', 'senote']], [measure, position, ['meter', 'barline', 'section', 'levelhold']]]) {
    for (const key of keys) {
      const id = `${group === position ? 'bar' : 'use'}-${key}`;
      assert.ok(group.includes(`id="${id}"`), key);
      assert.ok(!other.includes(`id="${id}"`), key);
      assert.equal(descriptor.template.content.split(`id="${id}"`).length - 1, 1, key);
    }
    assert.ok(group.includes('@keydown="finishSetting"'));
  }
  assert.match(descriptor.scriptSetup.content, /watch\(\[command, measureCommand\]/);
  assert.match(descriptor.scriptSetup.content, /numerator: measure.timing.numerator, denominator: measure.timing.denominator/);
  assert.match(descriptor.scriptSetup.content, /barline: measure.timing.barline/);
  assert.match(descriptor.styles[0].content, /\.command-group\{min-width:0;/);
  assert.doesNotMatch(position, /type="checkbox"| required/);
  assert.match(position, /<option value="">/);
  assert.match(position, /GOGO START/); assert.match(position, /GOGO END/);
});

test('workspace Escape closes the mobile overlay without dismissing nested dialogs or composition', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.match(/function workspaceKeydown\(event\) \{[\s\S]*?\n\}/)[0];
  const mobileWorkspace = { value: true }, workspaceOpen = { value: true };
  let closed = 0, focused = 0;
  const handle = runInNewContext(`${source}; workspaceKeydown`, { mobileWorkspace, workspaceOpen, closeWorkspace: () => closed++, workspaceSidebar: { value: { focusToggle: () => focused++ } } });
  const native = extra => handle({ key: 'Escape', target: { closest: () => null }, preventDefault() { assert.fail('Native Escape must not be consumed'); }, ...extra });
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { defaultPrevented: true }, { target: { closest: () => ({}) } }]) native(extra);
  mobileWorkspace.value = false; native({}); mobileWorkspace.value = true;
  workspaceOpen.value = false; native({}); workspaceOpen.value = true;
  handle({ key: 'Escape', target: { closest: () => null }, preventDefault() {}, stopPropagation() {} });
  assert.equal(closed, 1); assert.equal(focused, 1);
});

test('command changes auto-apply only their own field at the correct scope and validate before writing', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'automatic-commands' });
  assert.doesNotMatch(descriptor.template.content, /settings-apply|应用落点指令|@submit.prevent="apply"/);
  const keys = ['bpm', 'scroll', 'meter', 'delay', 'gogo', 'barline', 'lyric', 'senote', 'section', 'levelhold'];
  for (const key of keys) assert.ok(descriptor.template.content.includes(`@change="apply('${key}', $event)"`), key);
  const source = descriptor.scriptSetup.content.match(/function apply\(key, event\) \{[\s\S]*?\n\}/)[0];
  const enabled = Object.fromEntries(keys.map(key => [key, true]));
  const fields = { bpm: 180, scroll: 0, numerator: 7, denominator: 8, delay: -.25, gogo: 'on', barline: 'off', lyric: 'New lyric', senote: 12 };
  const measureKeys = ['meter', 'barline', 'section', 'levelhold'];
  const writes = [], targets = [], event = { currentTarget: { querySelectorAll: () => [{ reportValidity: () => true }] } };
  const apply = runInNewContext(`${source}; apply`, { enabled, fields, measureKeys, studio: { applySettings: (value, atStart) => { writes.push(JSON.parse(JSON.stringify(value))); targets.push(atStart); } } });
  for (const [key, expected] of [['bpm', 180], ['scroll', 0], ['delay', -.25], ['gogo', true], ['barline', false], ['lyric', 'New lyric'], ['senote', 12], ['section', true], ['levelhold', true]]) {
    apply(key, event);
    assert.deepEqual(writes.at(-1), { [key]: expected });
    assert.equal(targets.at(-1), measureKeys.includes(key), key);
    if (measureKeys.includes(key)) enabled[key] = false;
    else fields[key] = '';
    apply(key, event);
    assert.deepEqual(writes.at(-1), { [key]: null });
    assert.equal(targets.at(-1), measureKeys.includes(key), key);
  }
  apply('meter', event); assert.deepEqual(writes.at(-1), { numerator: 7, denominator: 8 }); assert.equal(targets.at(-1), true);
  enabled.meter = false; apply('meter', event); assert.deepEqual(writes.at(-1), { numerator: null, denominator: null });
  assert.equal(targets.at(-1), true);
  fields.scroll = 0;
  fields.delay = 0; apply('delay', event); assert.deepEqual(writes.at(-1), { delay: 0 });
  fields.gogo = 'off'; apply('gogo', event); assert.deepEqual(writes.at(-1), { gogo: false });
  const count = writes.length;
  let reported = false;
  apply('scroll', { currentTarget: { querySelectorAll: () => [{ reportValidity: () => { reported = true; return false; } }] } });
  assert.equal(reported, true); assert.equal(writes.length, count);
  const finish = runInNewContext(`${descriptor.scriptSetup.content.match(/function finishSetting\(event\) \{[\s\S]*?\n\}/)[0]}; finishSetting`);
  let blurred = 0, prevented = 0;
  const enter = { key: 'Enter', target: { blur: () => blurred++ }, preventDefault: () => prevented++ };
  finish({ ...enter, isComposing: true }); finish({ ...enter, keyCode: 229 });
  assert.equal(blurred, 0); assert.equal(prevented, 0);
  finish(enter); assert.equal(blurred, 1); assert.equal(prevented, 1);
  let allowed = true, stopped = 0, appliedKey;
  const save = runInNewContext(`${descriptor.scriptSetup.content.match(/function finishSetting\(event\) \{[\s\S]*?\n\}/)[0]}; finishSetting`, { apply: key => { appliedKey = key; return allowed; } });
  const saveEvent = { key: 's', ctrlKey: true, target: { id: 'bar-denominator', closest: () => ({}) }, preventDefault: () => prevented++, stopPropagation: () => stopped++ };
  save(saveEvent); assert.equal(appliedKey, 'meter'); assert.equal(stopped, 0);
  allowed = false; save(saveEvent); assert.equal(stopped, 1);
});

test('the timeline toolbar groups explicit before and after measure insertion actions with availability guards', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'insert-measures' });
  const toolbar = descriptor.template.content.match(/<div class="editor-actions">[\s\S]*?<\/button>\s*<\/div>(?=\s*<label class="follow-control">)/)[0];
  assert.match(toolbar, /class="measure-actions" role="group" :aria-label="t\('插入小节'\)"/);
  for (const [id, side] of [['insert-bar-before', 'before'], ['insert-bar-after', 'after']]) {
    const button = toolbar.match(new RegExp(`<button id="${id}"[^>]*>[\\s\\S]*?<\\/button>`))[0];
    assert.ok(button.includes(':disabled="!bar || state.invalid"'));
    assert.ok(button.includes(`@click="studio.insertBar('${side}')"`));
    assert.ok(button.includes(`t('${side === 'before' ? '前插小节' : '后插小节'}')`));
    assert.ok(button.includes(`<BetweenHorizontal${side === 'before' ? 'Start' : 'End'} aria-hidden="true" />`));
    assert.equal(descriptor.template.content.split(`id="${id}"`).length - 1, 1);
  }
  assert.doesNotMatch(toolbar, /id="snap-division"|id="view"|id="follow-playback"/);
  assert.doesNotMatch(descriptor.template.content.match(/<section class="measure-section">[\s\S]*?<\/section>/)[0], /insert-bar|measure-actions/);
  assert.match(descriptor.styles[0].content, /\.measure-heading\{[^}]*flex-wrap:wrap/);
  assert.match(descriptor.styles[0].content, /\.measure-actions\{display:inline-flex;[^}]*border:0;border-radius:5px/);
  assert.match(descriptor.styles[0].content, /\.measure-actions button\{[^}]*border:0;border-radius:4px/);
});

test('the timeline toolbar offers direct measure deletion with an icon and last-measure and invalid-source guards', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'delete-measure' });
  const toolbar = descriptor.template.content.match(/<div class="editor-actions">[\s\S]*?<\/div><\/div>/)[0];
  const button = toolbar.match(/<button id="delete-bar"[\s\S]*?<\/button>/)[0];
  assert.match(button, /:disabled="!bar \|\| state.invalid \|\| state.chart.bars.length <= 1"/);
  assert.match(button, /@click="studio.deleteBar"/);
  assert.match(button, /<Trash2 aria-hidden="true" \/>/);
  assert.match(button, /t\('不能删除最后一个小节。'\)/);
  assert.match(button, /t\('删除小节'\)/);
  assert.equal(descriptor.template.content.split('id="delete-bar"').length - 1, 1);
});

test('measure information occupies the position subtitle above selected-note attributes, not the sidebar', () => {
  const { descriptor: measure } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  compileScript(measure, { id: 'measure-properties' });
  const { descriptor: timeline } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  assert.doesNotMatch(timeline.template.content, /editor-footer|position-info/);
  assert.doesNotMatch(measure.template.content, /id="note-count"|id="bar-grid"|id="bar-snap"/);
  assert.match(timeline.scriptSetup.content, /import \{[^}]*\bGRID_DIVISIONS\b[^}]*\} from '\.\/grid.js'/);
  assert.match(timeline.template.content, /class="position-caption"[\s\S]*<template #description>\s*<div class="measure-info">[\s\S]*?<\/template>\s*<\/SectionHeading>\s*<dl>/);
  const info = timeline.template.content.match(/<div class="measure-info">[\s\S]*?<\/div>/)[0];
  assert.match(info, /id="note-count">.*stats.total/);
  assert.match(info, /id="bar-grid">.*GRID_DIVISIONS/);
  assert.match(info, /id="bar-snap">.*controls.snap/);
  assert.match(info, /id="bar-slots">.*bar\?\.notes.length/);
  assert.match(measure.template.content, /id="division" :value="bar\?\.notes.length"/);
});

test('navigation, position information and branches share an icon heading with inline details', () => {
  const { descriptor } = parse(readFileSync(new URL('SectionHeading.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'shared-section-heading' });
  assert.match(descriptor.template.content, /class="section-emblem" aria-hidden="true"><component :is="icon"/);
  assert.match(descriptor.template.content, /<h2>{{ title }}<\/h2><slot \/>/);
  assert.match(descriptor.styles[0].content, /\.section-caption\{[^}]*min-height:34px/);
  assert.match(descriptor.styles[0].content, /\.section-title-row\{[^}]*min-height:20px/);
  assert.match(descriptor.styles[0].content, /\.section-description\{margin-top:2px;/);
  assert.match(descriptor.styles[0].content, /\.section-title-row\{[^}]*align-items:baseline/);
  assert.match(descriptor.styles[0].content, /font-size:13px;font-weight:600;line-height:1.5/);
  const timeline = readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8');
  assert.match(timeline, /\.clear-measure-selection\{align-self:center;min-height:20px;padding:0 6px;/);
  assert.match(timeline, /<SectionHeading :icon="Map" :title="t\('全局导航'\)">[\s\S]*id="selection-summary"[\s\S]*@click="studio.clearLoop"[\s\S]*<\/SectionHeading>/);
  assert.match(timeline, /:title="t\('全局导航'\)">[\s\S]*<template #description>\s*<div class="chart-statistics"[\s\S]*id="total-notes"[\s\S]*<\/template>\s*<\/SectionHeading>/);
  assert.match(timeline, /<SectionHeading class="position-caption" :icon="Grid2X2" :title="t\('落点信息'\)">[\s\S]*class="position-measure"/);
  const branches = readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8');
  assert.match(branches, /<SectionHeading class="branch-caption" :icon="GitBranch" :title="t\('谱面分歧'\)">[\s\S]*class="branch-count"[\s\S]*<template #description>/);
  assert.match(branches, /\.branch-context\{[^}]*padding:8px 12px/);
  assert.match(readFileSync(new URL('sound.css', import.meta.url), 'utf8'), /\.cell-inspector\{[^}]*padding:15px 12px/);
  assert.match(readFileSync(new URL('App.vue', import.meta.url), 'utf8'), /\.measure-section\{padding-inline:12px\}/);
});

test('branch information occupies the caption subtitle without instructional copy or a separate footer row', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'compact-branch-caption' });
  assert.match(descriptor.template.content, /class="branch-current">\{\{ current \?/);
  assert.doesNotMatch(descriptor.template.content, /统一切换全部分歧，或按需单独调整。|仅影响显示与试听，不修改谱面。|branch-context-foot/);
});

test('one wrapping toolbar combines measure actions, snap, zoom and follow controls above the timeline', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'inline-snap-controls' });
  const tools = descriptor.template.content.match(/<div class="lane-head editor-tools editor-bar">[\s\S]*?(?=\s*<div class="timeline-frame">)/)[0];
  assert.equal(descriptor.template.content.split('class="lane-head editor-tools editor-bar"').length - 1, 1);
  assert.doesNotMatch(tools, /音乐波形|振幅/);
  for (const id of ['bar-number', 'undo', 'redo', 'insert-bar-before', 'insert-bar-after', 'delete-bar', 'snap-division', 'custom-snap', 'follow-playback', 'view']) {
    assert.ok(tools.includes(`id="${id}"`), id);
    assert.equal(descriptor.template.content.split(`id="${id}"`).length - 1, 1);
  }
  assert.match(tools, /@change="snapChange"/);
  assert.match(tools, /id="bar-number"[\s\S]*id="snap-division"[\s\S]*id="custom-snap"[\s\S]*id="view"[\s\S]*id="undo"[\s\S]*id="redo"[\s\S]*id="insert-bar-before"[\s\S]*id="insert-bar-after"[\s\S]*id="delete-bar"[\s\S]*id="follow-playback"/);
  assert.match(tools, /v-show="controls.snapChoice === 'custom'"/);
  assert.match(tools, /min="1" max="768"/);
  assert.match(tools, /@change="studio.setSnap\(Number\(controls.customSnap\)\)"/);
  assert.match(tools, /id="view"[\s\S]*<label class="follow-control"><input id="follow-playback" v-model="state.followPlayback" type="checkbox" role="switch"><span class="switch-track" aria-hidden="true"><\/span>[\s\S]*<\/label>\s*<\/div>$/);
  assert.match(descriptor.styles[0].content, /\.follow-control input:checked\+\.switch-track\{background:var\(--green\)\}/);
  assert.match(descriptor.styles[0].content, /\.follow-control input:checked\+\.switch-track::before\{transform:translateX\(12px\)\}/);
  assert.match(descriptor.styles[0].content, /\.follow-control input:focus-visible\+\.switch-track\{outline:2px solid var\(--green\)/);
  assert.doesNotMatch(descriptor.styles[0].content, /\.editor-actions\{[^}]*margin-left:auto/);
  assert.match(descriptor.styles[0].content, /\.lane-head.editor-tools\{justify-content:flex-start;/);
  assert.match(descriptor.styles[0].content, /\.editor-tools \.follow-control\{[^}]*margin-left:auto;/);
  assert.match(descriptor.styles[0].content, /\.editor-bar,\.editor-tools\{flex-wrap:wrap\}/);
  assert.doesNotMatch(descriptor.template.content, /snap-controls|snap-position/);
  assert.doesNotMatch(readFileSync(new URL('sound.css', import.meta.url), 'utf8'), /\.snap-controls/);
});

test('editor columns are siblings and mobile transport can leave the scrolling center content', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'editor-columns' });
  const template = descriptor.template.content;
  assert.match(template, /<div class="editor-core" :inert="state.editorBlocked">\s*<section v-if="studio.bar.value" class="document-toolbar">[\s\S]*?<\/section>\s*<div class="editor-scroll">/);
  assert.match(template, /<TimelineEditor v-if="studio.bar.value" \/>/);
  assert.match(template, /<\/div>\s*<Teleport to="body" :disabled="!mobileWorkspace"><div ref="transportHost" class="transport-host">\s*<section v-if="studio.bar.value" class="transport">/);
  assert.match(template, /<\/div><\/section>\s*<div v-if="state.notice && \(studio.bar.value \|\| state.error\)" id="notice"[^>]*>{{ state.notice }}<\/div>\s*<\/div><\/Teleport>\s*<\/div>\s*<MeasureEditor v-if="studio.bar.value" :inert="state.editorBlocked" \/>/);
  assert.doesNotMatch(template, /id="preview-range"|id="loop-summary"|id="apply-loop"|id="loop-current"/);
  assert.match(template, /ref="selectionDialog"[\s\S]*@submit.prevent="applySelection"/);
  assert.match(template, /id="selection-first"/); assert.match(template, /id="selection-last"/);
  assert.doesNotMatch(template, /loop-controls|loop-range-inputs/);
  const styles = descriptor.styles[0].content;
  assert.match(styles, /\.editor-scroll\{[^}]*overflow:auto/);
  assert.match(styles, /\.transport\{[^}]*flex-shrink:0/);
  assert.match(styles, /\.volume-panel\{[^}]*bottom:calc\(100% \+ 6px\)/);
});

test('status messages sit below playback outside scrolling content and share mobile height tracking and safe-area space', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'bottom-status' });
  const template = descriptor.template.content;
  assert.equal(template.split('id="notice"').length - 1, 1);
  const scrolling = template.slice(template.indexOf('<div class="editor-scroll">'), template.indexOf('<Teleport to="body"'));
  assert.doesNotMatch(scrolling, /id="notice"/);
  const host = template.match(/<div ref="transportHost" class="transport-host">[\s\S]*?<\/Teleport>/)[0];
  assert.match(host, /<\/section>\s*<div v-if="state.notice && \(studio.bar.value \|\| state.error\)" id="notice" role="status" aria-live="polite" :class="\{ error: state.error \}"/);
  assert.match(descriptor.scriptSetup.content, /transportObserver.observe\(transportHost.value\)/);
  const styles = descriptor.styles[0].content;
  assert.match(styles, /#notice\{[^}]*min-height:0;max-height:20dvh;overflow:auto;/);
  assert.match(styles, /#notice.error\{color:#bd352b\}/);
  assert.match(styles, /\.transport:has\(\+#notice\)\{padding-bottom:7px\}/);
  assert.match(styles, /\.transport-host>#notice\{padding-bottom:calc\(4px \+ env\(safe-area-inset-bottom,0px\)\)\}/);
});

test('branch filtering and structural management have separate dialogs and actions without search inputs', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'branch-controls' });
  const dialogs = [...descriptor.template.content.matchAll(/<dialog\b[\s\S]*?<\/dialog>/g)].map(match => match[0]);
  assert.equal(dialogs.length, 2);
  const [filter, manager] = dialogs;
  assert.match(filter, /aria-labelledby="branch-filter-title"/);
  assert.match(filter, /role="radiogroup"/);
  assert.match(filter, /studio.changeAllBranches\(route\)/);
  assert.match(filter, /studio.changeBranch\(branch.index, route\)/);
  assert.match(filter, /locate\(branch, filterDialog\)/);
  assert.doesNotMatch(filter, /branch-create|@click="edit\(|@click="removeRoute\(/);
  assert.match(manager, /aria-labelledby="branch-dialog-title"/);
  assert.match(manager, /id="branch-create"/);
  assert.match(manager, /class="branch-condition-fields inline-condition"/);
  for (const field of ['condition', 'lower', 'upper']) assert.ok(manager.includes(`updateCondition(branch, '${field}', $event.target.value)`));
  assert.doesNotMatch(manager, /edit\(branch, 'condition'\)/);
  assert.match(manager, /@click="removeRoute\(branch, route\)"/);
  assert.doesNotMatch(manager, /role="radiogroup"|studio.changeBranch|studio.changeAllBranches/);
  for (const dialog of dialogs) {
    assert.doesNotMatch(dialog, /type="search"|v-model="query"/);
    assert.match(dialog, /v-for="branch in sortedBranches"/);
    assert.doesNotMatch(dialog, /t\('完成'\)/);
    assert.match(dialog, /:aria-label="t\('关闭'\)"/);
  }
  assert.match(descriptor.template.content, /id="branch-filter"[^>]*:disabled="state.invalid \|\| !branches.length"[^>]*@click="openFilter"/);
  assert.match(descriptor.template.content, /id="branch-manage"[^>]*:disabled="state.invalid"[^>]*@click="open"/);
  assert.match(descriptor.template.content, /<\/SectionHeading>\s*<div class="branch-actions">\s*<button id="branch-filter"[\s\S]*<button id="branch-manage"[\s\S]*<\/div>\s*<dialog/);
  assert.match(descriptor.styles[0].content, /\.branch-actions\{display:flex;flex-basis:100%;flex-wrap:wrap;gap:8px\}/);
  assert.match(descriptor.styles[0].content, /\.branch-actions>\.manage-branches\{min-height:32px;padding:5px 10px\}/);
  assert.doesNotMatch(descriptor.template.content, /<dialog[^>]*\bopen(?:\s|>)/);
  assert.match(descriptor.styles[0].content, /\.branch-context\{[^}]*margin:0;padding:8px 12px;border-bottom:1px solid var\(--line\);background:#fff/);
  const app = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8')).descriptor;
  assert.match(app.template.content, /<div class="editor-scroll">\s*<TimelineEditor v-if="studio.bar.value" \/>/);
  assert.doesNotMatch(app.template.content, /<BranchControls/);
  const timeline = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8')).descriptor;
  assert.match(timeline.template.content, /<div class="editor-information">\s*<section class="cell-inspector"[\s\S]*?<\/dl>\s*<\/section>\s*<BranchControls \/>\s*<\/div>\s*<\/section>\s*<\/div>\s*<section class="measure-section">/);
  assert.match(timeline.styles[0].content, /\.editor-information\{display:grid;grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(timeline.styles[0].content, /\.editor-information>section\.branch-context\{[^}]*border-bottom:0\}/);
  assert.match(timeline.styles[0].content, /@container\(min-width:900px\)\{\.editor-information\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.doesNotMatch(app.styles[0].content, /\.chart-context/);
});

test('branch management keeps measure details in the title and places route actions beside names', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'branch-measure-summary' });
  const manager = descriptor.template.content.match(/<dialog ref="dialog"[\s\S]*?<\/dialog>/)[0];
  assert.match(manager, /<strong>\{\{ branchLabel\(branch\) \}\}<\/strong>/);
  assert.doesNotMatch(manager, /class="branch-measures"|t\('(?:起始小节|结束小节|小节数：)/);
  const cards = manager.match(/<div class="branch-route-cards">([\s\S]*?)<\/article>/)[1];
  assert.doesNotMatch(cards, /<small|小节数/);
  assert.match(cards, /<strong>[\s\S]*<\/strong>\s*<button/);
  assert.match(descriptor.styles[0].content, /\.branch-route-card\{display:flex;align-items:center;justify-content:space-between;/);
  const conditionFields = manager.match(/<fieldset class="branch-condition-fields inline-condition"[\s\S]*?<\/fieldset>/)[0];
  assert.doesNotMatch(conditionFields, /<legend/);
  assert.match(conditionFields, /:aria-label="t\('分歧条件'\)"/);
  assert.equal([...conditionFields.matchAll(/<label>/g)].length, 3);
  const styles = descriptor.styles[0].content;
  assert.match(styles, /\.branch-condition-fields\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.branch-condition-fields select\{max-width:none\}/);
  assert.match(styles, /\.inline-condition input,\.inline-condition select\{box-sizing:border-box;width:100%;min-width:0;height:34px\}/);
  assert.match(styles, /\.branch-route-cards\{[^}]*border-top:1px solid var\(--line\);padding-top:12px/);
  assert.match(cards, /:data-route="route" :class="\{ missing: !branch.routes.includes\(route\) \}"/);
  for (const route of ['N', 'E', 'M']) {
    assert.ok(styles.includes(`.branch-route-card[data-route=${route}]:not(.missing){background:#`));
  }
  assert.match(styles, /\.branch-route-card\.missing\{[^}]*background:#[0-9a-f]{6};/);
  assert.doesNotMatch(styles, /\.branch-route-card\.missing\{[^}]*background:transparent/);
  assert.match(styles, /\.branch-route-card\.missing\{border-style:dashed;/);
  assert.match(styles, /\.branch-route-card:not\(\.missing\)\{border-style:solid;box-shadow:inset 3px 0 currentColor\}/);
  assert.match(cards, /<\/button>\s*<Plus v-else aria-hidden="true" \/>/);
  assert.match(cards, /<component :is="branch.routes.includes\(route\) \? 'div' : 'button'"/);
  assert.match(cards, /:type="branch.routes.includes\(route\) \? undefined : 'button'"/);
  assert.match(cards, /:disabled="!branch.routes.includes\(route\) && \(state.invalid \|\| !branch.barCount\)"/);
  assert.match(cards, /@click="!branch.routes.includes\(route\) && edit\(branch, 'route', route\)"/);
  assert.doesNotMatch(cards, /route-create-hint|<a\b/);
  assert.match(cards, /:aria-label="t\('删除路线 \{p0\}', \{ p0: route \}\)" @click="removeRoute\(branch, route\)"><X \/><\/button>/);
  assert.match(cards, /<span v-else class="route-status">\{\{ t\('点击创建'\) \}\}<\/span>/);
  assert.doesNotMatch(cards, /<Trash2|t\('删除'\)/);
});

test('branch dialogs scroll to the current branch, keep management open on locate and support Escape', async () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.replace(/^import .*;\n/gm, '');
  const calls = [];
  const controls = runInNewContext(`${source}; ({ open, openFilter, locate, keydown, dialog, filterDialog, list, filterList, mode, error })`, {
    ref, reactive, computed, nextTick: async () => {}, inject: () => ({
      state: {}, bar: ref(null), pause: () => calls.push('pause'), select: index => calls.push(index)
    })
  });
  const owner = name => ({ showModal: () => calls.push(`open:${name}`), close: () => calls.push(`close:${name}`) });
  controls.dialog.value = owner('manager'); controls.filterDialog.value = owner('filter');
  controls.list.value = { offsetTop: 10, scrollTop: 0, querySelector: () => ({ offsetTop: 60 }) };
  controls.filterList.value = { offsetTop: 20, scrollTop: 0, querySelector: () => ({ offsetTop: 100 }) };
  await controls.openFilter();
  assert.equal(controls.filterList.value.scrollTop, 80);
  assert.deepEqual(calls.splice(0), ['pause', 'open:filter']);
  controls.locate({ firstBarIndex: 4 }, controls.filterDialog.value);
  assert.deepEqual(calls.splice(0), [4, 'close:filter']);
  await controls.open();
  assert.equal(controls.list.value.scrollTop, 50);
  assert.deepEqual(calls.splice(0), ['pause', 'open:manager']);
  controls.locate({ firstBarIndex: 6 });
  assert.deepEqual(calls.splice(0), [6]);
  const escape = currentTarget => controls.keydown({ key: 'Escape', currentTarget, preventDefault() {}, stopPropagation() {} });
  controls.mode.value = 'create'; controls.error.value = 'failed';
  escape(controls.dialog.value);
  assert.equal(controls.mode.value, ''); assert.equal(controls.error.value, '');
  assert.deepEqual(calls, []);
  escape(controls.dialog.value); escape(controls.filterDialog.value);
  assert.deepEqual(calls, ['close:manager', 'close:filter']);
});

test('branch creation groups equal-width route and source fields and displays errors next to actions', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'branch-creation-layout' });
  const template = descriptor.template.content;
  const fields = template.match(/<div v-if="mode === 'create' \|\| mode === 'route'"[\s\S]*?<\/div>/)[0];
  assert.match(fields, /id="branch-initial-route"/);
  assert.match(fields, /id="branch-source"/);
  assert.match(fields, /'branch-source-fields': mode === 'create'/);
  const form = template.match(/<form v-if="mode"[\s\S]*?<\/form>/)[0];
  assert.match(form, /class="branch-route-error" role="alert"[\s\S]*?<\/p>\s*<div class="branch-form-actions">/);
  assert.match(template, /v-if="!mode && \(error \|\| state.error\)" class="branch-route-error"/);
  assert.match(descriptor.styles[0].content, /\.branch-source-fields\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(descriptor.styles[0].content, /\.branch-source-fields select\{[^}]*max-width:none/);
  assert.match(descriptor.styles[0].content, /\.branch-form \.branch-route-error\{color:#bd3b30\}/);
});

test('per-mode deletion confirms the target without changing selection and permits deleting the last chart', () => {
  const { descriptor } = parse(readFileSync(new URL('CourseControls.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'course-controls' });
  assert.doesNotMatch(descriptor.template.content, /id="delete-course"/);
  assert.match(descriptor.template.content, /仅删除这张谱面/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /canDelete|deletionTargets/);
  assert.match(descriptor.template.content, /id="course-confirm"/);
  assert.match(descriptor.scriptSetup.content, /import \{[^}]*variantLabel[^}]*\} from '\.\/courses\.js'/);
  assert.match(descriptor.template.content, /<\/button>\s*<button v-if="entry.variant" class="tree-remove"/);
  assert.match(descriptor.template.content, /@click.stop="beginDelete\(entry.variant\)"/);
  assert.match(descriptor.scriptSetup.content, /studio.removeCourse\(draft.index\)/);
  assert.match(descriptor.template.content, /p0: courseLabel\(deletionTarget\?\.course\)/);
  assert.match(descriptor.styles[0].content, /\.tree-row:hover .tree-remove,.tree-row:focus-within .tree-remove/);
  assert.match(descriptor.styles[0].content, /@media\(hover:none\)/);
  assert.doesNotMatch(descriptor.template.content, /id="player-structure"/);
});

test('chart list uses localized difficulty names, decorative replaceable icons and per-mode rating badges', () => {
  const { descriptor } = parse(readFileSync(new URL('CourseControls.vue', import.meta.url), 'utf8'));
  const { bindings } = compileScript(descriptor, { id: 'localized-difficulties' });
  assert.ok(bindings.courseLabel); assert.ok(bindings.variantLabel);
  assert.match(descriptor.template.content, /<Layers aria-hidden="true" \/>/);
  assert.match(descriptor.template.content, /t\('难度与模式'\)/);
  assert.match(descriptor.template.content, /<DifficultyIcon :course="group.course" \/>/);
  assert.match(descriptor.template.content, /courseLabel\(group.course\)/);
  assert.match(descriptor.template.content, /courseLabel\(active.course\)/);
  assert.match(descriptor.template.content, /p0: courseLabel\(draft.course\)/);
  assert.match(descriptor.template.content, /★\{\{ entry.level \?\? '—' \}\}/);
  assert.match(descriptor.template.content, /<span v-if="entry.variant" class="tree-level"/);
  assert.match(readFileSync(new URL('courses.js', import.meta.url), 'utf8'), /COURSE_LABELS\[course\] \? t\(COURSE_LABELS\[course\]\) : course/);
  const icon = parse(readFileSync(new URL('DifficultyIcon.vue', import.meta.url), 'utf8')).descriptor;
  compileScript(icon, { id: 'difficulty-icon' });
  for (const course of ['Easy', 'Normal', 'Hard', 'Oni', 'Edit']) assert.ok(icon.scriptSetup.content.includes(`['${course}',`));
  assert.match(icon.template.content, /aria-hidden="true"/);
});

test('the tree confirms creation of exactly the requested difficulty and mode', () => {
  const { descriptor } = parse(readFileSync(new URL('CourseControls.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'quick-course-creation' });
  assert.match(descriptor.template.content, /@click="chooseEntry\(group, entry\)"/);
  assert.match(descriptor.scriptSetup.content, /studio.createCourse\(\{ course: draft.course, player: draft.player/);
  assert.match(descriptor.scriptSetup.content, /level: 1/);
  assert.match(descriptor.scriptSetup.content, /open\('create'\)/);
  assert.doesNotMatch(descriptor.template.content, /id="add-course"|id="course"/);
});

test('the tree lists all five difficulties and all three modes with weak missing entries', () => {
  const { descriptor } = parse(readFileSync(new URL('CourseControls.vue', import.meta.url), 'utf8'));
  const { bindings } = compileScript(descriptor, { id: 'missing-course-selection' });
  assert.ok(bindings.courseOptions);
  assert.match(descriptor.scriptSetup.content, /COURSE_NAMES.map\(/);
  assert.match(descriptor.template.content, /v-for="group in courseOptions"/);
  assert.match(descriptor.template.content, /:class="\{ missing: !group.variants.length \}"/);
  assert.match(descriptor.scriptSetup.content, /'single', 'P1', 'P2', 'shared'/);
  assert.match(descriptor.template.content, /:data-player="entry.player"/);
  assert.match(descriptor.template.content, /:aria-current=/);
  assert.match(descriptor.template.content, /谱面不存在/);
});

test('the selected tree chart retains an accessible ten-star slider', () => {
  const { descriptor } = parse(readFileSync(new URL('StarRating.vue', import.meta.url), 'utf8'));
  const { bindings } = compileScript(descriptor, { id: 'star-rating' });
  for (const binding of ['start', 'move', 'finish', 'cancel', 'keydown']) assert.ok(bindings[binding]);
  assert.match(descriptor.template.content, /v-for="star in 10"/);
  assert.match(descriptor.template.content, /role="slider"/);
  assert.match(descriptor.template.content, /:aria-valuemax="props.max"/);
  assert.match(descriptor.template.content, /@pointercancel="cancel"/);
  assert.match(descriptor.template.content, /<slot :value="shown" \/>/);
  assert.doesNotMatch(descriptor.template.content, /class="star-value"/);
  assert.match(descriptor.styles[0].content, /\.star-rating\{min-width:0/);
  const controls = parse(readFileSync(new URL('CourseControls.vue', import.meta.url), 'utf8')).descriptor;
  assert.equal([...controls.template.content.matchAll(/<StarRating\b/g)].length, 1);
  assert.match(controls.template.content, /v-if="active" class="tree-rating"/);
  assert.match(controls.template.content, /<output class="tree-rating-value"[^>]*>★/);
  assert.match(controls.template.content, /<template #default="\{ value \}">/);
  assert.match(controls.styles[0].content, /\.tree-rating\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(controls.template.content, /id="new-course-level"/);
});

test('the independent song sidebar edits metadata while empty songs expose creation and history', () => {
  const sidebar = parse(readFileSync(new URL('SongWorkspace.vue', import.meta.url), 'utf8')).descriptor;
  compileScript(sidebar, { id: 'song-workspace' });
  assert.match(sidebar.template.content, /<aside class="song-workspace"/);
  assert.doesNotMatch(sidebar.template.content, /<h2/);
  assert.match(sidebar.styles[0].content, /\.metadata-icon\{color:var\(--green\)\}/);
  assert.match(sidebar.template.content, /:data-song-field="field.key"/);
  assert.match(sidebar.template.content, /@change="updateMetadata\(field.key, \$event\)"/);
  assert.match(sidebar.template.content, /class="metadata-group" :open="group.expanded"/);
  assert.match(sidebar.scriptSetup.content, /label: '多语言信息'/);
  assert.match(sidebar.scriptSetup.content, /SONG_FIELDS.filter\(field => field.localized\)/);
  const app = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8')).descriptor;
  assert.match(app.template.content, /<SongWorkspace v-if="state.chart" ref="workspaceSidebar" :collapsed="!workspaceOpen"/);
  assert.match(app.template.content, /<TimelineEditor v-if="studio.bar.value"/);
  assert.match(app.template.content, /v-else class="empty-editor"/);
  assert.match(app.template.content, /v-for="course in COURSE_NAMES"/);
  assert.match(app.template.content, /:data-create-course="course"/);
  assert.match(app.template.content, /studio.createCourse\(\{ course, player: 'single', style: 'Single', level: 1 \}\)/);
  assert.match(app.template.content, /v-else id="empty-new-chart"[^>]*@click="studio.newChart"/);
  assert.doesNotMatch(app.template.content, /workspace.focusTree\(\)|选择难度与模式/);
  assert.match(app.template.content, /id="menu-undo"[^>]*:disabled="!state.undo.length"/);
  assert.match(app.template.content, /id="menu-redo"[^>]*:disabled="!state.redo.length"/);
  assert.doesNotMatch(app.template.content, /class="metadata-dialog"|id="song-metadata"/);
});
test('position editors expose preserved commands while branch editing lives in the global manager', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  const { bindings } = compileScript(descriptor, { id: 'command-editors' });
  for (const id of ['bar-lyric', 'use-section', 'use-levelhold', 'bar-senote']) assert.ok(descriptor.template.content.includes(`id="${id}"`));
  assert.ok(!bindings.applyBranchCondition);
  assert.doesNotMatch(descriptor.template.content, /branch-condition|branch-end|measure-branch-commands/);
  assert.match(descriptor.template.content, /<option value="">\{\{ t\('不启用'\)/);
  assert.doesNotMatch(descriptor.template.content, /edit-branch-source|branch-source-dialog|editBranchAt/);
  const manager = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8')).descriptor;
  compileScript(manager, { id: 'global-branch-manager' });
  for (const id of ['branch-create', 'branch-condition', 'branch-lower', 'branch-upper', 'branch-source', 'branch-keep']) assert.ok(manager.template.content.includes(`id="${id}"`));
  assert.match(manager.template.content, /:disabled="item.branchIndex !== null"/);
  assert.match(manager.template.content, /@click="chooseMeasure\(item.index\)"/);
});

test('all five catalogs are complete and preserve interpolation placeholders', () => {
  assert.equal(languages.length, 5);
  for (const [key, values] of Object.entries(translations)) {
    assert.equal(values.length, 4, key);
    for (const value of values) {
      assert.equal(typeof value, 'string', key);
      assert.ok(value.trim(), key);
      assert.deepEqual(placeholders(value), placeholders(key), key);
    }
  }
  const files = ['App.vue', 'SongWorkspace.vue', 'CourseControls.vue', 'StarRating.vue', 'BranchControls.vue', 'TimelineEditor.vue', 'MeasureEditor.vue', 'courses.js', 'useStudio.js', 'pwa.js', 'chart.js', 'branch-commands.js', 'grid.js', 'note-model.js', 'balloon.js', 'loop.js', 'history.js', 'metadata.js'];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const match of source.matchAll(/'([^'\\\r\n]*(?:\\.[^'\\\r\n]*)*)'/g)) {
      if (/\p{Script=Han}/u.test(match[1])) assert.ok(Object.hasOwn(translations, match[1]), `${file}: ${match[1]}`);
    }
  }
  for (const key of [...SONG_FIELDS.map(field => field.label), ...NOTE_TYPES.map(type => type.name)]) assert.ok(Object.hasOwn(translations, key), key);
});

test('browser language matching respects preference order, script and regional variants', () => {
  for (const [input, expected] of [['zh', 'zh-CN'], ['zh-SG', 'zh-CN'], ['zh-Hans-TW', 'zh-CN'], ['zh-TW', 'zh-TW'], ['zh-Hant', 'zh-TW'], ['zh-HK', 'zh-TW'], ['zh_MO', 'zh-TW'], ['EN-us', 'en'], ['ja-JP', 'ja'], ['ko-KR', 'ko']]) {
    assert.equal(matchLocale(input), expected, input);
  }
  assert.equal(matchLocale('english'), undefined);
  assert.equal(detectLocale(['fr-FR', 'ja-JP', 'en-US']), 'ja');
  assert.equal(detectLocale(['en-GB', 'zh-TW']), 'en');
  assert.equal(detectLocale(['fr-FR']), 'zh-CN');
  assert.equal(detectLocale(), 'zh-CN');
});

test('language preference persists independently of the workspace and updates HTML lang', () => {
  const saved = new Map([['tja-wave-workspace', 'untouched']]);
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const root = {};
  try {
    assert.equal(initializeLocale(storage, ['ko-KR'], root), undefined);
    assert.equal(locale.value, 'ko'); assert.equal(root.lang, 'ko'); assert.equal(localePreference.value, 'auto');
    for (const language of languages) {
      assert.equal(setLocale(language.code, storage, root), undefined);
      assert.equal(root.lang, language.code); assert.equal(saved.get(LOCALE_KEY), language.code);
      initializeLocale(storage, ['fr-FR'], root);
      assert.equal(locale.value, language.code); assert.equal(localePreference.value, language.code);
    }
    saved.set(LOCALE_KEY, 'unsupported');
    initializeLocale(storage, ['en-US'], root); assert.equal(locale.value, 'en');
    assert.equal(localePreference.value, 'auto');
    setLocale('auto', storage, root);
    assert.equal(saved.get(LOCALE_KEY), 'auto'); assert.equal(localePreference.value, 'auto');
    initializeLocale(storage, ['zh-Hant'], root); assert.equal(locale.value, 'zh-TW');
    assert.equal(saved.get('tja-wave-workspace'), 'untouched');
    assert.throws(() => setLocale('unsupported', storage, root), RangeError);
    assert.equal(locale.value, 'zh-TW');
  } finally { reset(); }
});

test('blocked storage reports the error while leaving language selection usable', () => {
  const failure = new Error('Storage blocked');
  const storage = { getItem() { throw failure; }, setItem() { throw failure; } }, root = {};
  try {
    assert.equal(initializeLocale(storage, ['ja-JP'], root), failure);
    assert.equal(locale.value, 'ja'); assert.equal(root.lang, 'ja');
    assert.equal(setLocale('ko', storage, root), failure);
    assert.equal(locale.value, 'ko'); assert.equal(root.lang, 'ko');
  } finally { reset(); }
});

test('messages, nested errors and note labels react immediately without translating user data', () => {
  const error = new LocalizedError(message('BPM 须为正数。'));
  const notice = message('打开谱面失败：{p0}', { p0: error });
  const label = computed(() => formatMessage(notice));
  try {
    for (const [code, expected] of [['en', 'Failed to open chart: BPM must be positive.'], ['ja', '譜面を開けませんでした：BPM は正の数で指定してください。'], ['zh-TW', '開啟譜面失敗：BPM 須為正數。'], ['ko', '채보 열기 실패: BPM은 양수여야 합니다.'], ['zh-CN', '打开谱面失败：BPM 须为正数。']]) {
      locale.value = code;
      assert.equal(label.value, expected);
    }
    locale.value = 'en';
    assert.equal(t('关闭 {p0}', { p0: '咚.tja' }), 'Close 咚.tja');
    assert.equal(t('关闭 {p0}', { p0: '<script>{p0}</script>' }), 'Close <script>{p0}</script>');
    assert.equal(t('unknown translation'), 'unknown translation');
    assert.equal(t('关闭 {p0}'), 'Close {p0}');
    assert.throws(() => setSongMetadata('TITLE:A\nBPM:120\n#START\n0,\n#END', { BPM: 0 }), { message: 'Base BPM must be a positive number.' });
    assert.throws(() => setSongMetadata('TITLE:A\n#START\n0,\n#END', { TITLE: 'A\nB' }), { message: 'Title cannot contain line breaks or null characters.' });
  } finally { reset(); }
});
