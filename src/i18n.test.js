import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { parse, compileScript, babelParse } from 'vue/compiler-sfc';
import { TJAParser } from 'tja';
import { parseChart } from './chart.js';
import { translations, getPageMetadata, getPageURL } from './locales.js';
import { SONG_FIELDS, setSongMetadata } from './metadata.js';
import { NOTE_TYPES, longNoteSpans } from './note-model.js';
import { createTimelineViewport, TIMELINE_GUTTER } from './timeline.js';
import { measureStart, measureEnd } from './loop.js';
import { formatTime } from './useStudio.js';
import { SNAP_DIVISIONS } from './grid.js';
import { languages, locale, localePreference, matchLocale, detectLocale, initializeLocale, setLocale, LOCALE_KEY, t, message, formatMessage, LocalizedError } from './i18n.js';

const reset = () => { locale.value = 'zh-CN'; localePreference.value = 'auto'; };
const placeholders = text => [...new Set(text.match(/\{\w+\}/g) || [])].sort();

test('translation dictionaries contain no duplicate literal keys', () => {
  const source = readFileSync(new URL('locales.js', import.meta.url), 'utf8');
  const syntax = babelParse(source, { sourceType: 'module' });
  const declaration = syntax.program.body.flatMap(statement => statement.declaration?.declarations || []).find(item => item.id.name === 'translations');
  assert.equal(declaration.init.type, 'ObjectExpression');
  const keys = new Set();
  for (const property of declaration.init.properties) {
    if (property.computed) continue;
    const key = String(property.key.value ?? property.key.name);
    assert.ok(!keys.has(key), `Duplicate translation key: ${key}`);
    keys.add(key);
  }
});

test('branch empty-state labels omit terminal punctuation in every language', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  assert.equal([...descriptor.template.content.matchAll(/t\('暂无分歧'\)/g)].length, 1);
  assert.doesNotMatch(descriptor.template.content, /暂无分歧。/);
  try {
    for (const language of languages) {
      locale.value = language.code;
      assert.doesNotMatch(t('暂无分歧'), /[.。]$/);
    }
  } finally { reset(); }
});

test('page titles and SEO metadata follow initialization and every language switch', () => {
  const elements = new Map();
  const structuredData = { textContent: JSON.stringify({ '@type': 'WebApplication', name: 'DonKanvas', url: 'https://ourtaiko.github.io/web-tja-studio/' }) };
  const document = {
    querySelector(selector) {
      if (selector === 'script[type="application/ld+json"]') return structuredData;
      if (!elements.has(selector)) elements.set(selector, { setAttribute(name, value) { this[name] = value; } });
      return elements.get(selector);
    }
  };
  const root = { ownerDocument: document };
  const storage = { getItem: () => 'ja', setItem() {} };
  try {
    initializeLocale(storage, ['en'], root);
    assert.equal(document.title, getPageMetadata('ja').title);
    for (const language of languages) {
      setLocale(language.code, storage, root);
      const metadata = getPageMetadata(language.code);
      const productName = { 'zh-CN': '咚咔绘板', 'zh-TW': '咚咔繪板', ja: 'ドンカッボード', ko: '동캇보드', en: 'DonKanvas' }[language.code];
      const displayName = language.code === 'en' ? productName : `${productName} · DonKanvas`;
      assert.equal(metadata.name, productName);
      assert.equal(t('咚咔绘板'), productName);
      assert.equal(metadata.displayName, displayName);
      assert.ok(document.title.startsWith(`${displayName} - `));
      assert.equal([...document.title.matchAll(/DonKanvas/g)].length, 1);
      assert.equal(root.lang, language.code);
      assert.equal(document.title, metadata.title);
      for (const [selector, value] of [
        ['meta[name="application-name"]', productName],
        ['meta[property="og:site_name"]', productName],
        ['meta[name="description"]', metadata.description],
        ['meta[property="og:title"]', metadata.title],
        ['meta[property="og:description"]', metadata.socialDescription],
        ['meta[property="og:image:alt"]', metadata.imageAlt],
        ['meta[name="twitter:title"]', metadata.title],
        ['meta[name="twitter:description"]', metadata.socialDescription],
        ['meta[name="twitter:image:alt"]', metadata.imageAlt]
      ]) assert.equal(elements.get(selector).content, value);
      assert.equal(elements.get('meta[property="og:locale"]').content, { 'zh-CN': 'zh_CN', en: 'en_US', ja: 'ja_JP', 'zh-TW': 'zh_TW', ko: 'ko_KR' }[language.code]);
      const application = JSON.parse(structuredData.textContent);
      assert.equal(application.description, metadata.applicationDescription);
      assert.equal(application.inLanguage, language.code);
      assert.equal(application.name, productName);
      assert.equal(application.alternateName, language.code === 'en' ? undefined : 'DonKanvas');
      assert.equal(Object.hasOwn(application, 'alternateName'), language.code !== 'en');
      assert.equal(application.url, getPageURL(language.code));
      assert.equal(elements.get('link[rel="canonical"]').href, application.url);
      assert.equal(elements.get('meta[property="og:url"]').content, application.url);
    }
    assert.equal(new Set(languages.map(language => getPageMetadata(language.code).title)).size, 5);
    for (const language of languages.filter(item => item.code !== 'zh-CN')) {
      document.location = { pathname: `/web-tja-studio/index.${language.code}.html` };
      initializeLocale(storage, ['en'], root);
      assert.equal(locale.value, language.code);
      assert.equal(document.title, getPageMetadata(language.code).title);
    }
    document.location = { href: 'https://example.com/web-tja-studio/index.ko.html?keep=1#editor', pathname: '/web-tja-studio/index.ko.html' };
    document.defaultView = { history: {
      state: { editor: true },
      replaceState(state, _title, address) {
        assert.deepEqual(state, { editor: true });
        document.location = { href: address.href, pathname: address.pathname };
      }
    } };
    setLocale('ja', storage, root);
    assert.equal(document.location.pathname, '/web-tja-studio/index.ja.html');
    setLocale('auto', storage, root);
    assert.equal(document.location.pathname, '/web-tja-studio/');
    assert.equal(new URL(document.location.href).search, '?keep=1');
    assert.equal(new URL(document.location.href).hash, '#editor');
    initializeLocale({ getItem: () => 'auto' }, ['ja'], root);
    assert.equal(localePreference.value, 'auto');
    assert.equal(locale.value, 'ja');
    assert.equal(document.location.pathname, '/web-tja-studio/');
  } finally { reset(); }
});

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

test('timeline waveform and note gutters have independent masks while audio boundaries stay blank', () => {
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
  for (const landscape of [false, true]) for (const height of [150, 250, 400]) for (const width of [80, 192]) for (const startBeat of [0, 45, 145]) {
    const timelineBrush = brush(), overviewBrush = brush(), beats = 20, longRanges = [];
    const view = { bars: [], startBeat, start: scale.timeAt(startBeat), end: scale.timeAt(startBeat + beats) };
    const timeline = { value: { style: {} } }, overview = { value: {} };
    const state = { chart: { bars: [] }, buffer: { duration: 100 }, peaks: [...Array(500).fill(.25), ...Array(500).fill(.75)], position: -100 };
    const draw = runInNewContext(`${source}; draw`, {
      props: { landscape }, state, timeline, overview, visible: { value: view }, viewportWidth: { value: width }, viewBeats: { value: beats },
      timelineScale: { value: scale }, timelineBounds: { value: { start: 0, end: 100 } },
      spans: { value: [{}] }, drawLongSpan: (brush, span, x, noteY, start, end) => longRanges.push([start, end]), hover: { value: null }, TIMELINE_GUTTER, createTimelineViewport, syncScroll() {}, t: text => text,
      canvasContext: canvas => ({ brush: canvas === timeline.value ? timelineBrush : overviewBrush, width: width + TIMELINE_GUTTER * 2, height })
    });
    draw();
    assert.match(descriptor.styles[0].content, /\.timeline-frame #timeline\{height:235px;/);
    const waveArea = timelineBrush.rectangles.find(rect => rect.color === '#f3f7f2');
    const noteArea = timelineBrush.rectangles.find(rect => rect.color === '#f6f7f3');
    assert.equal(height - noteArea.y - noteArea.height, 16);
    const expectedNoteHeight = landscape ? Math.max(60, (height - 45) / 2) : 60;
    assert.equal(noteArea.height, expectedNoteHeight);
    const center = height - 16 - expectedNoteHeight / 2;
    assert.equal(center - noteArea.y, expectedNoteHeight / 2);
    assert.equal(noteArea.y + noteArea.height - center, expectedNoteHeight / 2);
    if (landscape) assert.ok(waveArea.height <= noteArea.height);
    assert.equal(noteArea.y - (waveArea.y + waveArea.height), 6);
    const waveform = timelineBrush.rectangles.filter(rect => rect.color === '#72a592');
    assert.ok(waveform.every(rect => rect.y >= waveArea.y && rect.y + rect.height <= waveArea.y + waveArea.height));
    const projection = createTimelineViewport(scale, view, beats, width), fullWidth = width + TIMELINE_GUTTER * 2;
    assert.deepEqual(longRanges, [[projection.timeAt(0), projection.timeAt(fullWidth)]]);
    const audiblePixels = Array.from({ length: fullWidth }, (_, x) => x).filter(x => projection.timeAt(x + 1) > 0 && projection.timeAt(x) < 100);
    assert.deepEqual(waveform.map(rect => rect.x), audiblePixels);
    if (startBeat === 45) {
      assert.equal(waveform[0].x, 0); assert.equal(waveform.at(-1).x, fullWidth - 1);
      const amplitude = waveArea.height / 2 - 6;
      assert.equal(waveform[0].height, .25 * amplitude * 2);
      assert.equal(waveform.at(-1).height, .75 * amplitude * 2);
    }
    const masks = timelineBrush.rectangles.filter(rect => rect.color === '#b8b8b880');
    assert.deepEqual(masks.map(rect => [rect.x, rect.y, rect.width, rect.height]), [[0, waveArea.y, 24, waveArea.height], [width + 24, waveArea.y, 24, waveArea.height], [0, noteArea.y, 24, noteArea.height], [width + 24, noteArea.y, 24, noteArea.height]]);
    assert.ok(masks.slice(0, 2).every(rect => rect.y + rect.height < noteArea.y));
    assert.ok(timelineBrush.rectangles.indexOf(masks[0]) > timelineBrush.rectangles.indexOf(waveform.at(-1)));
    state.buffer = null; draw();
    assert.deepEqual(timelineBrush.labels.at(-1), { text: '无伴奏 · 可播放谱面音符音', x: TIMELINE_GUTTER + 14 });
  }
});

test('short timeline canvases scale drawing coordinates without changing overview sizing', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.match(/function canvasContext\(canvas\) \{[\s\S]*?\n\}/)[0];
  const transforms = [], cleared = [];
  const brush = { setTransform(...args) { transforms.push(args); }, clearRect(...args) { cleared.push(args); } };
  const canvas = { getBoundingClientRect: () => ({ width: 320, height: 75 }), getContext: () => brush };
  const timeline = { value: canvas };
  const context = runInNewContext(`${source}; canvasContext`, { timeline, devicePixelRatio: 2 });
  assert.equal(context(canvas).height, 150);
  assert.deepEqual(transforms.at(-1), [2, 0, 0, 1, 0, 0]);
  assert.deepEqual(cleared.at(-1), [0, 0, 320, 150]);
  assert.equal(canvas.height, 150);
  const overview = { ...canvas, getBoundingClientRect: () => ({ width: 320, height: 40 }) };
  assert.equal(context(overview).height, 40);
  assert.deepEqual(transforms.at(-1), [2, 0, 0, 2, 0, 0]);
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
#M
#GOGOEND
#DELAY .25
3000,
#BRANCHEND
#GOGOEND
1000,
#END`;
  for (const route of ['N', 'E', 'M']) {
    const state = { chart: parseChart(text, TJAParser, 0, [route]) }, rectangles = [];
    const before = JSON.stringify(state);
    const brush = { fillRect(x, y, width, height) { rectangles.push({ x, y, width, height, color: this.fillStyle }); } };
    const draw = runInNewContext(`${source}; drawOverviewSections`, { state, measureStart, measureEnd });
    draw(brush, time => (time + 1) * 10, 40);
    const gogo = rectangles.filter(rect => rect.color === '#f46b32').map(({ x, y, width, height }) => [x, y, width, height]);
    const color = { N: '#a3a8ae', E: '#459de0', M: '#e45b99' }[route];
    const branches = rectangles.filter(rect => rect.y === 37);
    assert.deepEqual(gogo, route === 'N' ? [[5, 0, 10, 3], [20, 0, 5, 3], [27.5, 0, 20, 3]] : [[5, 0, 10, 3], [20, 0, 5, 3]]);
    assert.deepEqual(branches, [{ x: 25, y: 37, width: 22.5, height: 3, color }]);
    assert.equal(JSON.stringify(state), before);
    state.chart.bars = []; rectangles.length = 0;
    draw(brush, time => time, 40);
    assert.deepEqual(rectangles, []);
  }
  assert.match(descriptor.template.content, /v-for="route in BRANCH_ROUTES"[^>]*class="overview-route"[^>]*:title="t\(BRANCH_ROUTE_NAMES\[route\]\)"><i :style="\{ '--overview-legend-color': branchColor\(route\) \}">\{\{ !mobile \|\| landscape \? route : '' \}\}<\/i><span class="overview-legend-label">\{\{ t\(BRANCH_ROUTE_NAMES\[route\]\) \}\}/);
  assert.match(descriptor.template.content, /:class="\{ 'overview-legend-compact': !mobile \|\| landscape \}"/);
  assert.match(descriptor.template.content, /class="gogo">\{\{ !mobile \|\| landscape \? 'G' : '' \}\}/);
  assert.match(descriptor.styles[0].content, /\.overview-legend-compact i\{[^}]*width:18px;height:18px;[^}]*color:#fff;font-style:normal;/);
  assert.match(descriptor.styles[0].content, /\.overview-legend-compact \.overview-legend-label\{display:none\}/);
  assert.doesNotMatch(descriptor.template.content, /t\('分歧段'\)/);
  assert.doesNotMatch(descriptor.scriptSetup.content + descriptor.styles[0].content, /#9270b5/);
});

function touchSelectionHarness() {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('const touchGuide = ref(false);'), script.indexOf('let overviewDrag = null;'));
  const timers = new Map(), moves = [], scrolls = [], captures = new Set(), playback = [], selections = [], pans = [];
  const state = reactive({ chart: { bars: [] }, selectedCell: { bar: 0 }, invalid: false, editorBlocked: false, playing: false, position: 0 });
  const controls = reactive({ snap: 16, snapChoice: '16', customSnap: 16 });
  let now = 0, timerId = 0;
  const target = {
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id)
  };
  const handlers = runInNewContext(`${source}; ({ startTouchSelection, moveTouchSelection, finishTouchSelection, cancelTouchSelection, touchGuide, pointerDown, pointerMove, cancelWaveformHold, controls })`, {
    props: { landscape: false }, ref, watch, state, controls, snaps: SNAP_DIVISIONS, hover: ref(null),
    studio: {
      moveCell: direction => moves.push(direction),
      setSnap: value => { controls.snap = value; controls.customSnap = value; },
      seek: time => { state.position = time; playback.push(['seek', time]); },
      seekMeasure: direction => { state.position += direction * 2; playback.push(['measure', direction]); },
      panTimeline: (time, manual) => { pans.push([time, manual]); if (manual) state.followPlayback = false; },
      play: time => { state.position = time; state.playing = true; playback.push(['play', time]); },
      pause: () => { state.playing = false; playback.push(['pause']); },
      selectCell: position => selections.push(position)
    },
    timeline: ref({ style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 248, height: 250 }) }),
    timelineScale: ref(null), visible: ref(null), viewBeats: ref(8), viewportWidth: ref(200), timelineBounds: ref({ start: 0, end: 20 }), TIMELINE_GUTTER,
    createTimelineViewport: () => ({ hitTest: pixel => ({ time: pixel / 10, item: { index: 0 }, x: time => time * 10 }) }),
    timelineCell: () => ({ numerator: 0, denominator: 4 }),
    viewport: ref({ scrollLeft: 100, scrollTo: options => scrolls.push(options.left), focus() {} }),
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, at: now + delay }); return timerId; },
    clearTimeout: id => timers.delete(id)
  });
  const event = (x = 100, extra = {}) => ({ pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, currentTarget: target, clientX: x, clientY: 100, preventDefault() {}, ...extra });
  const advance = delay => {
    now += delay;
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  };
  return { ...handlers, event, advance, moves, scrolls, captures, state, playback, selections, pans };
}

test('waveform gutter clicks seek and reveal adjacent measures without changing follow mode or activating note editing or long press', () => {
  for (const pointerType of ['mouse', 'pen', 'touch']) for (const follow of [false, true]) {
    const gesture = touchSelectionHarness();
    gesture.state.position = 4; gesture.state.followPlayback = follow; gesture.state.playing = true;
    for (const [pixel, direction] of [[6, -1], [230, 1]]) {
      const event = gesture.event(pixel, { pointerType });
      gesture.pointerDown(event); gesture.advance(500); gesture.finishTouchSelection(event);
      assert.deepEqual(gesture.playback.at(-1), ['measure', direction]);
    }
    assert.deepEqual(gesture.playback, [['pause'], ['measure', -1], ['pause'], ['measure', 1]]);
    assert.deepEqual(gesture.pans, [[2, false], [4, false]]);
    assert.equal(gesture.state.followPlayback, follow);
    assert.equal(gesture.state.playing, false); assert.deepEqual(gesture.selections, []);
    assert.equal(gesture.touchGuide.value, false); assert.equal(gesture.captures.size, 0);
  }
});

test('timeline header clicks retain simple seeking without note selection or playback holds', () => {
  const gesture = touchSelectionHarness(), event = gesture.event(100, { pointerType: 'mouse', clientY: 15 });
  gesture.pointerDown(event); gesture.advance(500); gesture.finishTouchSelection(event);
  assert.deepEqual(gesture.playback, [['seek', 10]]); assert.deepEqual(gesture.selections, []);
  assert.equal(gesture.captures.size, 0);
});

test('waveform taps pause and seek without restarting playback', () => {
  for (const pointerType of ['mouse', 'touch']) for (const playing of [false, true]) {
    const gesture = touchSelectionHarness(), event = gesture.event(100, { pointerType });
    gesture.state.playing = playing;
    gesture.pointerDown(event); gesture.advance(200); gesture.finishTouchSelection(event); gesture.advance(500);
    assert.deepEqual(gesture.playback, [['pause'], ['seek', 10]]);
    assert.equal(gesture.state.playing, false); assert.equal(gesture.state.position, 10);
    assert.deepEqual(gesture.selections, []); assert.equal(gesture.captures.size, 0);
  }
});

test('waveform holds always start playback once at the pressed time for mouse and touch', () => {
  for (const pointerType of ['mouse', 'touch']) for (const playing of [false, true]) {
    const gesture = touchSelectionHarness(), event = gesture.event(100, { pointerType });
    gesture.state.playing = playing;
    gesture.pointerDown(event); assert.deepEqual(gesture.playback, [['pause'], ['seek', 10]]);
    gesture.advance(449); assert.equal(gesture.state.playing, false);
    gesture.advance(1); assert.deepEqual(gesture.playback.at(-1), ['play', 10]);
    gesture.advance(1000); assert.equal(gesture.playback.length, 3);
    gesture.finishTouchSelection(event);
    gesture.pointerDown(gesture.event(120, { pointerType })); assert.equal(gesture.state.playing, false);
    gesture.advance(450);
    assert.deepEqual(gesture.playback.slice(-3), [['pause'], ['seek', 12], ['play', 12]]);
    assert.equal(gesture.state.playing, true); assert.equal(gesture.state.position, 12);
    gesture.finishTouchSelection(event); assert.equal(gesture.captures.size, 0);
    assert.deepEqual(gesture.selections, []); assert.equal(gesture.touchGuide.value, false);
  }
});

test('waveform holds cancel on release, drag, context changes and invalid editing states', () => {
  for (const pointerType of ['mouse', 'touch']) {
    for (const reason of ['release', 'drag', 'activeId', 'course', 'chart', 'invalid', 'editorBlocked']) {
      const gesture = touchSelectionHarness(), event = gesture.event(100, { pointerType });
      gesture.pointerDown(event);
      if (reason === 'release') gesture.finishTouchSelection(event);
      else if (reason === 'drag') gesture.pointerMove(gesture.event(120, { pointerType }));
      else gesture.state[reason] = reason === 'chart' ? { bars: [] } : true;
      gesture.advance(500); assert.deepEqual(gesture.playback, [['pause'], ['seek', 10]], `${pointerType}: ${reason}`);
      if (reason === 'drag' && pointerType === 'touch') assert.deepEqual(gesture.scrolls, [80]);
      gesture.finishTouchSelection(event); assert.equal(gesture.captures.size, 0);
    }
  }
  const gesture = touchSelectionHarness();
  gesture.pointerDown(gesture.event(100, { pointerType: 'mouse', button: 2 })); gesture.advance(500);
  assert.deepEqual(gesture.playback, []);
});

test('touch long press guides selection and converts horizontal distance to reversible A/D steps', () => {
  const touch = touchSelectionHarness();
  touch.startTouchSelection(touch.event(), true);
  touch.advance(449); assert.equal(touch.touchGuide.value, false);
  touch.advance(1); assert.equal(touch.touchGuide.value, true);
  touch.moveTouchSelection(touch.event(123)); assert.deepEqual(touch.moves, []);
  touch.moveTouchSelection(touch.event(124)); assert.deepEqual(touch.moves, [1]);
  touch.moveTouchSelection(touch.event(172)); assert.deepEqual(touch.moves, [1, 1, 1]);
  touch.moveTouchSelection(touch.event(124)); assert.deepEqual(touch.moves, [1, 1, 1, -1, -1]);
  assert.deepEqual(touch.scrolls, []);
  touch.finishTouchSelection(touch.event(124, { pointerId: 2 }));
  assert.equal(touch.touchGuide.value, true);
  touch.finishTouchSelection(touch.event(124));
  assert.equal(touch.touchGuide.value, false); assert.equal(touch.captures.size, 0);
  touch.moveTouchSelection(touch.event(196)); assert.equal(touch.moves.length, 5);
});

test('touch long press adjusts grids vertically and locks one axis until release', () => {
  const touch = touchSelectionHarness();
  touch.startTouchSelection(touch.event(), true); touch.advance(450);
  touch.moveTouchSelection(touch.event(110, { clientY: 53 }));
  assert.equal(touch.controls.snap, 16);
  touch.moveTouchSelection(touch.event(110, { clientY: 52 }));
  assert.equal(touch.controls.snap, 24);
  assert.equal(touch.controls.snapChoice, '24');
  touch.moveTouchSelection(touch.event(220, { clientY: -44 }));
  assert.equal(touch.controls.snap, 48);
  assert.deepEqual(touch.moves, []);
  touch.moveTouchSelection(touch.event(220, { clientY: 100 }));
  assert.equal(touch.controls.snap, 16);
  touch.finishTouchSelection(touch.event());
  touch.startTouchSelection(touch.event(), true); touch.advance(450);
  touch.moveTouchSelection(touch.event(124, { clientY: 110 }));
  touch.moveTouchSelection(touch.event(148, { clientY: 220 }));
  assert.deepEqual(touch.moves, [1, 1]);
  assert.equal(touch.controls.snap, 16);
});

test('touch grid adjustment supports custom grids and clamps at shortcut limits', () => {
  const touch = touchSelectionHarness();
  touch.controls.snap = 7;
  touch.startTouchSelection(touch.event(), true); touch.advance(450);
  touch.moveTouchSelection(touch.event(100, { clientY: 52 }));
  assert.equal(touch.controls.snap, 8);
  touch.moveTouchSelection(touch.event(100, { clientY: -908 }));
  assert.equal(touch.controls.snap, 128);
  assert.equal(touch.controls.snapChoice, '128');
  assert.equal(touch.controls.customSnap, 128);
  touch.controls.snap = 200;
  touch.moveTouchSelection(touch.event(100, { clientY: -956 }));
  assert.equal(touch.controls.snap, 128);
  touch.moveTouchSelection(touch.event(100, { clientY: 532 }));
  assert.equal(touch.controls.snap, 1);
  assert.equal(touch.controls.snapChoice, 'custom');
  assert.equal(touch.controls.customSnap, 1);
  assert.deepEqual(touch.moves, []);
});

test('ordinary touch swipes browse without activating selection adjustment and canceled holds stay inactive', () => {
  const touch = touchSelectionHarness();
  touch.startTouchSelection(touch.event(), true);
  touch.moveTouchSelection(touch.event(80)); touch.advance(500);
  assert.equal(touch.touchGuide.value, false); assert.deepEqual(touch.moves, []);
  assert.deepEqual(touch.scrolls, [120]);
  touch.cancelTouchSelection();
  touch.startTouchSelection(touch.event(), false); touch.advance(500);
  assert.equal(touch.touchGuide.value, false);
  touch.cancelTouchSelection();
  touch.startTouchSelection(touch.event(), true); touch.cancelTouchSelection(); touch.advance(500);
  assert.equal(touch.touchGuide.value, false); assert.equal(touch.captures.size, 0);
  touch.startTouchSelection(touch.event(100, { pointerType: 'mouse' }), true); touch.advance(500);
  assert.equal(touch.touchGuide.value, false); assert.equal(touch.captures.size, 0);
});

test('touch adjustment releases capture when editing is blocked, source becomes invalid or the document changes', () => {
  const touch = touchSelectionHarness();
  for (const [field, value] of [['editorBlocked', true], ['invalid', true], ['activeId', 'another-chart']]) {
    touch.startTouchSelection(touch.event(), true); touch.advance(450);
    assert.equal(touch.touchGuide.value, true);
    touch.state[field] = value;
    assert.equal(touch.touchGuide.value, false); assert.equal(touch.captures.size, 0);
    touch.moveTouchSelection(touch.event(172)); assert.deepEqual(touch.moves, []);
    touch.state[field] = undefined;
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
  assert.ok(descriptor.template.content.includes('<PositionIcon v-if="overviewSelection !== null" class="overview-selection" aria-hidden="true" :style="{ left: `${overviewSelection}%` }" />'));
  const icon = parse(readFileSync(new URL('PositionIcon.vue', import.meta.url), 'utf8')).descriptor;
  compileScript(descriptor, { id: 'shared-position-icon' });
  assert.match(icon.template.content, /<svg[^>]*viewBox="0 0 24 24"[^>]*stroke-width="2"/);
  assert.match(icon.template.content, /<circle cx="12" cy="12" r="9" stroke-dasharray="4 2" stroke-linecap="butt" \/>/);
  assert.match(icon.template.content, /<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" \/>/);
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
    { x: 40, y: 0, width: 40, height: 3, color: '#f46b32' },
    { x: 30, y: 37, width: 50, height: 3, color: '#a3a8ae' }
  ]);
  assert.match(script, /drawOverviewRange\(overviewContext\.brush, overviewX, overviewContext\.height\);\s*drawOverviewSections\(overviewContext\.brush, overviewX, overviewContext\.height\);/);
  rectangles.length = 0;
  draw(brush, time => (time + 1) / 10, 40);
  assert.ok(rectangles.every(rect => rect.x >= .15 - 1e-10 && rect.x + rect.width <= .6 + 1e-10));
  selected.clear(); rectangles.length = 0;
  draw(brush, time => time, 40);
  assert.deepEqual(rectangles, []);
});

test('timeline canvas selection uses its own live grid preview and restores the saved range after cancellation', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const selectionSource = script.slice(script.indexOf('const measurePreview ='), script.indexOf('const viewport ='));
  const drawingSource = script.slice(script.indexOf('function gogoIntervals('), script.indexOf('function draw()'));
  const range = ref(null), rectangles = [];
  const state = { chart: { bars: Array.from({ length: 3 }, (_, index) => ({ index, start: index * 2, end: (index + 1) * 2 })) } };
  const { measurePreview, drawOverviewRange } = runInNewContext(`${selectionSource}\n${drawingSource}; ({ measurePreview, drawOverviewRange })`, {
    ref, range, state, measureStart, measureEnd
  });
  const brush = { fillRect(x, y, width, height) { rectangles.push([x, y, width, height]); } };
  drawOverviewRange(brush, time => time * 10, 40);
  assert.deepEqual(rectangles, []);
  range.value = [2, 2];
  drawOverviewRange(brush, time => time * 10, 40);
  assert.deepEqual(rectangles[0], [20, 0, 20, 40]);
  rectangles.length = 0; measurePreview.value = [1, 3];
  drawOverviewRange(brush, time => time * 10, 40);
  assert.deepEqual(rectangles[0], [0, 0, 60, 40]);
  rectangles.length = 0; measurePreview.value = null;
  drawOverviewRange(brush, time => time * 10, 40);
  assert.deepEqual(rectangles[0], [20, 0, 20, 40]);
  assert.deepEqual(range.value, [2, 2]);
  assert.match(descriptor.template.content, /@preview="measurePreview = \$event"/);
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
  const { descriptor: app } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  assert.match(app.styles[0].content, /\.overview-wave>#overview-hover\{[^}]*width:max-content;max-width:100%/);
  assert.match(app.styles[0].content, /\.overview-wave>#overview-hover\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
});

test('overview dragging pans continuously without seeking or changing selections, while a tap still navigates', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'overview-drag' });
  const script = descriptor.scriptSetup.content;
  const start = script.indexOf('let overviewDrag =');
  const source = script.slice(start, script.indexOf('\nwatch(() => [state.activeId', start));
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
  assert.match(descriptor.template.content, /<\/canvas><\/div><\/div><div v-if="touchGuide" class="touch-selection-guide"[^>]*><ChevronsLeft[^>]*\/><span[^>]*class="touch-grid-guide"><ChevronsUp[^>]*\/><output>\{\{ controls.snap \}\}[\s\S]*?<ChevronsDown[^>]*\/><\/span><ChevronsRight[^>]*\/><\/div><\/div>\s*<section class="overview">[\s\S]*?<\/section>\s*<div class="editor-information">\s*<div class="editor-information-left">\s*<Teleport[^>]*>\s*<section class="cell-inspector"/);
  assert.match(descriptor.styles[0].content, /\.timeline-frame #timeline\{[^}]*touch-action:none/);
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
  assert.match(overviewTemplate, /<div class="overview-caption"><span class="overview-legend"[^>]*>[\s\S]*?<\/span><span id="overview-range">[\s\S]*?<\/span><\/div>\s*<div class="overview-wave">[\s\S]*?id="overview-hover"[\s\S]*?<canvas id="overview"/);
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
  assert.match(descriptor.styles[0].content, /\.chart-tabs-content\{[^}]*min-height:30px/);
  assert.match(descriptor.styles[0].content, /\.chart-tab button\{[^}]*min-height:28px;padding:3px 8px;font-size:11px;line-height:16px;/);
  assert.match(descriptor.styles[0].content, /\.chart-tabs \.new-chart-tab\{width:30px;min-width:30px;min-height:30px;/);
  assert.match(descriptor.template.content, /<section v-if="studio.bar.value" class="document-toolbar">/);
  assert.doesNotMatch(descriptor.template.content, /id="notice"/);
});

test('unsaved chart closing uses a cancel-first modal with the shared close request', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'close-chart-modal' });
  const dialog = descriptor.template.content.match(/<dialog ref="closeChartDialog"[\s\S]*?<\/dialog>/)[0];
  assert.match(dialog, /aria-labelledby="close-chart-title" aria-describedby="close-chart-message"/);
  assert.match(dialog, /@close="state.closeRequest = null"/);
  assert.match(dialog, /closeDialogOnEscape\(\$event, closeChartDialog\)/);
  assert.match(dialog, /autofocus @click="closeChartDialog.close\(\)"/);
  assert.match(dialog, /class="danger-action" @click="confirmCloseChart"/);
  assert.match(descriptor.scriptSetup.content, /studio.closeChart\(state.closeRequest.id, true\)/);
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
  assert.doesNotMatch(styles, /\.chart-tabs\{[^}]*position:sticky/);
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
  assert.match(project, /<p>{{ productMetadata.displayName }}<\/p>/);
  assert.match(header, /:alt="productMetadata.name"/);
  const links = [...project.matchAll(/<a\b([^>]*)>/g)].map(match => match[1]);
  assert.equal(links.length, 4);
  for (const [index, url] of ['https://github.com/OurTaiko/DonKanvas', 'https://github.com/OurTaiko', 'https://github.com/OurTaiko/DonKanvas/blob/HEAD/LICENSE'].entries()) {
    assert.ok(links[index].includes(`href="${url}"`));
    assert.match(links[index], /target="_blank"/);
    assert.match(links[index], /rel="noopener noreferrer"/);
  }
  assert.match(links[3], /getIntroPath\(locale\)/);
  assert.match(links[3], /target="_blank"/);
  assert.match(links[3], /rel="noopener noreferrer"/);
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
  refs.compactTransport = { value: false };
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
  let worker = { state: 'installed' }, failure = null, installed = 0, disposed, registration = null, resolveRegistration;
  const source = readFileSync(new URL('pwa.js', import.meta.url), 'utf8').match(/export function usePwaUpdates\(studio\) \{[\s\S]*?\n\}/)[0]
    .replace('export function', 'function')
    .replaceAll('import.meta.env.DEV', 'false').replaceAll('import.meta.env.BASE_URL', "'./'");
  const createUpdates = runInNewContext(`(${source})`, {
    ref: value => ({ value }), shallowRef: value => ({ value }), onUnmounted: callback => { disposed = callback; },
    navigator: { serviceWorker: {} }, location: { href: 'https://example.com/web-tja-studio/' }, URL, message, LocalizedError, t, confirm: () => true,
    waitForPwaRegistration: async (_container, scope) => { assert.equal(scope, 'https://example.com/web-tja-studio/'); return registration ?? {}; },
    checkPwaUpdate: async () => { if (failure) throw failure; return worker; },
    activatePwaUpdate: async () => { installed++; }
  });
  const refs = createUpdates({ state: { documents: [] }, reloadForUpdate: () => true });
  const { checkUpdate } = refs;
  await checkUpdate(true);
  assert.equal(refs.pendingUpdate.value, worker); assert.equal(refs.updateVisible.value, true); assert.equal(installed, 0);
  refs.updateVisible.value = false; await checkUpdate(false); assert.equal(installed, 1);
  refs.pendingUpdate.value = null; refs.updateVisible.value = false; worker = null;
  await checkUpdate(true); assert.equal(refs.updateVisible.value, false);
  await checkUpdate(false); assert.equal(refs.updateNotice.value.key, '已经是最新版本。');
  failure = new Error('Offline'); await checkUpdate(true);
  assert.equal(refs.updateVisible.value, true); assert.equal(refs.updateError.value, true);
  assert.equal(refs.updateNotice.value.key, '检测或安装更新失败：{p0}');
  failure = null; worker = { state: 'installed' }; refs.updateVisible.value = false;
  registration = new Promise(resolve => { resolveRegistration = resolve; });
  const pending = checkUpdate(true);
  disposed(); resolveRegistration({});
  await pending;
  assert.equal(refs.pendingUpdate.value, null); assert.equal(refs.updateVisible.value, false);
  assert.equal(refs.checkingUpdate.value, false); assert.equal(installed, 1);
  assert.match(script, /usePwaUpdates\(studio\)/);
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
  for (const keys of ['Ctrl+Alt+N', 'Ctrl+O', 'Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+Alt+W', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Space', '1–9', '- / =', '0 / Delete / Backspace', 'A / D', 'W / S', 'Q / E', '← / →', 'Esc', 'PageUp / PageDown', 'Home / End']) assert.ok(descriptor.scriptSetup.content.includes(`'${keys}'`), keys);
  assert.doesNotMatch(descriptor.scriptSetup.content, /\['F',|Shift\+F/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /'A \/ B'/);
  const { descriptor: measure } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  const palette = measure.template.content.match(/<div id="palette"[\s\S]*?<\/div>/)[0];
  assert.equal(palette.split('type.shortcut ?? type.value').length - 1, 3);
  assert.match(palette, /:data-value="type.value"/);
  assert.match(palette, /@click="studio.chooseNote\(type.value\)"/);
  assert.match(help, /音符操作需先选中位置/);
  assert.match(help, /macOS：文件/);
});

test('global navigation removes the endpoint marker workflow and cancels ranges on double click', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'keyboard-loop-selection' });
  assert.doesNotMatch(descriptor.scriptSetup.content + descriptor.template.content, /loopAnchor|markLoop|anchor-index/);
  assert.match(descriptor.template.content, /@toggle="range && studio.clearLoop\(\)"/);
  assert.doesNotMatch(descriptor.template.content, /measure-loop-range|measure-loop-hint|循环范围：第|单击跳转，拖动或按两次 F/);
  const grid = parse(readFileSync(new URL('MeasureGrid.vue', import.meta.url), 'utf8')).descriptor;
  assert.doesNotMatch(grid.scriptSetup.content + grid.template.content + grid.styles[0].content, /anchorIndex|loop-anchor/);
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
  assert.match(transport, /<\/details>\s*<button id="open-audio"[\s\S]*?<\/button>\s*<\/div><\/details><\/section>/);
  assert.match(descriptor.styles[0].content, /\.compact-playback \.transport-right\{[^}]*position:absolute;[^}]*overflow:auto/);
});

test('audio messages dismiss per document and hide after loading while new errors remain visible', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('const dismissedAudioMessages ='), script.indexOf('let desktopWorkspaceOpen'));
  const state = reactive({ activeId: null, chart: null, buffer: null, error: false, noticeMessage: 'ready' });
  const result = runInNewContext(`${source}; ({ showAudioMessage, messageBarError, dismissMessageBar })`, {
    ref, computed, watch, state
  });
  assert.equal(result.showAudioMessage.value, false);
  state.activeId = 'first'; state.chart = {};
  assert.equal(result.showAudioMessage.value, true);
  result.dismissMessageBar(); assert.equal(result.showAudioMessage.value, false);
  state.noticeMessage = 'saved'; assert.equal(result.showAudioMessage.value, false);
  state.activeId = 'second'; assert.equal(result.showAudioMessage.value, true);
  state.buffer = {}; assert.equal(result.showAudioMessage.value, false);
  state.buffer = null; assert.equal(result.showAudioMessage.value, true);
  state.activeId = 'first'; assert.equal(result.showAudioMessage.value, false);
  state.error = true; state.noticeMessage = 'failed';
  assert.equal(result.messageBarError.value, true);
  result.dismissMessageBar();
  assert.equal(result.messageBarError.value, false); assert.equal(state.error, true);
  state.noticeMessage = 'another failure'; assert.equal(result.messageBarError.value, true);
  state.error = false; assert.equal(result.messageBarError.value, false);
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
    const { descriptor } = parse(readFileSync(new URL('DocumentTitle.vue', import.meta.url), 'utf8'));
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
  assert.match(branches.styles[0].content, /\.route-segments label:hover input:not\(:disabled\):not\(:checked\)\+span\{background:#d0e2d7;color:#125d49\}/);
  assert.match(branches.styles[0].content, /\.route-segments label:hover input:checked:not\(:disabled\)\+span\{background:#125d49\}/);
  const chart = readFileSync(new URL('chart.js', import.meta.url), 'utf8');
  assert.match(chart, /BRANCH_ROUTES = \['N', 'E', 'M'\]/);
  assert.match(chart, /BRANCH_ROUTE_NAMES = \{ N: '普通', E: '玄人', M: '达人' \}/);
});

test('the selection menu owns measure and note operations; playback has no independent loop switch or range inputs', async () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'clear-loop-action' });
  const menu = descriptor.template.content.match(/<details ref="selectionMenu"[\s\S]*?<\/details>/)[0];
  const expectedIcons = ['SquareMousePointer', 'ListChecks', 'TextCursorInput', 'SquareDashed', 'ArrowLeftToLine', 'ArrowLeft', 'ArrowRight', 'LocateFixed', 'CircleOff'];
  const buttons = [...menu.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(match => match[0]);
  assert.deepEqual(buttons.map(button => button.match(/<([A-Z]\w*) aria-hidden="true"\s*\/>/)[1]), expectedIcons);
  const icons = await import('@lucide/vue');
  for (const name of expectedIcons) assert.ok(icons[name], `${name} must be an available Lucide icon`);
  assert.match(menu, /studio.setLoop\(state.selected \+ 1, state.selected \+ 1\)/);
  assert.match(menu, /studio.setLoop\(1, state.chart.bars.length\)/);
  assert.doesNotMatch(menu, /markLoop|Shift\+F/);
  assert.match(menu, /runSelectionAction\(studio.clearLoop\)/);
  assert.match(menu, /studio.selectAdjacentNote\(-1\)/); assert.match(menu, /studio.selectAdjacentNote\(1\)/);
  assert.match(menu, /runSelectionAction\(studio.clearNoteSelection\)/);
  assert.doesNotMatch(descriptor.template.content, /id="loop"|id="loop-first"|id="loop-last"|controls.loop/);
  assert.match(menu, /双击全局导航中的小节取消选择/);
});

test('shared measure grids preview and commit pointer ranges without consuming ordinary clicks or selecting another grid', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureGrid.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'measure-loop-selection' });
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('let suppressMeasureClick = false;'), script.indexOf('\nwatch(() => [props.bars'));
  const props = { disabled: false }, measureDrag = { value: null }, writes = [], captured = new Set();
  const buttons = Array.from({ length: 4 }, (_, index) => {
    const button = { dataset: { measureIndex: String(index) }, setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id) };
    button.closest = () => button;
    return button;
  });
  let hit = buttons[0];
  const handlers = runInNewContext(`${source}; ({ startDrag, moveDrag, cancelDrag, finishDrag, keydown, captureClick })`, {
    props, measureDrag, measures: { value: { contains: button => buttons.includes(button) } },
    document: { elementFromPoint: () => hit }, emit: (name, ...args) => { assert.equal(name, 'select'); writes.push(args); }
  });
  const event = overrides => ({ isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0, target: hit, ...overrides });
  const drag = (first, last, distance = 20) => {
    hit = buttons[first]; handlers.startDrag(event());
    hit = buttons[last]; handlers.moveDrag(event({ clientX: distance }));
  };
  handlers.startDrag(event({ isPrimary: false })); assert.equal(measureDrag.value, null);
  handlers.startDrag(event({ button: 2 })); assert.equal(measureDrag.value, null);
  props.disabled = true; handlers.startDrag(event()); assert.equal(measureDrag.value, null); props.disabled = false;
  buttons[0].disabled = true; handlers.startDrag(event()); assert.equal(measureDrag.value, null); buttons[0].disabled = false;
  hit = { disabled: false, closest() { return this; } };
  handlers.startDrag(event()); assert.equal(measureDrag.value, null);
  drag(0, 3);
  assert.equal(measureDrag.value.end, 3); assert.equal(measureDrag.value.dragged, true); assert.equal(writes.length, 0);
  handlers.finishDrag(event({ clientX: 20 }));
  assert.deepEqual(writes.at(-1), [1, 4]); assert.equal(measureDrag.value, null); assert.equal(captured.size, 0);
  let prevented = 0, stopped = 0;
  const click = { detail: 1, preventDefault: () => prevented++, stopPropagation: () => stopped++ };
  handlers.captureClick(click); assert.equal(prevented, 1); assert.equal(stopped, 1);
  handlers.captureClick(click); assert.equal(prevented, 1);
  drag(3, 0); handlers.finishDrag(event({ clientX: 20 })); assert.deepEqual(writes.at(-1), [1, 4]);
  drag(2, 2, 6); handlers.finishDrag(event({ clientX: 6 })); assert.deepEqual(writes.at(-1), [3, 3]);
  const count = writes.length;
  drag(1, 1, 4); handlers.finishDrag(event({ clientX: 4 })); assert.equal(writes.length, count);
  handlers.captureClick(click); assert.equal(prevented, 1);
  drag(1, 3);
  handlers.keydown({ key: 'Escape', preventDefault: () => prevented++, stopPropagation: () => stopped++ });
  assert.equal(measureDrag.value, null); assert.equal(writes.length, count); assert.equal(captured.size, 0);
  handlers.captureClick({ ...click, detail: 0 }); assert.equal(prevented, 2);
  drag(2, 3);
  handlers.cancelDrag(event({ pointerId: 2 })); assert.notEqual(measureDrag.value, null);
  handlers.cancelDrag(event()); assert.equal(measureDrag.value, null); assert.equal(writes.length, count);
  drag(0, 2); hit = null;
  handlers.finishDrag(event({ clientX: 100 })); assert.deepEqual(writes.at(-1), [1, 3]);
  assert.match(script, /watch\(\(\) => \[props.bars, props.disabled\], \(\) => \{ lastTouchTap = null; cancelDrag\(\); \}, \{ flush: 'sync' \}\)/);
  assert.match(descriptor.template.content, /@pointercancel="cancelDrag" @lostpointercapture="cancelDrag"/);
  assert.match(descriptor.template.content, /@click.capture="captureClick"/);
  assert.match(descriptor.template.content, /:data-measure-index="item.index"/);
  assert.match(descriptor.template.content, /@click="viewMeasure\(\$event, item.index\)"/);
});

test('shared grid recognizes desktop and touch double clicks without duplicate, drag or canceled activations', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureGrid.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('let suppressMeasureClick = false;'), script.indexOf('\nwatch(() => [props.bars'));
  const captured = new Set(), writes = [], measureDrag = { value: null };
  const buttons = Array.from({ length: 3 }, (_, index) => {
    const button = { dataset: { measureIndex: String(index) }, setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id) };
    button.closest = () => button;
    return button;
  });
  let hit = buttons[0];
  const props = { disabled: false, bars: Array(3).fill({}), unavailable: () => false };
  const handlers = runInNewContext(`${source}; ({ startDrag, finishDrag, cancelDrag, doubleClick, captureClick })`, {
    props, measureDrag, measures: { value: { contains: button => buttons.includes(button) } },
    document: { elementFromPoint: () => hit }, emit: (name, ...args) => writes.push([name, ...args])
  });
  const event = (time, extra = {}) => ({ isPrimary: true, button: 0, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, timeStamp: time, target: hit, ...extra });
  function tap(index, time, duration = 30) {
    hit = buttons[index]; handlers.startDrag(event(time)); handlers.finishDrag(event(time + duration));
  }
  tap(0, 0); assert.equal(writes.length, 0);
  tap(0, 150); assert.deepEqual(writes, [['toggle', 0]]);
  handlers.doubleClick(event(200), 0); assert.equal(writes.length, 1);
  let prevented = false;
  handlers.captureClick({ detail: 1, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true);
  handlers.doubleClick(event(900, { pointerType: 'mouse' }), 2);
  assert.deepEqual(writes.at(-1), ['toggle', 2]);
  const count = writes.length;
  tap(0, 1200); tap(1, 1350); assert.equal(writes.length, count);
  tap(1, 1800); assert.equal(writes.length, count);
  tap(1, 2300, 400); tap(1, 2750); assert.equal(writes.length, count);
  hit = buttons[1]; handlers.startDrag(event(2900)); handlers.cancelDrag(event(2930));
  tap(1, 3000); assert.equal(writes.length, count);
  hit = buttons[1]; handlers.startDrag(event(3200)); hit = buttons[2]; handlers.finishDrag(event(3230, { clientX: 30 }));
  assert.deepEqual(writes.at(-1), ['select', 2, 3]);
  tap(2, 3300); assert.equal(writes.at(-1)[0], 'select');
  props.disabled = true; handlers.doubleClick(event(5000, { pointerType: 'mouse' }), 0);
  assert.equal(writes.at(-1)[0], 'select');
  props.disabled = false; props.unavailable = () => true;
  handlers.doubleClick(event(5500, { pointerType: 'mouse' }), 0);
  assert.equal(writes.at(-1)[0], 'select');
  assert.equal(captured.size, 0);
});

test('shared grid publishes transient Canvas previews and clears them without changing the saved selection', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureGrid.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('const dragSelection ='), script.indexOf('function viewMeasure('));
  const props = reactive({ selection: [2, 2] }), measureDrag = ref(null), previews = [], stops = [];
  try {
    const { measureSelection } = runInNewContext(`${source}; ({ measureSelection })`, {
      props, measureDrag, computed,
      emit: (name, selection) => { assert.equal(name, 'preview'); previews.push(selection); },
      watch: (...args) => { const stop = watch(...args); stops.push(stop); return stop; }
    });
    measureDrag.value = { start: 2, end: 0, dragged: false };
    assert.equal(previews.length, 0);
    measureDrag.value.dragged = true;
    assert.deepEqual([...previews.at(-1)], [1, 3]);
    assert.deepEqual([...measureSelection.value], [1, 3]);
    measureDrag.value = null;
    assert.equal(previews.at(-1), null);
    assert.deepEqual([...measureSelection.value], [2, 2]);
    assert.deepEqual([...props.selection], [2, 2]);
  } finally { for (const stop of stops) stop(); }
});

test('Shift-click chooses an inclusive range from the viewed measure or selection without navigating', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureGrid.vue', import.meta.url), 'utf8'));
  const props = { activeIndex: 2, bars: Array(4).fill({}), unavailable: () => false }, ranges = [], views = [];
  const viewMeasure = runInNewContext(`(${descriptor.scriptSetup.content.match(/function viewMeasure\(event, index\) \{[\s\S]*?\n\}/)[0]})`, {
    props, emit: (name, ...args) => name === 'select' ? ranges.push(args) : views.push(...args)
  });
  viewMeasure({ shiftKey: false }, 1); assert.deepEqual(views, [1]); assert.equal(ranges.length, 0);
  viewMeasure({ shiftKey: true }, 0); assert.deepEqual(ranges.at(-1), [1, 3]); assert.deepEqual(views, [1]);
  props.activeIndex = 1;
  viewMeasure({ shiftKey: true }, 3); assert.deepEqual(ranges.at(-1), [2, 4]);
  assert.match(descriptor.template.content, /:aria-pressed="measureSelected\(item.index\)"/);
  props.activeIndex = null; props.selection = [2, 3];
  viewMeasure({ shiftKey: true }, 0); assert.deepEqual(ranges.at(-1), [1, 2]);
  props.unavailable = () => true;
  viewMeasure({ shiftKey: true }, 3); viewMeasure({ shiftKey: false }, 0);
  assert.equal(ranges.length, 3); assert.deepEqual(views, [1]);
  assert.match(descriptor.template.content, /:aria-current="item.index === props.activeIndex \? 'location' : undefined"/);
  assert.doesNotMatch(descriptor.template.content + descriptor.styles[0].content, /note-selected/);
});

test('global navigation double clicks clear any range but never select a new range', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const range = ref([2, 3]), ranges = [];
  let cleared = 0;
  const clearBinding = descriptor.template.content.match(/<MeasureGrid id="measures"[^>]*@toggle="([^"]+)"/)[1];
  const toggle = runInNewContext(`() => { ${clearBinding} }`, {
    get range() { return range.value; }, studio: { clearLoop: () => cleared++, setLoop: (...args) => ranges.push(args) }
  });
  toggle(1); assert.equal(cleared, 1); assert.equal(ranges.length, 0);
  toggle(3); assert.equal(cleared, 2); assert.equal(ranges.length, 0);
  range.value = null; toggle(0); assert.equal(cleared, 2); assert.equal(ranges.length, 0);
  assert.match(descriptor.template.content, /<MeasureGrid[^>]*:selection="range"[^>]*:active-index="selectedTiming\?\.bar.index \?\? null"[^>]*:note-index="state.selectedCell\?\.bar"[^>]*@activate="studio.select" @select="studio.setLoop" @toggle="range && studio.clearLoop\(\)"/);
  const binding = descriptor.template.content.match(/<MeasureGrid id="measures"[^>]*:active-index="([^"]+)"/)[1];
  const context = { selectedTiming: null, state: { selected: 2, position: 6, viewStart: 4 } };
  const activeIndex = runInNewContext(`() => (${binding})`, context);
  assert.equal(activeIndex(), null);
  context.selectedTiming = { bar: { index: 0 } };
  assert.equal(activeIndex(), 0);
  context.state.selected = 3; context.state.position = 8; context.state.viewStart = 6;
  assert.equal(activeIndex(), 0);
  context.selectedTiming = { bar: { index: 1 } };
  assert.equal(activeIndex(), 1);
  context.selectedTiming = null;
  assert.equal(activeIndex(), null);
});

test('navigation marks only measures intersecting the viewport independently of the selected point', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.slice(descriptor.scriptSetup.content.indexOf('const visibleMeasureIndices ='), descriptor.scriptSetup.content.indexOf('const deleteDialog ='));
  const bars = Array.from({ length: 4 }, (_, index) => ({ index, start: index * 2, end: (index + 1) * 2 }));
  const visible = ref(null);
  const indices = runInNewContext(`${source}; visibleMeasureIndices`, { computed, visible, measureStart: item => item.start, measureEnd: item => item.end });
  assert.deepEqual(Array.from(indices.value), []);
  visible.value = { bars, start: 2, end: 6 };
  assert.deepEqual(Array.from(indices.value), [1, 2]);
  visible.value = { bars, start: 1, end: 3 };
  assert.deepEqual(Array.from(indices.value), [0, 1]);
  visible.value = { bars, start: 6, end: 10 };
  assert.deepEqual(Array.from(indices.value), [3]);
  assert.match(descriptor.template.content, /:visible-indices="visibleMeasureIndices"/);
  const grid = parse(readFileSync(new URL('MeasureGrid.vue', import.meta.url), 'utf8')).descriptor;
  assert.match(grid.template.content, /'in-view': props.visibleIndices.includes\(item.index\)/);
  assert.match(grid.template.content, /t\('当前视图内的小节'\)/);
  assert.doesNotMatch(grid.styles[0].content, /in-view::before/);
  assert.match(grid.styles[0].content, /\.measure-grid \.mini-notes\{width:40px;max-width:100%;justify-content:center;gap:1px;overflow:visible\}/);
  assert.match(grid.styles[0].content, /grid-template-columns:repeat\(auto-fill,minmax\(56px,1fr\)\)/);
  assert.match(grid.styles[0].content, /\.measure-grid button\{padding:7px\}/);
  assert.match(grid.styles[0].content, /\.measure-grid \.mini-notes i\{width:3px;min-width:3px;flex:0 0 3px\}/);
  assert.match(grid.styles[0].content, /\.measure-grid button.active\{background:#fff;border-color:var\(--line\);color:inherit\}/);
  assert.match(grid.styles[0].content, /\.measure-grid button.active \.mini-notes,\.measure-grid button.in-view \.mini-notes\{background:#e3edf3;box-shadow:0 0 0 4px #e3edf3;border-radius:2px\}/);
});

test('mini notes distinguish percussion, rolls, balloons and special rolls', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureGrid.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'mini-note-types' });
  const binding = descriptor.template.content.match(/<i v-for=[\s\S]*?:class="([^"]+)"/)[1];
  for (const [notes, expected] of [['13A', []], ['24B', ['blue']], ['56', ['roll']], ['7', ['balloon']], ['9', ['special']]]) {
    for (const note of notes) {
      const classes = runInNewContext(`(${binding})`, { note });
      assert.deepEqual(Object.keys(classes).filter(key => classes[key]), expected);
    }
  }
  assert.match(descriptor.template.content, /:title="t\(NOTE_TYPES.find\(type => type.value === note\).name\)"/);
  for (const [type, color] of [['roll', '#e6b800'], ['balloon', '#f07800'], ['special', '#ff78ae']]) {
    assert.ok(descriptor.styles[0].content.includes(`.mini-notes i.${type}{background:${color}}`));
  }
});

test('mini notes omit ends and show carried rolls and balloons only while their spans overlap the measure', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureGrid.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('const miniNotes ='), script.indexOf('const emit ='));
  const props = reactive({ bars: [] });
  const notes = runInNewContext(`${source}; miniNotes`, { computed, props, longNoteSpans, measureStart });
  const chart = body => parseChart(`TITLE:Mini notes\nBPM:120\nCOURSE:Oni\nLEVEL:1\n#START\n${body}\n#END\n`, TJAParser);
  for (const type of ['5', '6', '7', '9']) {
    props.bars = chart(`${type}000,\n0000,\n0080,\n1000,`).bars;
    assert.deepEqual(Array.from(notes.value.values(), value => Array.from(value)), [[type], [type], [type], ['1']]);
    props.bars = chart(`${type}000,\n8000,\n0000,`).bars;
    assert.deepEqual(Array.from(notes.value.values(), value => Array.from(value)), [[type], [], []]);
    props.bars = chart(`${type}000,\n0000,`).bars;
    assert.deepEqual(Array.from(notes.value.values(), value => Array.from(value)), [[type], [type]]);
  }
  props.bars = chart('5000,\n0068,').bars;
  assert.deepEqual(Array.from(notes.value.get(1)), ['5', '6']);
  props.bars = chart('5000,\n111111111111,').bars;
  assert.deepEqual(Array.from(notes.value.get(1)), ['5', ...Array(9).fill('1')]);
  props.bars = [];
  assert.equal(notes.value.size, 0);
});

test('the header keeps title and history while global navigation contains full-chart statistics', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'editor-header' });
  const template = descriptor.template.content;
  assert.match(template, /<div class="editor-core" :inert="state.editorBlocked">\s*<section v-if="studio.bar.value" class="document-toolbar">/);
  const toolbar = template.match(/<section v-if="studio.bar.value" class="document-toolbar">[\s\S]*?<\/section>/)[0];
  assert.match(toolbar, /<DocumentTitle v-if="!mobileWorkspace \|\| mobileLandscape" \/>/);
  const title = parse(readFileSync(new URL('DocumentTitle.vue', import.meta.url), 'utf8')).descriptor;
  assert.match(title.template.content, /<div class="document-title">[\s\S]*<h1 id="song-title"[\s\S]*?<\/h1><span id="document-mode"[\s\S]*<span v-if="state.encoding" id="encoding">[\s\S]*?<\/span><\/div>/);
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
  assert.match(heading, /<button v-if="range"[^>]*:title="t\('取消选择'\)" :aria-label="t\('取消选择'\)" @click="studio.clearLoop"><X aria-hidden="true" \/>{{ t\('取消选择'\) }}<\/button>/);
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

test('position information separates its summary from aligned parameter columns', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const { bindings } = compileScript(descriptor, { id: 'stable-note-inspector' });
  assert.ok(bindings.cellAttributes);
  const template = descriptor.template.content;
  assert.match(template, /class="cell-inspector" :aria-label="t\('落点信息'\)"/);
  assert.doesNotMatch(template, /cell-heading|cell-current/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /cell-bar/);
  assert.match(descriptor.scriptSetup.content, /\.\.\.\(timing && selected\?\.span \? \[\{ id: 'cell-long'/);
  assert.match(template, /class="position-summary">[\s\S]*id="cell-fraction"[\s\S]*id="cell-time"/);
  for (const selector of ['position-summary', 'chart-statistics']) {
    assert.match(descriptor.styles[0].content, new RegExp(`\\.${selector}\\{[^}]*font-size:11px;color:var\\(--muted\\);font-variant-numeric:tabular-nums`));
    assert.match(descriptor.styles[0].content, new RegExp(`\\.${selector} b\\{font-weight:500;color:var\\(--ink\\)\\}`));
  }
  assert.match(template, /<b>\{\{ positionSummary.measure \}\}<\/b>/);
  assert.match(template, /id="cell-fraction">\{\{ t\('位置'\) \}\} <b>\{\{ positionSummary.fraction \}\}<\/b>/);
  assert.match(template, /<b>\{\{ formatTime\(positionSummary.time\) \}\}<\/b>/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /id: 'cell-(fraction|time)'/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /cell-location|小节内位置|小节 \/ 格位/);
  assert.match(template, /v-for="attribute in cellAttributes"/);
  assert.match(template, /<dd :id="attribute.id" :title="attribute.value">/);
  assert.doesNotMatch(template, /gogo-active/);
  assert.doesNotMatch(template, /balloon-count|balloon-control/);
  const styles = readFileSync(new URL('sound.css', import.meta.url), 'utf8');
  assert.match(styles, /\.cell-inspector dl\{display:flex;flex-wrap:wrap;gap:8px 20px/);
  assert.match(styles, /\.cell-inspector dl>div\{[^}]*flex-direction:column/);
  assert.match(styles, /\.cell-inspector dd\{[^}]*text-overflow:ellipsis;white-space:nowrap/);
  assert.doesNotMatch(template + styles, /long-attribute/);
  assert.match(styles, /\.attribute-warning\{[^}]*padding:0 4px;[^}]*font:inherit;/);
  assert.match(styles, /\.attribute-warning svg\{width:1em;height:1em\}/);
  assert.doesNotMatch(readFileSync(new URL('SongWorkspace.vue', import.meta.url), 'utf8'), /离开输入框时自动应用/);
});

test('position summary follows only the selected point, never playback or the browsed measure', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('const positionSummary ='), script.indexOf('const cellAttributes ='));
  const state = reactive({ playing: false, selected: 8, position: 0 });
  const cell = ref({ bar: 2, numerator: 3, denominator: 8, time: 4.75 });
  const command = ref({ bar: 8, numerator: 1, denominator: 4, time: 16.5 });
  const selectedTiming = ref({ bar: { index: 2 } });
  const summary = runInNewContext(`${source}; positionSummary`, { computed, state, cell, command, selectedTiming });
  assert.equal(summary.value.measure, 3);
  assert.equal(summary.value.fraction, '3/8');
  assert.equal(summary.value.time, 4.75);
  state.selected = 10;
  assert.equal(summary.value.measure, 3);
  assert.equal(summary.value.time, 4.75);
  state.playing = true; state.position = 12.125;
  assert.equal(summary.value.measure, 3);
  assert.equal(summary.value.fraction, '3/8');
  assert.equal(summary.value.time, 4.75);
  state.position = 12.25;
  assert.equal(summary.value.time, 4.75);
  state.playing = false;
  assert.equal(summary.value.fraction, '3/8');
  assert.equal(summary.value.time, 4.75);
  cell.value = null; selectedTiming.value = { bar: { index: 8 } };
  assert.equal(summary.value.measure, 9);
  assert.equal(summary.value.fraction, '1/4');
  assert.equal(summary.value.time, 16.5);
  state.playing = true; state.position = 20;
  assert.equal(summary.value.measure, 9);
  assert.equal(summary.value.fraction, '1/4');
  assert.equal(summary.value.time, 16.5);
  selectedTiming.value = null;
  assert.equal(summary.value, null);
});

test('position attributes omit branch information while preserving timing details', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content;
  const source = script.slice(script.indexOf('const cellAttributes ='), script.indexOf('const timeline ='));
  const selectedTiming = ref({ bpm: 120, scroll: 1, numerator: 4, denominator: 4, delay: 0 });
  const cell = ref(null);
  const attributes = runInNewContext(`${source}; cellAttributes`, {
    computed, cell, selectedTiming, t, NOTE_TYPES
  });
  assert.ok(!attributes.value.some(attribute => attribute.id === 'cell-branch' || attribute.label === '分歧路线'));
  assert.equal(attributes.value.find(attribute => attribute.id === 'cell-bpm').value, '120');
  selectedTiming.value.bpm = 180;
  assert.equal(attributes.value.find(attribute => attribute.id === 'cell-bpm').value, '180');
  assert.equal(attributes.value.find(attribute => attribute.id === 'cell-delay').value, '0');
  selectedTiming.value.delay = .125;
  assert.equal(attributes.value.find(attribute => attribute.id === 'cell-delay').value, '0.125');
  reset();
  try {
    for (const [language, yes, no] of [['zh-CN', '是', '否'], ['en', 'Yes', 'No']]) {
      locale.value = language;
      for (const enabled of [false, true, false]) {
        selectedTiming.value.gogo = enabled;
        const attribute = attributes.value.find(attribute => attribute.id === 'cell-gogo');
        assert.equal(attribute.label, 'GOGOTIME');
        assert.equal(attribute.value, enabled ? yes : no);
      }
    }
  } finally { reset(); }
  cell.value = { span: { note: '5', start: 1, end: 3.5, complete: true } };
  const longValue = () => attributes.value.find(attribute => attribute.id === 'cell-long')?.value;
  assert.equal(longValue(), `${t(NOTE_TYPES[5].name)} · 2.500 s`);
  assert.equal(attributes.value.find(attribute => attribute.id === 'cell-long').warning, null);
  cell.value.span.complete = false;
  assert.equal(longValue(), `${t(NOTE_TYPES[5].name)} · 2.500 s`);
  assert.equal(attributes.value.find(attribute => attribute.id === 'cell-long').warning, t('缺少结束标记'));
  assert.match(descriptor.template.content, /<span v-if="attribute.warning" class="attribute-warning"><TriangleAlert aria-hidden="true" \/>\{\{ attribute.warning \}\}<\/span>/);
  cell.value = null;
  assert.equal(longValue(), undefined);
  const timing = selectedTiming.value;
  selectedTiming.value = null;
  assert.equal(attributes.value.length, 5);
  assert.ok(attributes.value.every(attribute => attribute.value === '—'));
  assert.deepEqual(Array.from(attributes.value, attribute => attribute.id), ['cell-bpm', 'cell-scroll', 'cell-meter', 'cell-gogo', 'cell-delay']);
  cell.value = { span: { note: '5', start: 1, end: 3.5, complete: true } };
  assert.equal(attributes.value.length, 5);
  assert.ok(attributes.value.every(attribute => attribute.value === '—'));
  selectedTiming.value = timing;
  assert.equal(attributes.value.find(attribute => attribute.id === 'cell-bpm').value, '180');
  assert.match(descriptor.template.content, /<p v-else class="position-empty">\{\{ t\('未选取落点'\) \}\}<\/p>/);
  assert.match(descriptor.styles[0].content, /\.position-empty\{margin:0;font:inherit;color:inherit\}/);
});

test('balloon and special roll counts are edited in the right note panel', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'balloon-inspector' });
  const section = descriptor.template.content.match(/<details[^>]*aria-labelledby="note-palette-title">[\s\S]*?<\/details>/)[0];
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
  assert.match(nav, /<label for="bar-number"[^>]*><span class="tool-label">{{ t\('查看小节'\) }}<\/span><\/label>\s*<input id="bar-number" type="number" min="1" :max="state.chart\?\.bars.length" step="1"/);
  assert.doesNotMatch(descriptor.template.content, /id="bar-prev"|id="bar-next"|measure-stepper/);
  const styles = descriptor.styles[0].content;
  assert.match(styles, /\.measure-nav input\{[^}]*height:28px;min-height:28px;[^}]*background:#fff/);
  assert.match(styles, /\.editor \.editor-bar\{[^}]*padding:4px 12px\}/);
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
  assert.doesNotMatch(descriptor.template.content, /position-source|t\('所选落点'\)/);
});

test('toolbar commands use scoped transparent surfaces with hover, pressed, focus and playback states', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'compact-toolbar-commands' });
  const styles = descriptor.styles[0].content;
  assert.match(styles, /\.transport\{[^}]*border-top:1px solid var\(--line\);border-bottom:0;box-shadow:none/);
  assert.match(styles, /\.playback-message-bar\+\.transport\{border-top:0\}/);
  assert.match(styles, /header\{[^}]*user-select:none/);
  assert.match(styles, /header :is\(input,textarea\)\{user-select:text\}/);
  const rules = styles.slice(styles.indexOf(':is(.studio-panel,.transport-host) :is(.document-toolbar'));
  for (const surface of ['document-toolbar', 'editor-bar', 'transport', 'inspector-heading']) {
    assert.ok(rules.includes(`.${surface}`));
  }
  assert.doesNotMatch(rules, /:is\([^)]*\.aside-actions/);
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
  const sections = aside.children.filter(node => node.tag === 'details');
  const attribute = (node, name) => node.props.find(prop => prop.name === name)?.value?.content;
  const ids = ['note-palette-title', 'selected-position-title', 'measure-properties-title', 'command-editor-title', 'measure-command-list-title', 'measure-source-title'];
  assert.deepEqual(sections.map(node => attribute(node, 'aria-labelledby')), ids);
  for (const [index, section] of sections.entries()) {
    const header = section.children.find(node => node.tag === 'summary' && attribute(node, 'class')?.includes('inspector-heading'));
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
  assert.match(selection, /t\('落点位置'\)/);
  assert.match(descriptor.styles[0].content, /\.selection-position \.inspector-content>output\{[^}]*font-size:12px;line-height:18px;/);
  assert.doesNotMatch(selection, /指令位置分子|指令位置分母/);
  for (const id of ['bar-badge', 'bar-time', 'division']) assert.ok(properties.includes(`id="${id}"`), id);
  for (const id of ['position-commands', 'measure-commands']) assert.ok(commands.includes(`id="${id}"`), id);
  assert.doesNotMatch(commands, /id="insert-branch-source"|id="command-player-structure"|id="bar-commands"|id="source"/);
  for (const id of ['branch-condition', 'branch-lower', 'branch-upper', 'branch-end']) assert.ok(!commands.includes(`id="${id}"`), id);
  assert.doesNotMatch(descriptor.template.content, /branch-structure-title|insert-branch-source/);
  assert.doesNotMatch(descriptor.template.content, /command-player-structure|插入双人谱结构/);
  assert.ok(list.includes('id="bar-commands"'));
  for (const section of [commands, list]) assert.ok(section.includes('@focusin="state.playing && studio.pause()"'));
  assert.match(source, /<h2 id="measure-source-title">{{ t\('小节源码（含指令）'\) }}<\/h2>/);
  assert.ok(source.includes('id="source-state"')); assert.ok(source.includes('id="source"'));
  assert.match(descriptor.styles[0].content, /\.inspector-heading h2\{flex:0 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
  assert.match(descriptor.styles[0].content, /\.command-group legend\{[^}]*font-size:11px;font-weight:500/);
});

test('editor sections collapse independently without unmounting fields or promoting section headings', () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'collapsible-inspector-sections' });
  const aside = descriptor.template.ast.children.find(node => node.tag === 'aside');
  const sections = aside.children.filter(node => node.tag === 'details');
  assert.equal(sections.length, 6);
  for (const section of sections) {
    assert.ok(section.props.some(prop => prop.name === 'open'));
    assert.ok(!section.props.some(prop => prop.name === 'name'));
    const summary = section.children.find(node => node.tag === 'summary');
    assert.ok(summary);
    assert.ok(summary.children.some(node => node.tag === 'h2'));
    assert.doesNotMatch(summary.loc.source, /<button\b/);
    assert.match(summary.loc.source, /class="inspector-heading workspace-section-summary"/);
    assert.match(summary.loc.source, /class="inspector-summary" :title="sectionSummaries\.\w+">{{ sectionSummaries\.\w+ }}<\/span>/);
    assert.match(summary.loc.source, /<ChevronDown class="workspace-section-chevron" aria-hidden="true" \/><\/summary>/);
    const content = section.children.find(node => ['div', 'form'].includes(node.tag));
    assert.ok(content);
    assert.doesNotMatch(content.loc.source.split('>')[0], /v-if|v-show/);
    assert.doesNotMatch(section.loc.source, /SectionHeading/);
  }
  const commandSection = sections.find(section => section.props.some(prop => prop.name === 'aria-labelledby' && prop.value?.content === 'command-editor-title'));
  const commandForm = commandSection.children.find(node => node.tag === 'form');
  assert.doesNotMatch(commandForm.loc.source, /settings-reset|studio\.clearSettings/);
  assert.match(descriptor.template.content, /<form class="bar-settings inspector-content" @submit.prevent>/);
  assert.doesNotMatch(descriptor.template.content, /<label for="source">/);
  const styles = descriptor.styles[0].content;
  assert.match(styles, /\.inspector-section\{[^}]*margin:0 0 16px;border:0\}/);
  assert.match(styles, /\.inspector-section:not\(\[open\]\)\{margin-bottom:0;border-bottom:1px solid var\(--line\)\}/);
  assert.match(styles, /\.inspector-content\{[^}]*padding:12px 14px 14px;border:0\}/);
  assert.doesNotMatch(styles, /\.inspector-(?:section|heading)\{[^}]*border-radius/);
  assert.match(styles, /\.inspector-heading\{background:var\(--paper\)\}/);
  const app = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8')).descriptor;
  assert.match(app.styles[0].content, /\.workspace-section-summary:focus-visible\{/);
  assert.match(app.styles[0].content, /details\[open\]>\.workspace-section-summary>\.workspace-section-chevron\{transform:none\}/);
});

test('section title summaries track selected notes, exact positions, measure counts and source status', () => {
  reset();
  try {
    const { descriptor } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
    const script = descriptor.scriptSetup.content;
    const source = script.slice(script.indexOf('const sectionSummaries ='), script.indexOf('watch([command, measureCommand]'));
    const state = reactive({ selected: 2, sourceState: '已同步' });
    const cell = ref({ name: t('咔') });
    const command = ref({ numerator: 3, denominator: 8, time: 4.75, commands: [{ name: 'SCROLL' }, { name: 'LYRIC' }] });
    const bar = ref({ index: 2, notes: '10020000', instructions: [{}, {}, {}] });
    const stats = ref({ total: 2 });
    const summaries = runInNewContext(`${source}; sectionSummaries`, { computed, state, cell, command, bar, stats, t, formatTime });
    assert.deepEqual({ ...summaries.value }, {
      note: '咔', position: '3/8 · 00:04.750', measure: '小节 3 · 音符数：2',
      commands: '2 条指令', instructions: '3 条指令', source: '8 格 · 已同步'
    });
    cell.value = null;
    assert.equal(summaries.value.note, '空拍');
    command.value = { numerator: 0, denominator: 1, time: 0, commands: [] };
    assert.equal(summaries.value.position, '0/1 · 00:00.000');
    assert.equal(summaries.value.commands, '0 条指令');
    state.selected = 4;
    stats.value.total = 5;
    bar.value = { index: 4, notes: '1000100010001000', instructions: [] };
    state.sourceState = '编辑中';
    assert.equal(summaries.value.measure, '小节 5 · 音符数：5');
    assert.equal(summaries.value.instructions, '0 条指令');
    assert.equal(summaries.value.source, '16 格 · 编辑中');
    assert.equal(summaries.value.position, '0/1 · 00:00.000');
    locale.value = 'en';
    assert.equal(summaries.value.note, 'Rest');
    assert.equal(summaries.value.commands, '0 commands');
    assert.equal(summaries.value.source, `16 ${t('格')} · ${t('编辑中')}`);
    command.value = null; bar.value = null;
    assert.equal(summaries.value.position, '');
    assert.equal(summaries.value.note, '');
    assert.equal(summaries.value.measure, '');
    assert.equal(summaries.value.commands, '');
    assert.equal(summaries.value.instructions, '');
    assert.equal(summaries.value.source, '');
    assert.match(descriptor.styles[0].content, /\.inspector-summary\{[^}]*min-width:0;[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
  } finally { reset(); }
});

test('the editor remains visible with empty disabled bindings and clears stale fields when a point is deselected', async () => {
  const { descriptor } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'empty-point-editor' });
  const timing = { bpm: 180, scroll: 2, numerator: 3, denominator: 4, gogo: false, barline: true };
  const commands = [{ name: 'BPMCHANGE', value: '180' }, { name: 'MEASURE', value: '3/4' }];
  const studio = {
    state: reactive({ selected: 0, source: '#BPMCHANGE 180\n1000,', sourceState: '已同步', invalid: false }),
    controls: {}, cell: ref(null), selectedTiming: ref(null),
    bar: ref({ index: 0, notes: '1000', instructions: commands }),
    command: ref({ numerator: 0, denominator: 1, time: 0, timing, commands }),
    measureCommand: ref({ timing, commands }), stats: ref({ total: 1 })
  };
  const source = descriptor.scriptSetup.content.replace(/^import .*;\n/gm, '');
  const editor = runInNewContext(`${source}; ({ bar, command, measureCommand, stats, fields, enabled, position, sectionSummaries })`, {
    computed, reactive, watch, inject: () => studio, t, formatTime
  });
  const assertEmpty = () => {
    assert.equal(editor.bar.value, undefined);
    for (const key of ['command', 'measureCommand', 'stats']) assert.equal(editor[key].value, null);
    assert.ok(Object.values(editor.fields).every(value => value === ''));
    assert.ok(Object.values(editor.enabled).every(value => value === false));
    assert.equal(editor.position.numerator, ''); assert.equal(editor.position.denominator, '');
    assert.ok(Object.values(editor.sectionSummaries.value).every(value => value === ''));
  };
  assertEmpty();
  studio.selectedTiming.value = { bar: studio.bar.value };
  await nextTick();
  assert.equal(editor.fields.bpm, 180); assert.equal(editor.fields.numerator, 3);
  assert.equal(editor.enabled.meter, true);
  assert.equal(editor.sectionSummaries.value.measure, t('小节 {p0}', { p0: 1 }) + ' · ' + t('音符数：{p0}', { p0: 1 }));
  studio.selectedTiming.value = null;
  await nextTick();
  assertEmpty();
  studio.state.selected = 1;
  studio.command.value = { ...studio.command.value, time: 2 };
  await nextTick();
  assertEmpty();
  assert.match(descriptor.template.content, /<aside class="measure-editor"/);
  assert.doesNotMatch(descriptor.template.content, /<aside[^>]*v-if/);
  assert.match(descriptor.template.content, /id="source" :value="bar \? state.source : ''" :disabled="!bar"/);
  for (const id of ['command-numerator', 'command-denominator', 'division', 'bar-bpm', 'bar-scroll', 'bar-delay', 'bar-gogo', 'bar-lyric', 'bar-senote', 'preview', 'clear']) {
    assert.match(descriptor.template.content, new RegExp(`id="${id}"[^>]*:disabled="!bar \\|\\| state.invalid"`));
  }
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
  const manager = runInNewContext(`${source}; ({ create, chooseMeasure, chooseRange, submit, first, last, anchor, error, fields, mode, dialog })`, {
    ref, reactive, computed, watch, inject: () => ({ state, bar: ref(null), pause() {}, applyMeasureBranch: (operation, measure) => { writes.push({ operation, measure }); return true; } }), t
  });
  manager.dialog.value = { showModal() {}, close() {} };
  manager.create(); manager.submit();
  assert.equal(writes.length, 0); assert.match(manager.error.value, /选择有效的小节/);
  manager.chooseMeasure(2); manager.chooseMeasure(0);
  assert.equal(manager.first.value, 0); assert.equal(manager.last.value, 2); assert.equal(manager.anchor.value, null);
  manager.chooseMeasure(1); manager.chooseMeasure(5);
  assert.match(manager.error.value, /分歧覆盖/); assert.equal(manager.last.value, 1);
  manager.chooseRange(2, 6);
  assert.match(manager.error.value, /分歧覆盖/); assert.equal(manager.first.value, 1); assert.equal(manager.last.value, 1);
  manager.chooseRange(1, 3);
  assert.equal(manager.error.value, ''); assert.equal(manager.first.value, 0); assert.equal(manager.last.value, 2); assert.equal(manager.anchor.value, null);
  manager.chooseMeasure(1);
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
    ref, reactive, computed, watch, inject: () => ({ state, bar: ref(null) }), t
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
  const source = script.slice(script.indexOf('const sortedBranches ='), script.indexOf('function create()'));
  const parser = script.slice(script.indexOf('function branchCondition('), script.indexOf('function updateCondition('));
  const branch = { index: 0, firstBarIndex: 6, barCount: 3, value: 'p,50,80' };
  const branches = ref([branch]);
  const labels = runInNewContext(`${source}\n${parser}\n({ branchLabel, branchTitle, conditionLabel, sortedBranches })`, { computed, branches, t });
  reset();
  try {
    assert.equal(labels.branchLabel(branch), '7-9 小节（共 3 小节）');
    assert.equal(labels.branchTitle(branch), '分歧 1 · 7-9 小节（共 3 小节）');
    assert.equal(labels.branchLabel({ firstBarIndex: 0, barCount: 1 }), '1-1 小节（共 1 小节）');
    assert.equal(labels.branchLabel({ firstBarIndex: 4, barCount: 0 }), '空分歧');
    assert.equal(labels.conditionLabel(branch), '精度：普通 < 50% · 玄人 50%–<80% · 达人 ≥ 80%');
    assert.equal(labels.conditionLabel({ value: 'r, 10, 20' }), '连打数：普通 < 10 · 玄人 10–<20 · 达人 ≥ 20');
    assert.equal(labels.conditionLabel({ value: 's,100.5,200' }), '分数：普通 < 100.5 · 玄人 100.5–<200 · 达人 ≥ 200');
    locale.value = 'en';
    assert.equal(labels.branchLabel(branch), 'Measures 7-9 (3 total)');
    assert.equal(labels.branchTitle(branch), 'Branch 1 · Measures 7-9 (3 total)');
    assert.equal(labels.conditionLabel(branch), 'Accuracy: Normal < 50% · Expert 50%–<80% · Master ≥ 80%');
    const later = { ...branch, index: 1, firstBarIndex: 9, barCount: 9 };
    const earlier = { ...branch, index: 2, firstBarIndex: 1 };
    branches.value = [later, branch, earlier];
    assert.deepEqual(Array.from(labels.sortedBranches.value, item => item.index), [2, 0, 1]);
    assert.deepEqual(branches.value.map(item => item.index), [1, 0, 2]);
    assert.equal((descriptor.template.content.match(/<strong>\{\{ branchTitle\(branch\) \}\}<\/strong><small>\{\{ conditionLabel\(branch\) \}\}<\/small>/g) || []).length, 1);
    assert.doesNotMatch(descriptor.template.content, /\{\{ branch\.value \}\}/);
  } finally { reset(); }
});

test('inline branch conditions preserve other values, target the correct branch and surface rejected changes without opening a dialog', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.replace(/^import .*;\n/gm, '');
  const writes = [], branch = { firstBarIndex: 6, value: 'p,50,80' };
  const state = { notice: 'invalid condition' };
  const controls = runInNewContext(`${source}; ({ updateCondition, mode, error, dialog })`, {
    ref, reactive, computed, watch, inject: () => ({
      state, bar: ref(null), pause() {}, applyMeasureBranch(operation, measure) {
        writes.push({ operation, measure });
        return Number.isFinite(operation.lower) && Number.isFinite(operation.upper);
      }
    })
  });
  controls.dialog.value = { showModal() { assert.fail('Inline condition editing must not open a modal'); } };
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
  let success = true;
  const manager = runInNewContext(`${source}; ({ edit, submit, createRoute, removeBranch, removeRoute, fields, mode, error, dialog, close })`, {
    ref, reactive, computed, watch, inject: () => ({ state, bar: ref(null), pause() {}, applyMeasureBranch: (operation, measure) => { writes.push({ operation, measure }); return success; } }),
    t, names: { N: '普通', E: '玄人' }
  });
  let opened = 0, closed = 0;
  manager.dialog.value = { showModal() { opened++; }, close() { closed++; } };
  manager.edit(branch, 'route', 'M'); manager.createRoute('E');
  assert.equal(writes[0].operation.source, 'E'); assert.equal(writes[0].operation.route, 'M'); assert.equal(writes[0].measure, 6);
  manager.edit(branch, 'route', 'M'); manager.createRoute('');
  assert.equal(writes[1].operation.source, null);
  manager.edit(branch, 'remove'); manager.removeBranch('E');
  assert.equal(writes[2].operation.keep, 'E');
  success = false;
  manager.edit(branch, 'remove'); manager.removeBranch('');
  assert.equal(writes[3].operation.keep, null); assert.equal(manager.error.value, 'failed'); assert.equal(manager.mode.value, 'remove');
  manager.removeRoute(branch, 'E'); assert.equal(writes.length, 4);
  assert.equal(manager.mode.value, 'remove-route');
  manager.close(); assert.equal(writes.length, 4);
  manager.removeRoute(branch, 'E'); manager.submit();
  assert.equal(writes.length, 5); assert.equal(writes[4].operation.route, 'E');
  assert.equal(writes[4].operation.clearLast, undefined);
  assert.equal(manager.mode.value, 'remove-route'); assert.equal(manager.error.value, 'failed');
  assert.equal(writes[4].measure, 6);
  manager.edit(branch, 'route', 'M'); manager.createRoute('N');
  assert.equal(manager.mode.value, 'route'); assert.equal(manager.error.value, 'failed');
  assert.equal(writes[5].operation.source, 'N');
  success = true; manager.createRoute('');
  assert.equal(writes[6].operation.source, null); assert.equal(manager.mode.value, '');
  manager.createRoute('E'); assert.equal(writes.length, 7);
  const onlyRoute = { ...branch, routes: ['N'] };
  state.chart.branches = [onlyRoute];
  manager.removeRoute(onlyRoute, 'N');
  assert.equal(manager.mode.value, 'remove-last'); assert.equal(writes.length, 7);
  manager.close(); assert.equal(writes.length, 7);
  manager.removeRoute(onlyRoute, 'N'); manager.removeBranch('N');
  assert.equal(writes[7].operation.type, 'remove'); assert.equal(writes[7].operation.keep, 'N');
  manager.removeRoute(onlyRoute, 'N'); manager.removeBranch('');
  assert.equal(writes[8].operation.keep, null); assert.equal(writes[8].measure, 6);
  manager.removeBranch('N'); assert.equal(writes.length, 9);
  manager.edit(branch, 'remove-route', 'N'); manager.submit();
  assert.equal(manager.mode.value, 'remove-last'); assert.equal(writes.length, 9);
  assert.ok(opened > 0 && closed > 0);
  state.activeId = 'another-document';
  assert.equal(manager.mode.value, ''); assert.equal(manager.error.value, '');
  manager.edit(branch, 'route', 'M'); state.course = 1;
  assert.equal(manager.mode.value, '');
  manager.edit(branch, 'remove'); state.chart.branches = [];
  assert.equal(manager.mode.value, '');
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

test('landscape drawer outside clicks close it without consuming global controls or nested dialogs', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'drawer-outside-click' });
  const source = descriptor.scriptSetup.content.match(/function dismissWorkspaceDrawer\(event\) \{[\s\S]*?\n\}/)[0];
  const mobileLandscape = { value: true }, workspaceOpen = { value: true };
  const dismiss = runInNewContext(`${source}; dismissWorkspaceDrawer`, { mobileLandscape, workspaceOpen });
  dismiss({ target: { closest: () => ({}) } }); assert.equal(workspaceOpen.value, true);
  mobileLandscape.value = false;
  dismiss({ target: { closest: () => null } }); assert.equal(workspaceOpen.value, true);
  mobileLandscape.value = true;
  dismiss({ target: { closest: () => null } }); assert.equal(workspaceOpen.value, false);
  assert.match(descriptor.template.content, /class="workspace-drawer-backdrop" :style="\{ top: `\$\{workspaceTop\}px` \}"/);
  assert.match(descriptor.styles[0].content, /\.workspace-drawer-backdrop:hover\{position:fixed;left:0;right:0;bottom:0;[^}]*height:auto;/);
  assert.match(descriptor.scriptSetup.content, /addEventListener\('pointerdown', dismissWorkspaceDrawer, true\)/);
  assert.match(descriptor.scriptSetup.content, /removeEventListener\('pointerdown', dismissWorkspaceDrawer, true\)/);
});

test('workspace Escape closes the mobile overlay without dismissing nested dialogs or composition', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.match(/function workspaceKeydown\(event\) \{[\s\S]*?\n\}/)[0];
  const mobileWorkspace = { value: true }, workspaceOpen = { value: true }, mobileLandscape = { value: false };
  let closed = 0, focused = 0;
  const handle = runInNewContext(`${source}; workspaceKeydown`, { mobileWorkspace, mobileLandscape, workspaceOpen, closeWorkspace: () => closed++, workspaceSidebar: { value: { focusToggle: () => focused++ } } });
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
  const toolbar = descriptor.template.content.match(/<div class="editor-actions">[\s\S]*?<\/button>\s*<\/div>(?=\s*<\/Teleport>\s*<button v-if="compactTools" id="follow-playback")/)[0];
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

test('the timeline toolbar confirms measure deletion in a cancelable modal with context and availability guards', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'delete-measure' });
  const toolbar = descriptor.template.content.match(/<div class="editor-actions">[\s\S]*?<\/div><\/div>/)[0];
  const button = toolbar.match(/<button id="delete-bar"[\s\S]*?<\/button>/)[0];
  assert.match(button, /:disabled="!bar \|\| state.invalid \|\| state.chart.bars.length <= 1"/);
  assert.match(button, /@click="requestDeleteMeasure"/);
  assert.match(button, /<Trash2 aria-hidden="true" \/>/);
  assert.match(button, /t\('不能删除最后一个小节。'\)/);
  assert.match(button, /t\('删除小节'\)/);
  assert.equal(descriptor.template.content.split('id="delete-bar"').length - 1, 1);
  assert.match(descriptor.template.content, /<dialog ref="deleteDialog"[^>]*aria-labelledby="delete-measure-title"[^>]*@cancel.prevent="closeDeleteMeasure"/);
  assert.match(descriptor.template.content, /id="delete-measure-cancel" type="button" autofocus @click="closeDeleteMeasure"/);
  assert.match(descriptor.template.content, /id="delete-measure-confirm" type="button" @click="confirmDeleteMeasure"/);
  const state = reactive({ activeId: 1, course: 0, chart: { bars: [{}, {}] }, selected: 0, invalid: false, editorBlocked: false, notice: 'failed' });
  let deleted = 0, paused = 0, succeeds = true, open = false;
  const source = descriptor.scriptSetup.content.match(/const deleteDialog = ref\(null\)[\s\S]*?(?=const balloonHits)/)[0];
  const modal = runInNewContext(`${source}; ({ deleteDialog, deleteTarget, deleteError, requestDeleteMeasure, confirmDeleteMeasure, closeDeleteMeasure })`, {
    ref, watch, state, bar: computed(() => state.chart?.bars[state.selected]),
    studio: { pause: () => paused++, deleteBar: () => { deleted++; return succeeds; } },
    confirm: () => assert.fail('Measure deletion must not use native confirm'),
  });
  modal.deleteDialog.value = { showModal: () => { open = true; }, close: () => { open = false; } };
  modal.requestDeleteMeasure(); assert.equal(open, true); assert.equal(deleted, 0); assert.equal(paused, 1);
  modal.closeDeleteMeasure(); modal.confirmDeleteMeasure(); assert.equal(open, false); assert.equal(deleted, 0);
  modal.requestDeleteMeasure(); modal.confirmDeleteMeasure(); assert.equal(deleted, 1); assert.equal(open, false);
  succeeds = false; modal.requestDeleteMeasure(); modal.confirmDeleteMeasure();
  assert.equal(open, true); assert.equal(modal.deleteError.value, 'failed');
  succeeds = true; modal.confirmDeleteMeasure(); assert.equal(open, false); assert.equal(modal.deleteError.value, '');
  for (const field of ['selected', 'course', 'activeId']) {
    state.selected = 0; modal.requestDeleteMeasure(); state[field]++;
    assert.equal(open, false, field); const count = deleted; modal.confirmDeleteMeasure(); assert.equal(deleted, count);
  }
  state.selected = 0; modal.requestDeleteMeasure(); state.chart = { bars: [{}, {}] }; assert.equal(open, false);
  modal.requestDeleteMeasure(); state.invalid = true; assert.equal(open, false);
  modal.requestDeleteMeasure(); assert.equal(open, false);
  state.invalid = false; state.chart = { bars: [{}] }; modal.requestDeleteMeasure(); assert.equal(open, false);
});

test('measure statistics live in measure properties while snap remains in the toolbar', () => {
  const { descriptor: measure } = parse(readFileSync(new URL('MeasureEditor.vue', import.meta.url), 'utf8'));
  compileScript(measure, { id: 'measure-properties' });
  const { descriptor: timeline } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  assert.doesNotMatch(timeline.template.content, /editor-footer|position-info/);
  assert.doesNotMatch(timeline.template.content, /id="note-count"|id="bar-grid"|id="bar-snap"|id="bar-slots"/);
  assert.match(measure.scriptSetup.content, /import \{[^}]*\bGRID_DIVISIONS\b[^}]*\} from '\.\/grid.js'/);
  const info = measure.template.content.match(/<details class="inspector-section" open aria-labelledby="measure-properties-title">[\s\S]*?<\/details>/)[0];
  assert.match(info, /id="note-count">.*stats\?\.total \?\? '—'/);
  assert.match(info, /id="bar-grid">.*GRID_DIVISIONS/);
  assert.match(timeline.template.content, /id="snap-division" v-model="controls.snapChoice"/);
  assert.match(measure.template.content, /id="division" :value="bar\?\.notes.length \?\? ''"/);
});

test('navigation, position information and branches share an icon heading with inline details', () => {
  const { descriptor } = parse(readFileSync(new URL('SectionHeading.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'shared-section-heading' });
  assert.match(descriptor.template.content, /class="section-emblem" aria-hidden="true"><component :is="icon"/);
  assert.match(descriptor.template.content, /<h2>{{ title }}<\/h2><div v-if="\$slots.actions" class="section-caption-actions"><slot name="actions" \/><\/div><slot \/>/);
  assert.match(descriptor.styles[0].content, /\.section-caption\{[^}]*min-height:34px/);
  assert.match(descriptor.styles[0].content, /\.section-title-row\{[^}]*min-height:20px/);
  assert.match(descriptor.styles[0].content, /\.section-description\{margin-top:2px;/);
  assert.match(descriptor.styles[0].content, /\.section-title-row\{[^}]*align-items:baseline/);
  assert.match(descriptor.styles[0].content, /font-size:13px;font-weight:600;line-height:1.5/);
  const timeline = readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8');
  assert.match(timeline, /\.clear-selection\{height:20px;min-height:20px;padding:0 5px;gap:3px;flex-shrink:0;border:1px solid var\(--line\);border-radius:4px;/);
  assert.match(timeline, /\.clear-selection svg\{width:12px;height:12px\}/);
  assert.match(timeline, /white-space:nowrap;transform:translateY\(-1px\)\}/);
  assert.match(timeline, /background:#fff;color:#5f6e65;font-family:inherit;font-size:12px;font-weight:400;line-height:18px/);
  assert.match(timeline, /\.clear-selection:hover\{border-color:#abc4b7;background:#f1f6f3;color:var\(--green\)\}/);
  assert.match(timeline, /\.clear-selection:active\{background:#e7efe9\}/);
  assert.match(descriptor.template.content, /:class="\{ 'has-actions': \$slots.actions \}"/);
  assert.match(descriptor.styles[0].content, /\.section-title-row\.has-actions\{align-items:center\}/);
  assert.match(descriptor.styles[0].content, /\.section-title-row\.has-actions h2\{line-height:20px\}/);
  assert.match(descriptor.template.content, /<div v-if="\$slots.actions" class="section-caption-actions"><slot name="actions" \/><\/div>/);
  assert.match(descriptor.styles[0].content, /\.section-caption-actions\{display:flex;align-self:center;align-items:center;flex:0 0 auto;height:20px\}/);
  assert.match(timeline, /<SectionHeading :icon="Map" :title="t\('全局导航'\)">[\s\S]*id="selection-summary"[\s\S]*@click="studio.clearLoop"[\s\S]*<\/SectionHeading>/);
  assert.match(timeline, /:title="t\('全局导航'\)">[\s\S]*<template #description>\s*<div class="chart-statistics"[\s\S]*id="total-notes"[\s\S]*<\/template>\s*<\/SectionHeading>/);
  assert.match(timeline, /<SectionHeading class="position-caption" :icon="PositionIcon" :title="t\('落点信息'\)">\s*<template #actions><button v-if="positionSummary" id="clear-position-selection" type="button" class="clear-position-selection clear-selection" :title="t\('取消选择'\)" :aria-label="t\('取消选择'\)" @click="studio.clearNoteSelection"><X aria-hidden="true" \/>{{ t\('取消选择'\) }}<\/button><\/template>/);
  assert.match(timeline, /class="clear-measure-selection clear-selection"/);
  assert.doesNotMatch(timeline, /position-source|t\('所选落点'\)/);
  const branches = readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8');
  assert.match(branches, /<SectionHeading class="branch-caption" :icon="GitBranch" :title="t\('谱面分歧'\)">[\s\S]*class="branch-count"[\s\S]*<template #description>/);
  assert.match(branches, /\.branch-context\{[^}]*padding:16px 12px/);
  assert.match(readFileSync(new URL('sound.css', import.meta.url), 'utf8'), /\.cell-inspector\{[^}]*padding:16px 12px/);
  assert.match(readFileSync(new URL('App.vue', import.meta.url), 'utf8'), /\.measure-section\{padding:16px 12px\}/);
});

test('mobile and desktop inspector panels retain their hierarchy and edit headings reuse sidebar typography without a top gap', () => {
  const component = name => parse(readFileSync(new URL(name, import.meta.url), 'utf8')).descriptor;
  const heading = component('SectionHeading.vue');
  const measure = component('MeasureEditor.vue');
  const app = component('App.vue');
  const branch = component('BranchControls.vue');
  const timeline = component('TimelineEditor.vue');
  const sound = readFileSync(new URL('sound.css', import.meta.url), 'utf8');
  assert.match(heading.styles[0].content, /\.section-caption\{display:flex;align-items:flex-start;/);
  assert.match(measure.template.content, /<summary class="inspector-heading workspace-section-summary"><h2 id="note-palette-title">{{ t\('音符编辑'\) }}<\/h2><span class="inspector-summary" :title="sectionSummaries.note">{{ sectionSummaries.note }}<\/span><ChevronDown class="workspace-section-chevron" aria-hidden="true" \/><\/summary>/);
  assert.doesNotMatch(measure.template.content, /<SectionHeading/);
  assert.match(measure.styles[0].content, /\.measure-editor\{[^}]*padding:0;/);
  assert.doesNotMatch(measure.styles[0].content, /\.inspector-heading(?: h2)?\{[^}]*(?:font|line-height|padding|margin|min-height):/);
  assert.match(app.styles[0].content, /\.workspace-section-summary>b,\.workspace-section-summary>h2\{[^}]*margin:0;font:inherit;font-weight:700;/);
  for (const [styles, selector] of [
    [branch.styles[0].content, 'branch-context'],
    [app.styles[0].content, 'measure-section'],
    [sound, 'cell-inspector']
  ]) {
    const rules = [...styles.matchAll(new RegExp(`\\.${selector}\\{([^}]+)\\}`, 'g'))];
    assert.ok(rules.length, selector);
    for (const [, declarations] of rules) {
      if (declarations.includes('padding')) assert.match(declarations, /(?:^|;)padding:16px 12px(?:;|$)/, selector);
    }
  }
  assert.match(app.styles[0].content, /\.inspector-tab-panel>\.cell-inspector,\.inspector-tab-panel>\.branch-context\{border:0\}/);
  assert.match(branch.styles[0].content, /\.branch-context\{[^}]*align-items:flex-start/);
  assert.doesNotMatch(branch.styles[0].content, /\.branch-caption\{[^}]*align-items:center/);
  assert.match(branch.styles[0].content, /\.branch-caption p\{[^}]*margin:0\}/);
  assert.doesNotMatch(timeline.styles[0].content, /padding-block:15px/);
  assert.match(timeline.styles[0].content, /\.position-caption\{margin-bottom:12px\}/);
});

test('branch information occupies the caption subtitle without instructional copy or a separate footer row', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'compact-branch-caption' });
  assert.match(descriptor.template.content, /class="branch-current"><template v-if="current">/);
  assert.match(descriptor.template.content, /<template v-else-if="selectedTiming">\{\{ t\('当前位于共用段'\) \}\}<\/template><template v-else>\{\{ t\('未选取落点'\) \}\}<\/template>/);
  assert.doesNotMatch(descriptor.template.content, /统一切换全部分歧，或按需单独调整。|仅影响显示与试听，不修改谱面。|branch-context-foot/);
});

test('branch context follows selected point timing rather than playback or the viewed measure and hides its tag in shared measures', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'branch-context-route-color' });
  const source = descriptor.scriptSetup.content.replace(/^import .*;\n/gm, '');
  const bar = ref({ branchIndex: 1 }), currentTiming = ref(null), selectedTiming = ref(null);
  const state = reactive({ chart: { branches: [{ index: 0, route: 'N' }, { index: 1, route: 'M' }] } });
  const { current } = runInNewContext(`${source}; ({ current })`, {
    ref, reactive, computed, watch, inject: () => ({ state, bar, currentTiming, selectedTiming }), t
  });
  assert.match(descriptor.template.content, /class="branch-count">\{\{ branches.length \}\}<\/span>\s*<template #description>/);
  assert.doesNotMatch(descriptor.template.content, /mixed-route|自定义路线/);
  const description = descriptor.template.content.match(/<template #description>([\s\S]*?)<\/p><\/template>/)[1];
  assert.match(description, /class="branch-current"><template v-if="current"><span v-if="current.route" class="branch-route-tag" :data-route="current.route">\{\{ t\(names\[current.route\]\) \}\}<\/span> \{\{ branchLabel\(current\) \}\}/);
  const binding = descriptor.template.content.match(/class="branch-route-tag" :data-route="([^"]+)"/)[1];
  const routeColor = () => current.value ? runInNewContext(binding, { current: current.value }) : undefined;
  assert.equal(routeColor(), undefined);
  selectedTiming.value = { bar: { branchIndex: 0 } };
  for (const route of ['N', 'E', 'M']) {
    state.chart.branches[0].route = route;
    assert.equal(routeColor(), route);
  }
  bar.value = { branchIndex: null };
  assert.equal(routeColor(), 'M');
  state.chart.branches[0].route = 'E';
  assert.equal(routeColor(), 'E');
  bar.value = { branchIndex: 1 };
  assert.equal(routeColor(), 'E');
  currentTiming.value = { bar: { branchIndex: 1 } };
  assert.equal(routeColor(), 'E');
  selectedTiming.value = { bar: { branchIndex: 1 } };
  assert.equal(routeColor(), 'M');
  currentTiming.value = { bar: { branchIndex: null } };
  assert.equal(routeColor(), 'M');
  selectedTiming.value = { bar: { branchIndex: null } };
  assert.equal(routeColor(), undefined);
  selectedTiming.value = null;
  assert.equal(routeColor(), undefined);
  state.chart = null;
  assert.equal(routeColor(), undefined);
  const styles = descriptor.styles[0].content;
  for (const route of ['N', 'E', 'M']) {
    assert.ok(styles.includes(`.branch-route-tag[data-route=${route}],.branch-route-card[data-route=${route}],.branch-route-text[data-route=${route}],.branch-route-filter button[data-route=${route}]{--route-color:`));
  }
  assert.match(styles, /\.branch-route-tag\{[^}]*color:var\(--route-color\);background:var\(--route-hover-background\)/);
  assert.doesNotMatch(descriptor.template.content, /<section class="branch-context"[^>]*:data-route/);
  assert.doesNotMatch(styles, /\.branch-context\[data-route/);
});

test('mobile measure actions use a single set of named icon buttons directly in the toolbar', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'mobile-measure-tools' });
  const template = descriptor.template.content;
  assert.match(template, /class="editor-history"[\s\S]*?<div v-show="mobile" id="mobile-measure-tools" class="mobile-measure-tools"><\/div>\s*<details ref="toolsMenu"/);
  const actions = template.match(/<Teleport to="#mobile-measure-tools" :disabled="!mobile" defer>[\s\S]*?<\/Teleport>/)[0];
  for (const id of ['insert-bar-before', 'insert-bar-after', 'delete-bar']) {
    const button = actions.match(new RegExp(`<button id="${id}"[\\s\\S]*?<\\/button>`))[0];
    assert.match(button, /:class="\{ icon: mobile \}"/);
    assert.match(button, /:aria-label="t\('/);
    assert.match(button, /:title=/);
    assert.match(button, /aria-hidden="true" \/><span v-if="!mobile">/);
    assert.equal(template.split(`id="${id}"`).length - 1, 1);
  }
  assert.match(actions, /@click="requestDeleteMeasure"/);
  assert.match(descriptor.styles[0].content, /\.mobile-measure-tools button\.icon\{width:28px;min-width:28px;height:28px;min-height:28px;/);
});

test('one single-line toolbar retains priority controls and collapses secondary controls above the timeline', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'inline-snap-controls' });
  const tools = descriptor.template.content.match(/<div ref="toolbar" class="lane-head editor-tools editor-bar"[^>]*>[\s\S]*?(?=\s*<Teleport to="body">\s*<dialog ref="deleteDialog")/)[0];
  assert.equal(descriptor.template.content.split('class="lane-head editor-tools editor-bar"').length - 1, 1);
  assert.doesNotMatch(tools, /音乐波形|振幅/);
  for (const id of ['bar-number', 'undo', 'redo', 'insert-bar-before', 'insert-bar-after', 'delete-bar', 'snap-division', 'custom-snap', 'follow-playback', 'view']) {
    assert.ok(tools.includes(`id="${id}"`), id);
    assert.equal(descriptor.template.content.split(`id="${id}"`).length - 1, id === 'follow-playback' ? 2 : 1);
  }
  assert.match(tools, /@change="snapChange"/);
  assert.match(tools, /<div v-show="!mobile" id="desktop-zoom-tools" class="desktop-zoom-tools"><\/div>\s*<div class="editor-history">/);
  const zoom = tools.match(/<Teleport to="#desktop-zoom-tools" :disabled="mobile" defer>[\s\S]*?<\/Teleport>\s*<\/details>[\s\S]*?<\/Teleport>/)[0];
  assert.match(zoom, /v-if="mobile && compactTools" ref="zoomMenu"/);
  assert.match(zoom, /id="view" v-model.number="controls.zoom"/);
  assert.match(descriptor.styles[0].content, /\.editor-history\{[^}]*padding-right:6px;border-right:1px solid var\(--line\)\}/);
  assert.match(tools, /id="bar-number"[\s\S]*id="snap-division"[\s\S]*id="undo"[\s\S]*id="redo"[\s\S]*<details ref="toolsMenu"[\s\S]*id="custom-snap"[\s\S]*id="view"[\s\S]*id="insert-bar-before"[\s\S]*id="insert-bar-after"[\s\S]*id="delete-bar"[\s\S]*id="follow-playback"/);
  assert.match(tools, /v-show="controls.snapChoice === 'custom'"/);
  assert.match(tools, /min="1" max="768"/);
  assert.match(tools, /@change="studio.setSnap\(Number\(controls.customSnap\)\)"/);
  assert.match(tools, /id="view"[\s\S]*<label v-else class="follow-control"><input id="follow-playback" v-model="state.followPlayback" type="checkbox" role="switch"><span class="switch-track" aria-hidden="true"><\/span>[\s\S]*<\/label>\s*<\/div><\/details>\s*<\/div>$/);
  assert.match(descriptor.styles[0].content, /\.follow-control input:checked\+\.switch-track\{background:var\(--green\)\}/);
  assert.match(descriptor.styles[0].content, /\.follow-control input:checked\+\.switch-track::before\{transform:translateX\(12px\)\}/);
  assert.match(descriptor.styles[0].content, /\.follow-control input:focus-visible\+\.switch-track\{outline:2px solid var\(--green\)/);
  assert.doesNotMatch(descriptor.styles[0].content, /\.editor-actions\{[^}]*margin-left:auto/);
  assert.match(descriptor.styles[0].content, /\.lane-head.editor-tools\{justify-content:flex-start;/);
  assert.match(descriptor.styles[0].content, /\.editor-tools \.follow-control\{[^}]*margin-left:auto;/);
  assert.match(descriptor.styles[0].content, /\.editor-bar,\.editor-tools\{flex-wrap:nowrap\}/);
  assert.doesNotMatch(descriptor.template.content, /snap-controls|snap-position/);
  assert.doesNotMatch(readFileSync(new URL('sound.css', import.meta.url), 'utf8'), /\.snap-controls/);
});

test('zoom submenu keyboard navigation wraps and returns focus without closing the parent menu', () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.match(/function zoomKeydown\(event\) \{[\s\S]*?\n\}/)[0];
  const document = { activeElement: null };
  const items = Array.from({ length: 3 }, () => ({ focus() { document.activeElement = this; } }));
  const zoomOptions = { value: { querySelectorAll: () => items } };
  let closed = 0, prevented = 0, stopped = 0;
  const keydown = new Function('zoomOptions', 'document', 'closeZoom', `${source}; return zoomKeydown;`)(zoomOptions, document, () => closed++);
  const press = key => keydown({ key, preventDefault: () => prevented++, stopPropagation: () => stopped++ });
  document.activeElement = items[2];
  press('ArrowDown'); assert.equal(document.activeElement, items[0]);
  press('ArrowUp'); assert.equal(document.activeElement, items[2]);
  press('Home'); assert.equal(document.activeElement, items[0]);
  press('End'); assert.equal(document.activeElement, items[2]);
  press('Escape'); press('ArrowLeft'); assert.equal(closed, 2);
  press('Tab'); assert.equal(prevented, 6); assert.equal(stopped, 6);
  assert.match(descriptor.template.content, /role="menuitemradio" :aria-checked="controls.zoom === choice.value"/);
  const zooms = runInNewContext(`${descriptor.scriptSetup.content.match(/const zooms = [^;]+;/)[0]}; zooms`);
  assert.deepEqual(Array.from(zooms), [0.5, 0.75, 1.5, 2, 2.5, 3, 3.5, 4]);
  const choicesSource = descriptor.scriptSetup.content.match(/const zoomChoices = [^;]+;/)[0];
  const choices = runInNewContext(`${choicesSource}; zoomChoices`, { computed, zooms, t, Maximize2: {}, Ruler: {} });
  assert.deepEqual(Array.from(choices.value, choice => choice.value), [1, 0.5, 0.75, 1.5, 2, 2.5, 3, 3.5, 4]);
  assert.equal(choices.value[0].label, t('标准'));
  assert.deepEqual(Array.from(choices.value.slice(1), choice => choice.label), ['0.5×', '0.75×', '1.5×', '2×', '2.5×', '3×', '3.5×', '4×']);
  assert.match(descriptor.template.content, /id="view" v-model.number="controls.zoom"/);
  assert.match(descriptor.template.content, /controls.zoom = choice.value; controls.view = 'auto'; closeZoom\(\)/);
  assert.match(descriptor.template.content, /role="menuitemcheckbox" :aria-checked="state.followPlayback" @click="state.followPlayback = !state.followPlayback"/);
});

test('editor columns are siblings and mobile transport can leave the scrolling center content', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'editor-columns' });
  const template = descriptor.template.content;
  assert.match(template, /<div class="editor-core" :inert="state.editorBlocked">\s*<section v-if="studio.bar.value" class="document-toolbar">[\s\S]*?<\/section>\s*<div class="editor-scroll">/);
  assert.match(template, /<TimelineEditor v-if="studio.bar.value" :mobile="mobileWorkspace" :landscape="mobileLandscape" \/>/);
  assert.match(template, /<\/div>\s*<Teleport to="body" :disabled="!mobileWorkspace \|\| mobileLandscape"><div ref="transportHost" class="transport-host" :class="\{ 'landscape-transport': mobileLandscape \}">\s*<div v-if="messageBarError \|\| showAudioMessage"/);
  assert.match(template, /<\/div><\/details><\/section>\s*<\/div><\/Teleport>/);
  assert.match(template, /<Teleport v-if="studio.bar.value" to="#mobile-edit-panel" :disabled="!mobileWorkspace" defer><MeasureEditor :inert="state.editorBlocked" \/><\/Teleport>/);
  assert.doesNotMatch(template, /id="preview-range"|id="loop-summary"|id="apply-loop"|id="loop-current"/);
  assert.match(template, /ref="selectionDialog"[\s\S]*@submit.prevent="applySelection"/);
  assert.match(template, /id="selection-first"/); assert.match(template, /id="selection-last"/);
  assert.doesNotMatch(template, /loop-controls|loop-range-inputs/);
  const styles = descriptor.styles[0].content;
  assert.match(styles, /\.editor-scroll\{[^}]*overflow:auto/);
  assert.match(styles, /\.transport\{[^}]*flex-shrink:0/);
  assert.match(styles, /\.volume-panel\{[^}]*bottom:calc\(100% \+ 6px\)/);
});

test('mobile song titles render directly in the workspace heading instead of an external teleport target', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  assert.match(descriptor.template.content, /<template #title><DocumentTitle v-if="mobileWorkspace && !mobileLandscape && studio.bar.value" class="workspace-document-title"/);
  assert.match(descriptor.template.content, /<DocumentTitle v-if="!mobileWorkspace \|\| mobileLandscape" \/>/);
  assert.doesNotMatch(descriptor.template.content, /mobile-document-title/);
  assert.match(descriptor.styles[0].content, /@media\(max-width:900px\)\{\.editor-core>\.document-toolbar\{display:none\}\}/);
  const sidebar = parse(readFileSync(new URL('SongWorkspace.vue', import.meta.url), 'utf8')).descriptor;
  compileScript(sidebar, { id: 'merged-workspace-title' });
  assert.match(sidebar.template.content, /class="workspace-heading-row">[\s\S]*ref="toggleButton"[\s\S]*<slot name="title" \/>/);
  assert.match(sidebar.styles[0].content, /\.workspace-heading-row:has\(\.workspace-document-title\):focus-within::after\{[^}]*position:absolute;inset:0;z-index:2;border:2px solid var\(--green\);pointer-events:none/);
  const timeline = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8')).descriptor;
  assert.match(timeline.styles[0].content, /\.editor \.editor-bar\{margin-left:0;/);
});

test('landscape transitions retain mobile inspector routing and restore the desktop workspace preference', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'landscape-layout' });
  const source = descriptor.scriptSetup.content.match(/function resizeLayout\(\) \{[\s\S]*?\n\}/)[0];
  const flags = { mobile: true, landscape: false };
  const context = {
    landscapeQuery: 'landscape', innerWidth: 390, desktopWorkspaceOpen: true,
    matchMedia: query => ({ matches: query === 'landscape' ? flags.landscape : flags.mobile }),
    mobileWorkspace: { value: false }, mobileLandscape: { value: false }, workspaceOpen: { value: true }, positionMenus() {}
  };
  const resize = runInNewContext(`${source}; resizeLayout`, context);
  resize(); assert.equal(context.workspaceOpen.value, false);
  flags.landscape = true; context.innerWidth = 844;
  resize(); assert.equal(context.mobileLandscape.value, true); assert.equal(context.workspaceOpen.value, false);
  flags.landscape = false; context.innerWidth = 390;
  resize(); assert.equal(context.workspaceOpen.value, false);
  flags.mobile = false;
  resize(); assert.equal(context.mobileWorkspace.value, false); assert.equal(context.workspaceOpen.value, true);
  flags.landscape = true; context.innerWidth = 667;
  resize(); assert.equal(context.mobileWorkspace.value, true); assert.equal(context.workspaceOpen.value, false);
  assert.match(descriptor.scriptSetup.content, /state.editorBlocked = mobile && expanded;/);
  const styles = descriptor.styles[0].content;
  assert.match(styles, /\.studio-panel-body\.mobile-landscape:has\(#timeline\)\{[^}]*grid-template-rows:minmax\(0,1fr\)\}/);
  assert.match(styles, /grid-template-columns:44px minmax\(0,1fr\) minmax\(210px,28%\);grid-template-rows:minmax\(0,1fr\)/);
  assert.match(descriptor.template.content, /v-if="mobileLandscape && workspaceOpen"[^>]*class="workspace-drawer-backdrop"[^>]*@click="closeWorkspace"/);
  assert.match(styles, /\.song-workspace.workspace-drawer\{position:fixed;[^}]*z-index:60;/);
  assert.match(styles, /\.mobile-landscape>\.mobile-inspector\{grid-column:3;grid-row:1;/);
  assert.match(styles, /\.mobile-landscape \.inspector-tabs\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/);
  assert.match(styles, /\.landscape-transport>\.playback-message-bar\{position:absolute;left:0;right:0;top:0;bottom:auto;/);
  assert.match(styles, /\.mobile-landscape \.editor>\.timeline-frame\{flex:2 1 165px;height:auto;min-height:72px\}/);
  assert.match(styles, /@container\(min-height:360px\)\{\.mobile-landscape \.document-toolbar\{display:flex\}\}/);
  assert.match(styles, /main:has\(\.mobile-landscape\)\{padding-bottom:0\}/);
  assert.match(styles, /\.landscape-transport\{position:relative;left:auto;right:auto;bottom:auto;/);
  assert.match(styles, /\.mobile-landscape \.editor>\.overview\{[^}]*flex:0 0 auto;/);
  assert.match(styles, /\.mobile-landscape \.overview-wave\{flex:0 0 40px;min-height:40px;max-height:40px\}/);
  assert.match(styles, /\.mobile-landscape \.overview-caption\{flex:0 0 24px;min-height:24px;flex-wrap:nowrap;/);
  assert.match(styles, /\.landscape-transport\{[^}]*padding-top:0\}/);
  assert.match(styles, /\.landscape-transport:has\(>\.playback-message-bar\)\{padding-top:32px\}/);
  assert.match(styles, /\.landscape-transport>\.playback-message-bar\{[^}]*top:0;bottom:auto;[^}]*height:32px;max-height:32px;/);
  assert.match(styles, /@container\(max-width:480px\)\{\.mobile-landscape \.overview-legend-label\{display:none\}\}/);
});

test('short portrait layouts size the timeline row to its content instead of spare height', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'short-portrait-layout' });
  assert.match(descriptor.styles[0].content, /@media\(max-width:900px\)\{\.studio-panel-body:has\(#timeline\)\{grid-template-rows:auto minmax\(0,max-content\) minmax\(0,1fr\)\}/);
  assert.doesNotMatch(descriptor.styles[0].content, /grid-template-rows:auto minmax\(0,4fr\)/);
});

test('landscape inspector tabs match their panel heading icons while portrait tabs retain text', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'landscape-icon-tabs' });
  const icons = descriptor.scriptSetup.content.match(/const inspectorIcons = \[([^\]]+)\]/)[1].split(', ');
  const timeline = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8')).descriptor.template.content;
  const branch = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8')).descriptor.template.content;
  for (const [index, label, template] of [[1, '落点信息', timeline], [2, '全局导航', timeline], [3, '谱面分歧', branch]]) {
    const headingIcon = template.match(new RegExp(`<SectionHeading[^>]*:icon="([^"]+)" :title="t\\('${label}'\\)"`))[1];
    assert.equal(icons[index], headingIcon, label);
  }
  const tabs = descriptor.template.content.match(/<div class="inspector-tabs"[\s\S]*?<\/div>/)[0];
  assert.match(tabs, /:aria-label="t\(label\)" :title="mobileLandscape \? t\(label\) : undefined"/);
  assert.match(tabs, /<component v-if="mobileLandscape" :is="inspectorIcons\[index\]" aria-hidden="true" \/><span v-else>\{\{ t\(label\) \}\}<\/span>/);
});

test('landscape keeps top menus and switches open charts through a single-line dropdown', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'landscape-chart-picker' });
  const header = descriptor.template.content.match(/<header>[\s\S]*?<\/header>/)[0];
  assert.match(header, /<select v-if="mobileLandscape" id="opened-chart-select" v-model="activeDocument"/);
  assert.match(header, /:aria-label="t\(state.documents.length \? '已打开谱面' : '尚未打开谱面'\)"/);
  assert.match(header, /:title="state.documents.length \? state.filename \|\| t\('已打开谱面'\) : t\('尚未打开谱面'\)"/);
  assert.match(header, /<option v-if="!state.documents.length"[^>]*>\{\{ t\('尚未打开谱面'\) \}\}<\/option>/);
  assert.match(header, /:disabled="!state.documents.length"/);
  assert.match(header, /<option v-for="document in state.documents"[^>]*:value="document.id"/);
  assert.match(header, /document.dirty \|\| document.invalid/);
  assert.ok(header.indexOf('id="opened-chart-select"') < header.indexOf('ref="settingsMenu"'));
  assert.match(descriptor.styles[0].content, /\.file-actions:has\(~\.landscape-chart-picker\)\{flex-shrink:0\}/);
  assert.match(descriptor.styles[0].content, /\.landscape-chart-picker\+\.settings-popover\{margin-left:0\}/);
  assert.match(descriptor.template.content, /<nav class="chart-tabs" v-show="!mobileLandscape"/);
  assert.doesNotMatch(descriptor.template.content, /mobile-menu-panel/);
  assert.match(descriptor.styles[0].content, /\.landscape-chart-picker\{[^}]*min-width:0;[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
  assert.ok(descriptor.styles[0].content.includes('.studio-panel-body.mobile-landscape:not(:has(>.song-workspace)){grid-template-columns:minmax(0,1fr)}'));
  assert.ok(descriptor.styles[0].content.includes('.studio-panel-body.mobile-landscape:not(:has(>.song-workspace))>.editor-core{grid-column:1 / -1}'));
  const calls = [], state = { activeId: 12 };
  const studio = { switchChart(id) { calls.push(id); state.activeId = id; } };
  const source = descriptor.scriptSetup.content.match(/const activeDocument = computed\([^\n]+;/)[0];
  const activeDocument = runInNewContext(`${source}; activeDocument`, { computed, state, studio });
  assert.equal(activeDocument.value, 12);
  activeDocument.value = 24;
  assert.deepEqual(calls, [24]);
  assert.equal(state.activeId, 24);
});

test('mobile inspector keyboard navigation wraps, supports endpoints and leaves editing keys alone', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.match(/function inspectorKeydown\(event, index\) \{[\s\S]*?\n\}/)[0];
  const inspectorTabs = runInNewContext(descriptor.scriptSetup.content.match(/const inspectorTabs = (\[[^\n]*?\])/)[0] + '; inspectorTabs');
  assert.deepEqual(Array.from(inspectorTabs), ['谱面编辑', '落点信息', '全局导航', '谱面分歧']);
  const inspectorTab = { value: 0 }, focused = [];
  const handler = runInNewContext(`${source}; inspectorKeydown`, { inspectorTab, inspectorTabs });
  const children = inspectorTabs.map((_, index) => ({ focus() { focused.push(index); } }));
  let prevented = 0, stopped = 0;
  for (const [key, index, expected] of [['ArrowLeft', 0, 3], ['ArrowRight', 3, 0], ['End', 0, 3], ['Home', 3, 0]]) {
    handler({ key, preventDefault() { prevented++; }, stopPropagation() { stopped++; }, currentTarget: { parentElement: { children } } }, index);
    assert.equal(inspectorTab.value, expected);
    assert.equal(focused.at(-1), expected);
  }
  handler({ key: 'a', preventDefault() { throw new Error('Editing key intercepted'); } }, 0);
  handler({ key: 'ArrowRight', ctrlKey: true, preventDefault() { throw new Error('Modified key intercepted'); } }, 0);
  assert.equal(prevented, 4); assert.equal(stopped, 4);
  assert.match(descriptor.template.content, /<section v-show="studio.bar.value && mobileWorkspace" class="mobile-inspector"/);
  assert.equal([...descriptor.template.content.matchAll(/class="inspector-tab-panel" role="tabpanel"/g)].length, 4);
  assert.match(descriptor.template.content, /:aria-controls="\['mobile-edit-panel', 'mobile-position-panel', 'mobile-navigation-panel', 'mobile-branch-panel'\]\[index\]"/);
  for (const [index, panel] of ['edit', 'position', 'navigation', 'branch'].entries()) {
    assert.match(descriptor.template.content, new RegExp(`v-show="inspectorTab === ${index}" id="mobile-${panel}-panel" class="inspector-tab-panel" role="tabpanel" aria-labelledby="inspector-tab-${index}"`));
  }
  assert.match(descriptor.template.content, /v-show="inspectorTab === 3" id="mobile-branch-panel" class="inspector-tab-panel" role="tabpanel" aria-labelledby="inspector-tab-3"/);
  const timeline = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8')).descriptor;
  assert.match(timeline.template.content, /<Teleport to="#mobile-navigation-panel" :disabled="!mobile" defer>\s*<section class="measure-section">[\s\S]*<MeasureGrid id="measures"[\s\S]*<\/section>\s*<\/Teleport>/);
  assert.match(descriptor.styles[0].content, /\.inspector-tab-panel\{[^}]*min-height:0;overflow:auto;overscroll-behavior:contain/);
});

test('selecting custom snap opens secondary tools before focusing and presets retain direct snapping', async () => {
  const { descriptor } = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.match(/async function snapChange\(\) \{[\s\S]*?\n\}/)[0];
  const controls = { snapChoice: 'custom' }, toolsOpen = { value: false }, hover = { value: {} }, calls = [];
  const handler = runInNewContext(`${source}; snapChange`, {
    controls, toolsOpen, hover,
    customSnap: { value: { focus() { assert.equal(toolsOpen.value, true); calls.push('focus'); } } },
    nextTick: async () => { calls.push('tick'); },
    studio: { setSnap(value) { calls.push(value); } }
  });
  await handler();
  assert.equal(hover.value, null);
  assert.deepEqual(calls, ['tick', 'focus']);
  controls.snapChoice = '24'; toolsOpen.value = false; calls.length = 0;
  await handler();
  assert.deepEqual(calls, [24]);
  assert.equal(toolsOpen.value, false);
});

test('compact playback menu closes on Escape and returns focus without changing playback', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.match(/function playbackKeydown\(event\) \{[\s\S]*?\n\}/)[0];
  const compactTransport = { value: true }, playbackMenuOpen = { value: true };
  let focused = 0, prevented = 0, stopped = 0;
  const handler = runInNewContext(`${source}; playbackKeydown`, {
    compactTransport, playbackMenuOpen, playbackMenu: { value: { open: true, querySelector: () => ({ focus() { focused++; } }) } }
  });
  const event = { key: 'Escape', preventDefault() { prevented++; }, stopPropagation() { stopped++; } };
  handler(event);
  assert.equal(playbackMenuOpen.value, false);
  assert.equal(focused, 1); assert.equal(prevented, 1); assert.equal(stopped, 1);
  compactTransport.value = false; playbackMenuOpen.value = true; handler(event);
  assert.equal(playbackMenuOpen.value, true); assert.equal(focused, 1);
  assert.match(descriptor.styles[0].content, /\.compact-playback:not\(\[open\]\)>\.transport-right\{display:none\}/);
});

test('dismissible audio and error messages sit above playback with no legacy status bar or audio attention animation', () => {
  const { descriptor } = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'bottom-status' });
  const template = descriptor.template.content;
  assert.doesNotMatch(template, /id="notice"|mobile-open-audio/);
  const scrolling = template.slice(template.indexOf('<div class="editor-scroll">'), template.indexOf('<Teleport to="body"'));
  assert.doesNotMatch(scrolling, /id="playback-message-bar"/);
  const host = template.match(/<div ref="transportHost" class="transport-host"[^>]*>[\s\S]*?<\/Teleport>/)[0];
  assert.match(host, /id="playback-message-bar"[\s\S]*:role="messageBarError \? 'alert' : 'status'"/);
  assert.match(host, /id="message-load-audio"[^>]*@click="audioFile.click\(\)"/);
  assert.match(host, /:aria-label="t\('关闭提示'\)" @click="dismissMessageBar"/);
  assert.ok(host.indexOf('id="playback-message-bar"') < host.indexOf('class="transport"'));
  assert.match(descriptor.scriptSetup.content, /transportObserver.observe\(transportHost.value\)/);
  const styles = descriptor.styles[0].content;
  assert.doesNotMatch(styles + descriptor.scriptSetup.content, /#notice|audioAttention|audio-entry-attention/);
  assert.match(styles, /\.playback-message-bar\{[^}]*height:36px;max-height:36px;overflow:hidden;/);
  assert.match(styles, /\.playback-message-bar.error\{[^}]*color:#bd352b/);
  assert.match(styles, /\.transport\{padding-bottom:calc\(7px \+ env\(safe-area-inset-bottom,0px\)\)\}/);
});

test('branch lists combine route filtering and condition editors while structural forms use a dialog', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'branch-controls' });
  const dialogs = [...descriptor.template.content.matchAll(/<dialog\b[\s\S]*?<\/dialog>/g)].map(match => match[0]);
  assert.equal(dialogs.length, 1);
  const [action] = dialogs;
  const manager = descriptor.template.content.slice(descriptor.template.content.indexOf('<div class="branch-manager"'));
  assert.match(descriptor.template.content, /class="route-segments branch-route-filter" role="group" :aria-label="t\('路线筛选'\)"/);
  assert.match(descriptor.template.content, /:aria-pressed="uniform === route"[^>]*@click="studio.changeAllBranches\(route\)"/);
  assert.match(manager, /studio.changeBranch\(branch.index, route\)/);
  assert.match(manager, /locate\(branch\)/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /filterDialog|filterList|openFilter/);
  assert.match(manager, /role="group" :aria-label="t\('全局分歧管理'\)"/);
  assert.doesNotMatch(manager, /<form|id="branch-create"|edit\(branch, 'condition'\)/);
  assert.match(manager, /class="branch-condition-fields inline-condition"/);
  for (const field of ['condition', 'lower', 'upper']) assert.ok(manager.includes(`updateCondition(branch, '${field}', $event.target.value)`));
  assert.match(action, /aria-labelledby="branch-action-title"/);
  assert.match(action, /<form v-if="mode"/);
  assert.match(action, /mode === 'create'/);
  assert.match(action, /mode === 'remove'/);
  assert.doesNotMatch(action, /mode === 'condition'|mode === 'removeRoute'/);
  assert.doesNotMatch(descriptor.template.content, /branch-manager-help|创建、删除分歧及路线，编辑判定条件。|BPM、拍号和延迟在所有路线的对应小节及落点同步/);
  assert.match(manager, /@click="removeRoute\(branch, route\)"/);
  assert.match(descriptor.styles[0].content, /\.branch-route-card\{position:relative\}/);
  assert.match(descriptor.styles[0].content, /\.branch-route-card \.route-select:not\(:disabled\)::after\{content:'';position:absolute;inset:0\}/);
  assert.match(descriptor.styles[0].content, /\.branch-route-card \.route-remove\{position:relative;z-index:1\}/);
  assert.doesNotMatch(manager, /role="radiogroup"|studio.changeAllBranches/);
  for (const dialog of dialogs) {
    assert.doesNotMatch(dialog, /type="search"|v-model="query"/);
    assert.doesNotMatch(dialog, /t\('完成'\)/);
    assert.match(dialog, /:aria-label="t\('关闭'\)"/);
  }
  assert.match(manager, /v-for="branch in sortedBranches"/);
  assert.doesNotMatch(descriptor.template.content, /id="branch-filter"/);
  assert.doesNotMatch(descriptor.template.content, /id="branch-manage"/);
  assert.match(descriptor.template.content, /<\/SectionHeading>\s*<div class="branch-actions">\s*<button id="branch-create"[^>]*@click="create"[\s\S]*?class="route-segments branch-route-filter"/);
  assert.match(descriptor.styles[0].content, /\.branch-route-filter\{margin-left:auto;/);
  assert.match(descriptor.template.content, /<div v-if="state.branchRouteWarning" id="branch-route-message" class="branch-route-message" role="status">/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /\bInfo\b/);
  assert.match(descriptor.styles[0].content, /\.branch-route-message\{[^}]*padding:10px;/);
  assert.match(descriptor.styles[0].content, /\.branch-route-message p\{[^}]*line-height:20px;/);
  assert.match(descriptor.styles[0].content, /\.branch-route-message p\{[^}]*transform:translateY\(-\.5px\)/);
  assert.match(descriptor.styles[0].content, /\.branch-route-message \.message-dismiss\{width:20px;height:20px;min-height:20px;padding:3px;/);
  assert.match(descriptor.template.content, /v-for="item in state.branchRouteWarning.branches"/);
  assert.match(descriptor.template.content, /@click="state.branchRouteWarning = null"/);
  assert.match(descriptor.template.content, /class="branch-route-text" :data-route="item.route"/);
  assert.match(descriptor.styles[0].content, /\.branch-route-filter button\[aria-pressed=true\]\{background:var\(--route-hover-background\);color:var\(--route-color\)/);
  assert.match(descriptor.styles[0].content, /\.branch-manager \.branch-route-list\{max-height:none;overflow:visible;display:flex;flex-direction:column;gap:10px;border:0;border-radius:0\}/);
  assert.match(manager, /class="branch-row-heading">[\s\S]*?<\/div>\s*<div class="branch-card-body">\s*<fieldset/);
  assert.match(descriptor.styles[0].content, /\.branch-manager \.branch-route-row\{gap:0;padding:0;border:1px solid var\(--line\);border-radius:8px;background:#fff;overflow:hidden\}/);
  assert.match(descriptor.styles[0].content, /\.branch-manager \.branch-row-heading\{padding:6px 8px;border-bottom:1px solid var\(--line\);background:#f4f7f5\}/);
  assert.match(descriptor.styles[0].content, /\.branch-manager \.branch-row-heading>\.branch-jump:is\(:hover,:focus-visible\):not\(:disabled\),\.branch-manager \.branch-row-heading>\.icon:is\(:hover,:focus-visible\):not\(:disabled\)\{background:#e1ece5;color:var\(--green\)\}/);
  assert.match(descriptor.styles[0].content, /\.branch-actions\{display:flex;flex-basis:100%;gap:8px\}/);
  assert.match(descriptor.styles[0].content, /\.branch-actions>\.manage-branches\{min-height:32px;padding:5px 10px\}/);
  assert.match(descriptor.template.content, /id="branch-create"[^>]*:title="t\('创建分歧'\)" :aria-label="t\('创建分歧'\)"/);
  assert.match(descriptor.template.content, /class="branch-create-label">\{\{ t\('创建分歧'\) \}\}<\/span>/);
  assert.doesNotMatch(descriptor.template.content, /<dialog[^>]*\bopen(?:\s|>)/);
  assert.match(descriptor.styles[0].content, /\.branch-context\{[^}]*margin:0;padding:16px 12px;border-bottom:1px solid var\(--line\);background:#fff/);
  const app = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8')).descriptor;
  assert.match(app.template.content, /<div class="editor-scroll">\s*<TimelineEditor v-if="studio.bar.value" :mobile="mobileWorkspace" :landscape="mobileLandscape" \/>/);
  assert.doesNotMatch(app.template.content, /<BranchControls/);
  const timeline = parse(readFileSync(new URL('TimelineEditor.vue', import.meta.url), 'utf8')).descriptor;
  assert.match(timeline.template.content, /<div class="editor-information">\s*<div class="editor-information-left">\s*<Teleport to="#mobile-position-panel" :disabled="!mobile" defer>\s*<section class="cell-inspector"[\s\S]*?<\/dl>\s*<\/section>\s*<\/Teleport>\s*<Teleport to="#mobile-navigation-panel" :disabled="!mobile" defer>\s*<section class="measure-section">[\s\S]*?<\/section>\s*<\/Teleport>\s*<\/div>\s*<Teleport to="#mobile-branch-panel" :disabled="!mobile" defer><BranchControls \/><\/Teleport>\s*<\/div>/);
  assert.match(timeline.styles[0].content, /\.editor-information\{display:grid;grid-template-columns:minmax\(0,1fr\) 420px;grid-template-rows:minmax\(0,1fr\);align-items:stretch;flex:1;min-height:0;overflow:hidden\}/);
  assert.match(timeline.styles[0].content, /\.editor-core:has\(#timeline\) \.editor-scroll\{display:flex;overflow:hidden\}/);
  assert.match(timeline.styles[0].content, /\.workspace>\.editor\{display:flex;flex-direction:column;min-height:0;overflow:hidden\}/);
  assert.match(timeline.styles[0].content, /\.editor>\.editor-bar,\.editor>\.timeline-frame,\.editor>\.overview\{flex-shrink:0\}/);
  assert.match(descriptor.styles[0].content, /\.branch-manager \.branch-route-cards\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
  assert.match(app.styles[0].content, /\.mobile-landscape \.branch-manager \.branch-route-cards\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(timeline.styles[0].content, /\.editor-information-left\{grid-column:1;grid-row:1;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin\}/);
  assert.match(timeline.styles[0].content, /\.editor-information-left>\.measure-section,#mobile-navigation-panel>\.measure-section\{min-width:0;border-top:1px solid var\(--line\)\}/);
  assert.match(timeline.styles[0].content, /\.editor-information>section\.branch-context\{grid-column:2;grid-row:1;/);
  assert.match(timeline.styles[0].content, /\.editor-information>section\.branch-context\{[^}]*min-height:0;overflow:auto;overscroll-behavior:contain;/);
  assert.match(timeline.styles[0].content, /\.editor-information>section\.branch-context\{[^}]*width:420px;max-width:100%;min-width:0;/);
  assert.match(timeline.styles[0].content, /\.editor-information>section\.branch-context\{[^}]*align-self:stretch;align-content:start;/);
  assert.match(timeline.styles[0].content, /@container\(max-width:840px\)\{\.editor-information\{grid-template-columns:minmax\(0,1fr\);grid-template-rows:auto;align-content:start;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin\}\.editor-information-left\{display:contents\}\.editor-information-left>\.cell-inspector,\.editor-information-left>\.measure-section,\.editor-information>section\.branch-context\{grid-column:1;grid-row:auto\}/);
  assert.match(timeline.styles[0].content, /@container\(max-width:840px\)\{[^\n]*\.editor-information>section\.branch-context\{width:auto;overflow:visible;border-left:0\}/);
  assert.match(timeline.styles[0].content, /\.editor-information>section\.branch-context\{[^}]*border-bottom:0\}/);
  assert.doesNotMatch(app.styles[0].content, /\.chart-context/);
});

test('branch management keeps measure details in the title and places route actions beside names', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'branch-measure-summary' });
  const manager = descriptor.template.content.slice(descriptor.template.content.indexOf('<div class="branch-manager"'));
  assert.match(manager, /<strong>\{\{ branchTitle\(branch\) \}\}<\/strong>/);
  assert.doesNotMatch(manager, /class="branch-measures"|t\('(?:起始小节|结束小节|小节数：)/);
  const cards = manager.match(/<div class="branch-route-cards">([\s\S]*?)<\/article>/)[1];
  assert.doesNotMatch(cards, /<small|小节数/);
  assert.match(cards, /class="route-select"[\s\S]*<strong>[\s\S]*<\/strong>[\s\S]*<\/button>\s*<button[^>]*class="route-remove"/);
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
  assert.match(cards, /selected: branch.routes.includes\(route\) && branch.route === route/);
  for (const route of ['N', 'E', 'M']) {
    assert.ok(styles.includes(`.branch-route-card[data-route=${route}]:not(.missing){background:#`));
  }
  assert.match(styles, /\.branch-route-card\.missing\{[^}]*background:#[0-9a-f]{6};/);
  assert.doesNotMatch(styles, /\.branch-route-card\.missing\{[^}]*background:transparent/);
  assert.match(styles, /\.branch-route-card\.missing\{border-style:dashed;/);
  assert.match(styles, /\.branch-route-card\[data-route\]\.selected\{border-color:var\(--route-color\);border-left-width:3px;border-right-width:3px;padding:6px 8px;box-shadow:none\}/);
  assert.match(styles, /\.branch-manager \.branch-route-card\.selected\{padding:6px 3px\}/);
  assert.match(styles, /\.branch-route-card:has\(\.route-select:not\(:disabled\)\):is\(:hover,:focus-within\)\{background:color-mix\(in srgb,var\(--route-hover-background\) 90%,var\(--route-color\)\);border-color:var\(--route-color\)\}/);
  assert.match(styles, /\.branch-route-card \.route-select:hover:not\(:disabled\),\.branch-route-card \.route-remove:hover:not\(:disabled\)\{background:transparent\}/);
  assert.doesNotMatch(styles, /\.branch-route-card \.route-(?:select|remove):hover[^}]*background:#ffffff80/);
  assert.doesNotMatch(descriptor.scriptSetup.content + cards, /route-check|\bCheck\b/);
  assert.match(cards, /<span v-else class="route-subtitle">\{\{ t\(names\[route\]\) \}\}<\/span>/);
  assert.match(descriptor.template.content, /<h2 id="branch-action-title">\{\{ actionTitle \}\}<template v-if="mode === 'route' \|\| mode === 'remove-route'"> - <span id="branch-action-route" class="branch-route-text" :data-route="fields.route">\{\{ actionSubtitle \}\}/);
  assert.doesNotMatch(descriptor.template.content, /branch-action-subtitle/);
  assert.match(styles, /\.branch-manager \.branch-route-card\{padding:6px 10px\}/);
  assert.match(styles, /\.branch-manager \.branch-route-row\[aria-current=true\]\{box-shadow:none\}/);
  assert.match(styles, /\.branch-manager \.branch-jump,\.branch-manager \.branch-row-heading>\.icon,\.branch-route-card \.route-select,\.branch-route-card \.route-remove\{font-family:inherit;font-size:12px;font-weight:400;line-height:1\.4;color:inherit;border:0;background:transparent;box-shadow:none\}/);
  assert.match(styles, /\.branch-manager \.branch-jump strong,\.branch-route-card strong\{font-family:inherit;font-weight:400\}/);
  assert.doesNotMatch(descriptor.scriptSetup.content + manager, /LocateFixed/);
  assert.match(cards, /<Plus v-if="!branch.routes.includes\(route\)" aria-hidden="true" \/>/);
  assert.match(cards, /:aria-pressed="branch.routes.includes\(route\) \? branch.route === route : undefined"/);
  assert.match(cards, /:disabled="state.invalid \|\| \(!branch.routes.includes\(route\) && !branch.barCount\)"/);
  assert.match(cards, /@click="branch.routes.includes\(route\) \? studio.changeBranch\(branch.index, route\) : edit\(branch, 'route', route\)"/);
  assert.doesNotMatch(cards, /route-create-hint|<a\b/);
  assert.match(cards, /:aria-label="t\('删除路线 \{p0\}', \{ p0: route \}\)" @click="removeRoute\(branch, route\)"><X \/><\/button>/);
  assert.match(cards, /t\('创建分歧 - \{p0\}', \{ p0: t\(names\[route\]\) \}\)/);
  assert.doesNotMatch(cards, /创建路线|\{\{ route \}\}/);
  assert.doesNotMatch(cards, /<Trash2|t\('删除'\)/);
});

test('branch dialog supports Escape and named creation while inline filters allow partially available routes', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  const source = descriptor.scriptSetup.content.replace(/^import .*;\n/gm, '');
  const calls = [];
  const state = reactive({ branchRoutes: ['N', 'N'], chart: { branches: [{ index: 0, routes: ['N', 'E'] }, { index: 1, routes: ['N', 'M'] }] } });
  const controls = runInNewContext(`${source}; ({ locate, keydown, dialog, mode, error, fields, actionTitle, actionSubtitle, available, uniform })`, {
    ref, reactive, computed, watch, t, BRANCH_ROUTES: ['N', 'E', 'M'], names: { N: '普通', E: '玄人', M: '达人' }, inject: () => ({
      state, selectedTiming: ref(null), pause: () => calls.push('pause'), select: index => calls.push(index)
    })
  });
  const owner = name => ({ showModal: () => calls.push(`open:${name}`), close: () => calls.push(`close:${name}`) });
  const manager = owner('action');
  controls.dialog.value = manager;
  assert.deepEqual(Array.from(controls.available.value), ['N', 'E', 'M']);
  assert.equal(controls.uniform.value, 'N');
  state.branchRoutes = ['E', 'M'];
  assert.equal(controls.uniform.value, null);
  controls.locate({ firstBarIndex: 6 });
  assert.deepEqual(calls.splice(0), [6]);
  const escape = currentTarget => controls.keydown({ key: 'Escape', currentTarget, preventDefault() {}, stopPropagation() {} });
  controls.mode.value = 'create'; controls.error.value = 'failed';
  escape(manager);
  assert.equal(controls.mode.value, ''); assert.equal(controls.error.value, '');
  assert.deepEqual(calls.splice(0), ['close:action']);
  escape(manager);
  assert.deepEqual(calls, ['close:action']);
  try {
    controls.mode.value = 'route';
    for (const language of languages) {
      locale.value = language.code;
      for (const [route, name] of Object.entries({ N: '普通', E: '玄人', M: '达人' })) {
        controls.fields.route = route;
        assert.equal(controls.actionTitle.value, t('创建分歧'));
        assert.equal(controls.actionSubtitle.value, t(name));
      }
    }
  } finally { reset(); }
});

test('branch creation groups equal-width route and source fields and displays errors next to actions', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'branch-creation-layout' });
  const template = descriptor.template.content;
  const fields = template.match(/<div v-if="mode === 'create'" class="branch-source-fields">[\s\S]*?<\/div>/)[0];
  assert.match(fields, /id="branch-initial-route"/);
  assert.match(fields, /id="branch-source"/);
  const routeSources = template.match(/<div v-if="mode === 'route'" class="route-source-actions">[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(routeSources, /<select|type="submit"/);
  assert.match(routeSources, /@click="createRoute\(''\)"/);
  assert.match(routeSources, /@click="createRoute\(route\)"/);
  assert.match(template, /class="branch-form-actions"><button id="branch-cancel" type="button" @click="close">\{\{ t\('取消'\) \}\}<\/button><button v-if="mode === 'create' \|\| mode === 'remove-route'" id="branch-apply"/);
  const removal = template.match(/<template v-if="mode === 'remove' \|\| mode === 'remove-last'">[\s\S]*?<\/template>/)[0];
  assert.doesNotMatch(removal, /<select|type="submit"/);
  assert.match(removal, /@click="removeBranch\(route\)"/);
  assert.match(removal, /@click="removeBranch\(''\)"/);
  assert.match(removal, /v-if="mode === 'remove-last'"[\s\S]*删除最后一条路线将同时删除整个分歧，小节和指令保留。/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /\bconfirm\s*\(/);
  const form = template.match(/<form v-if="mode"[\s\S]*?<\/form>/)[0];
  assert.match(form, /class="branch-route-error" role="alert"[\s\S]*?<\/p>\s*<div class="branch-form-actions">/);
  assert.match(template, /v-if="!mode && \(error \|\| state.error\)" class="branch-route-error"/);
  assert.match(descriptor.styles[0].content, /\.branch-source-fields\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(descriptor.styles[0].content, /\.branch-source-fields select\{[^}]*max-width:none/);
  assert.match(descriptor.styles[0].content, /\.branch-form \.branch-route-error\{color:#bd3b30\}/);
});

test('all modal shells share typography, spacing, responsive geometry and action styling', () => {
  const styles = readFileSync(new URL('style.css', import.meta.url), 'utf8');
  assert.match(styles, /dialog\{--dialog-width:420px;[^}]*max-height:calc\(100dvh - 24px\);[^}]*padding:20px;[^}]*border-radius:8px;/);
  assert.match(styles, /dialog h2\{margin:0 0 16px;font-size:16px;line-height:1.4;/);
  assert.match(styles, /dialog p:not\(\.selection-help\)\{margin:0;font-size:12px;line-height:1.7;/);
  assert.match(styles, /dialog::backdrop\{background:#202a2870\}/);
  assert.match(styles, /\.selection-dialog-actions,\.course-dialog-actions,\.branch-form-actions,\.delete-measure-actions\)\{[^}]*flex-wrap:wrap;[^}]*margin-top:20px/);
  assert.match(styles, /@media\(max-width:600px\)\{dialog\{padding:16px\}\}/);
  for (const file of ['App.vue', 'CourseControls.vue', 'BranchControls.vue', 'TimelineEditor.vue']) {
    const { descriptor } = parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
    compileScript(descriptor, { id: 'shared-modal-shell' });
    assert.doesNotMatch(descriptor.styles[0].content, /\.(?:selection|course|branch|delete-measure)-dialog\{[^}]*border-radius:/);
    assert.doesNotMatch(descriptor.styles[0].content, /\.(?:selection|course|branch|delete-measure)-dialog::backdrop/);
  }
});

test('modal deletion buttons use shared danger styling while route themes stay on names', () => {
  const styles = readFileSync(new URL('style.css', import.meta.url), 'utf8');
  assert.match(styles, /dialog button:is\(\.delete-action,\.danger,\.danger-action,#delete-measure-confirm\)\{border:1px solid #bd3b30!important;background:#fff0ee;color:#b42318\}/);
  assert.match(styles, /dialog button:is\([^}]+\):hover:not\(:disabled\)\{background:#ffe0db;color:#961b11;/);
  assert.match(styles, /dialog button:is\([^}]+\):active:not\(:disabled\)\{background:#ffd0c8\}/);
  assert.match(styles, /dialog button:is\([^}]+\):focus-visible\{outline:2px solid #b42318;/);
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  const template = descriptor.template.content;
  for (const attribute of ['data-source', 'data-keep']) {
    assert.match(template, new RegExp(`<button[^>]*:${attribute}="route"[^>]*>[\\s\\S]*?<span class="branch-route-text" :data-route="route">`));
    assert.doesNotMatch(template, new RegExp(`<button[^>]*class="branch-route-text"[^>]*:${attribute}=`));
  }
  assert.doesNotMatch(template.slice(template.indexOf('<div class="branch-manager"')), /class="[^\"]*delete-action/);
});

test('branch empty state groups a decorative icon and localized label without duplicate actions', () => {
  const { descriptor } = parse(readFileSync(new URL('BranchControls.vue', import.meta.url), 'utf8'));
  compileScript(descriptor, { id: 'branch-empty-state' });
  const empty = descriptor.template.content.match(/<p v-if="!sortedBranches.length" class="no-branches">[\s\S]*?<\/p>/)[0];
  assert.match(empty, /<GitBranch aria-hidden="true" :stroke-width="1.5" \/>/);
  assert.match(empty, /<span>\{\{ t\('暂无分歧'\) \}\}<\/span>/);
  assert.doesNotMatch(empty, /<button|<a\b/);
  assert.match(descriptor.styles[0].content, /\.branch-manager \.no-branches\{display:flex;align-items:center;justify-content:center;gap:12px;min-height:88px;/);
  assert.match(descriptor.styles[0].content, /\.branch-manager \.no-branches\{[^}]*border:1px dashed var\(--line\);border-radius:8px;background:#f8faf9;/);
  assert.match(descriptor.styles[0].content, /\.branch-manager \.no-branches svg\{width:28px;height:28px;/);
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
  assert.match(sidebar.styles[0].content, /\.song-workspace\{[^}]*border-top:0;/);
  assert.doesNotMatch(sidebar.template.content, /<h2/);
  assert.match(sidebar.styles[0].content, /\.metadata-icon\{color:var\(--green\)\}/);
  assert.match(sidebar.template.content, /:data-song-field="field.key"/);
  assert.match(sidebar.template.content, /@change="updateMetadata\(field.key, \$event\)"/);
  assert.match(sidebar.template.content, /class="metadata-group" :open="group.expanded"/);
  assert.match(sidebar.template.content, /<details ref="metadata" class="metadata-editor" open>/);
  assert.match(sidebar.scriptSetup.content, /label: '基本信息', expanded: false/);
  assert.match(sidebar.scriptSetup.content, /label: '多语言信息', expanded: false/);
  assert.match(sidebar.scriptSetup.content, /label: '多语言信息'/);
  assert.match(sidebar.scriptSetup.content, /SONG_FIELDS.filter\(field => field.localized\)/);
  const app = parse(readFileSync(new URL('App.vue', import.meta.url), 'utf8')).descriptor;
  assert.match(app.template.content, /<SongWorkspace v-if="state.chart" ref="workspaceSidebar" :collapsed="!workspaceOpen"/);
  assert.match(app.template.content, /<TimelineEditor v-if="studio.bar.value"/);
  assert.match(app.template.content, /v-else class="empty-editor"/);
  assert.match(app.template.content, /v-for="course in COURSE_NAMES"/);
  assert.match(app.template.content, /:data-create-course="course"/);
  assert.match(app.template.content, /studio.createCourse\(\{ course, player: 'single', style: 'Single', level: 1 \}\)/);
  assert.match(app.template.content, /v-else class="empty-start-actions"[\s\S]*id="empty-welcome-guide"[^>]*class="primary"[^>]*@click="welcomeGuide.open\(\)"/);
  assert.match(app.template.content, /class="welcome-intro"[\s\S]*t\('欢迎使用 \{p0\}', \{ p0: productMetadata.displayName \}\)[\s\S]*跟着音乐放下音符，边听边调整[\s\S]*不必编写 TJA 代码。[\s\S]*电脑、手机还是平板[\s\S]*键盘快捷键、鼠标操作和触屏手势[\s\S]*初次使用？通过快速上手，了解谱面编辑的基本操作。[\s\S]*id="empty-welcome-guide"[\s\S]*t\('开始上手'\)[\s\S]*class="welcome-files"[\s\S]*id="empty-new-chart"[\s\S]*id="empty-open-chart"/);
  assert.match(app.template.content, /id="empty-new-chart"[^>]*@click="studio.newChart"/);
  assert.match(app.template.content, /id="empty-open-chart"[^>]*@click="runFileAction\(chooseCharts\)"/);
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
  for (const id of ['branch-create', 'branch-condition', 'branch-lower', 'branch-upper', 'branch-source', 'branch-delete-empty']) assert.ok(manager.template.content.includes(`id="${id}"`));
  assert.doesNotMatch(manager.template.content, /id="branch-keep"/);
  assert.match(manager.template.content, /<MeasureGrid[^>]*:selection="selection"[^>]*:unavailable="item => item.branchIndex !== null"/);
  assert.match(manager.template.content, /@activate="chooseMeasure" @select="chooseRange"/);
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
  const files = ['App.vue', 'SongWorkspace.vue', 'CourseControls.vue', 'StarRating.vue', 'BranchControls.vue', 'TimelineEditor.vue', 'MeasureGrid.vue', 'MeasureEditor.vue', 'courses.js', 'useStudio.js', 'pwa.js', 'chart.js', 'branch-commands.js', 'grid.js', 'note-model.js', 'balloon.js', 'loop.js', 'history.js', 'metadata.js'];
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
