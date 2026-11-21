import { t, message, LocalizedError, formatMessage } from './i18n.js';
import { computed, onMounted, onUnmounted, reactive, ref, shallowReactive, watch } from 'vue';
import { TJAParser as parser } from 'tja';
import { BRANCH_ROUTES, decodeChart, parseChart, insertEmptyBar, resizeNotes, setBaseBpm, barTimeAt, barStateAt, barStateAtTime, setPositionSettings, clearPositionSettings, barSource } from './chart.js';
import { createHitBuffer, MIX_DEFAULTS, duckMusic } from './hit-audio.js';
import { resolveLoop, measureStart, measureEnd } from './loop.js';
import { GRID_DIVISIONS, MAX_SNAP_DIVISIONS, SNAP_DIVISIONS } from './grid.js';
import { NOTE_TYPES, cellValue, setCellNote, longNoteSpans } from './note-model.js';
import { longHitTimes } from './long-audio.js';
import { balloonInfo, balloonTotals, setBalloonCount, replaceBarWithBalloons, replaceBarSourceWithBalloons, setBranchSourceWithBalloons, setMeasureBranchWithBalloons, deleteBarWithBalloons, copyMeasures as copyMeasureContent, pasteMeasures as pasteMeasureContent } from './balloon.js';
import { HISTORY_LIMIT, textDiff, applyDiff } from './history.js';
import { songMetadata, setSongMetadata } from './metadata.js';
import { addCourse, deleteCourse, addPlayerCharts, setCourseLevel } from './courses.js';
import { createBeatTimeline } from './timeline.js';
import { noteHitRadius } from './note-render.js';

const WORKSPACE_KEY = 'tja-wave-workspace';
const chartFileTypes = () => [{ description: t('TJA 谱面'), accept: { 'text/plain': ['.tja'] } }];
const documentFields = ['text', 'chart', 'selected', 'course', 'branchRoutes', 'buffer', 'peaks', 'position', 'viewStart', 'followPlayback', 'undo', 'redo', 'filename', 'savedText', 'fileHandle', 'saving', 'dirty', 'invalid', 'selectedCell', 'commandCell', 'source', 'sourceState', 'encoding', 'audioName', 'customLoop'];
const emptyDocument = () => ({ text: '', chart: null, selected: 0, course: 0, branchRoutes: [], buffer: null, peaks: [], position: 0, viewStart: 0, followPlayback: true, undo: [], redo: [], filename: 'chart.tja', savedText: null, fileHandle: null, saving: false, dirty: false, invalid: false, selectedCell: null, commandCell: null, source: '', sourceState: '已同步', encoding: '', audioName: '无伴奏 · 可直接播放谱面', customLoop: null });
function chartFilename(name) {
  name = name.trim();
  if (!name || /[\\/:*?"<>|\r\n]/.test(name)) throw new LocalizedError(message('请输入有效的谱面文件名。'));
  return /\.tja$/i.test(name) ? name : `${name}.tja`;
}

export const formatTime = value => {
  const sign = value < 0 ? '-' : '';
  value = Math.abs(value);
  return `${sign}${String(Math.floor(value / 60)).padStart(2, '0')}:${(value % 60).toFixed(3).padStart(6, '0')}`;
};

export function useStudio() {
  const state = shallowReactive({ ...emptyDocument(), documents: [], activeId: null, playing: false, loopAnchor: null, copiedMeasures: null, pasteRequest: 0, editorBlocked: false, fileErrors: [], saveState: '尚未打开谱面', noticeMessage: '请选择 TJA 谱面，可无伴奏播放或载入对应音频。', get notice() { return formatMessage(this.noticeMessage); }, error: false });
  let nextDocumentId = 1, viewAnimation = null, reloadApproved = false;
  const controls = reactive({ hits: true, rate: 1, volume: MIX_DEFAULTS.music, hitVolume: MIX_DEFAULTS.hits, view: 'auto', snap: GRID_DIVISIONS, snapChoice: '16', customSnap: GRID_DIVISIONS });
  const bar = computed(() => state.chart?.bars[state.selected]);
  const spans = computed(() => state.chart ? longNoteSpans(state.chart.bars) : []);
  const range = computed(() => state.customLoop);
  const metadata = computed(() => songMetadata(state.text));
  const duration = computed(() => state.buffer?.duration ?? state.chart?.bars.reduce((end, item) => Math.max(end, measureEnd(item)), 0) ?? 0);
  const timelineBounds = computed(() => state.chart?.bars.reduce((bounds, item) => ({ start: Math.min(bounds.start, measureStart(item)), end: Math.max(bounds.end, measureEnd(item)) }), { start: 0, end: duration.value }) || { start: 0, end: 0 });
  const timelineScale = computed(() => createBeatTimeline(state.chart));
  const timelineWidth = ref(1);
  const viewBeats = computed(() => controls.view === 'auto'
    ? Math.max(1, timelineWidth.value) / (2 * noteHitRadius('1') * .9) / 4
    : 4 * controls.view);
  const visible = computed(() => {
    if (!state.chart) return null;
    const bounds = timelineBounds.value, scale = timelineScale.value;
    const first = scale.beatAt(bounds.start), last = scale.beatAt(bounds.end);
    const startBeat = Math.max(first, Math.min(scale.beatAt(state.viewStart), Math.max(first, last - viewBeats.value)));
    const endBeat = startBeat + viewBeats.value;
    const start = scale.timeAt(startBeat), end = scale.timeAt(endBeat);
    const bars = state.chart.bars.filter(item => measureEnd(item) >= start && measureStart(item) <= end);
    return { bars, start, end, startBeat, endBeat };
  });
  const viewSpan = computed(() => visible.value ? visible.value.end - visible.value.start : 1);
  const chartStats = computed(() => {
    const notes = state.chart?.bars.map(bar => bar.notes).join('') || '';
    return {
      don: [...notes].filter(note => '13A'.includes(note)).length,
      ka: [...notes].filter(note => '24B'.includes(note)).length,
      rollSeconds: spans.value.filter(span => '56'.includes(span.note)).reduce((sum, span) => sum + Math.max(0, span.end - span.start), 0),
      ...balloonTotals(state.text, state.chart)
    };
  });
  const stats = computed(() => {
    const notes = [...(bar.value?.notes || '')];
    return { don: notes.filter(note => '13A'.includes(note)).length, ka: notes.filter(note => '24B'.includes(note)).length, other: notes.filter(note => '56789'.includes(note)).length, total: notes.filter(note => note !== '0').length,
      all: state.chart?.bars.reduce((sum, item) => sum + [...item.notes].filter(note => note !== '0').length, 0) || 0 };
  });
  const cell = computed(() => {
    const selected = state.selectedCell, item = selected && state.chart?.bars[selected.bar];
    if (!item) return null;
    const note = cellValue(item.notes, selected), time = barTimeAt(item, selected.numerator / selected.denominator);
    const { ordinal, count } = balloonInfo(state.text, state.chart, selected);
    return { ...selected, note, time, ordinal, count, name: t(NOTE_TYPES.find(type => type.value === note).name), span: spans.value.find(span => time >= span.start - .000001 && time <= span.end + .000001) };
  });
  function commandAt(position) {
    const item = state.chart?.bars[position.bar];
    if (!item) return null;
    const fraction = position.numerator / position.denominator;
    const commands = fraction === 0 ? item.commands : item.events.filter(event => event.slot * position.denominator === position.numerator * item.notes.length);
    return { ...position, fraction, commands, timing: barStateAt(item, fraction), time: barTimeAt(item, fraction) };
  }
  const command = computed(() => commandAt(state.commandCell || { bar: state.selected, numerator: 0, denominator: 1 }));
  const measureCommand = computed(() => commandAt({ bar: state.selected, numerator: 0, denominator: 1 }));
  const currentTiming = computed(() => {
    if (!state.chart?.bars.length) return null;
    if (!state.playing) {
      const selected = state.selectedCell ? commandAt(state.selectedCell) : command.value;
      return {
        bar: state.chart.bars[selected.bar], ...selected.timing,
        delay: selected.commands.filter(event => event.name === 'DELAY').reduce((sum, event) => sum + Number(event.value), 0)
      };
    }
    const bars = state.chart.bars, time = state.position;
    const item = bars.findLast(item => time >= measureStart(item) && time < measureEnd(item)) ??
      bars.findLast(item => measureStart(item) <= time) ?? bars[0];
    return { bar: item, ...barStateAtTime(item, time) };
  });
  let context, music, gain, musicDuck, hitGain, output, anchor = 0, origin = 0, loopStart = 0, loopEnd = 0, scheduledUntil = 0, playbackRate = 1, looping = false;
  let sourceTimer, scheduler, frame, disposed = false, audioRequest = 0, playRequest = 0;
  const voices = new Set(), hitBuffers = new Map();
  const notice = (message, error = false) => { state.noticeMessage = message; state.error = error; };
  const reportFileError = (error, filename = '') => { state.fileErrors = [...state.fileErrors, { error, filename }]; };
  const guard = action => { try { return action(); } catch (error) { notice(error, true); } };
  function audioContext() {
    if (!context) {
      context = new AudioContext();
      output = context.createDynamicsCompressor(); output.threshold.value = -6; output.knee.value = 6; output.ratio.value = 12; output.attack.value = .002; output.release.value = .12; output.connect(context.destination);
      musicDuck = context.createGain(); musicDuck.connect(output);
      gain = context.createGain(); gain.gain.value = controls.volume / 100; gain.connect(musicDuck);
      hitGain = context.createGain(); hitGain.gain.value = controls.hitVolume / 100; hitGain.connect(output);
    }
    return context;
  }
  function currentTime() {
    if (!state.playing) return state.position;
    let time = origin + Math.max(0, context.currentTime - anchor) * playbackRate;
    if (looping && time >= loopEnd) time = loopStart + (time - loopStart) % (loopEnd - loopStart);
    return Math.min(time, loopEnd);
  }
  function silence() {
    for (const voice of voices) { try { voice.stop(); } catch {} }
    voices.clear();
    if (musicDuck) { musicDuck.gain.cancelScheduledValues(context.currentTime); musicDuck.gain.setValueAtTime(1, context.currentTime); }
  }
  function pause() {
    ++playRequest;
    if (state.playing) state.position = currentTime();
    state.playing = false;
    if (music) { music.onended = null; try { music.stop(); } catch {} music.disconnect(); music = null; }
    silence();
  }
  async function play(from) {
    if (!bar.value) { notice(message('请先创建难度谱面。'), true); return; }
    if (!(duration.value > 0)) { notice(message('谱面没有可播放的正时间区间，请检查 OFFSET 和 DELAY。'), true); return; }
    pause();
    const request = ++playRequest;
    try { await audioContext().resume(); } catch (error) { notice(message('播放失败：{p0}', { p0: error }), true); return; }
    if (disposed || request !== playRequest) return;
    if (range.value) {
      try { const result = resolveLoop(state.chart.bars, ...range.value, duration.value); loopStart = result.start; loopEnd = result.end; }
      catch (error) { notice(error, true); return; }
    } else { loopStart = 0; loopEnd = duration.value; }
    playbackRate = controls.rate; looping = Boolean(range.value);
    let position = from ?? state.position;
    if (looping && (position < loopStart || position >= loopEnd)) position = loopStart;
    if (!looping && position >= loopEnd) position = 0;
    position = Math.max(0, Math.min(position, Math.max(0, duration.value - .001)));
    origin = position; anchor = context.currentTime + .035; scheduledUntil = anchor; state.position = position; state.playing = true;
    viewAnimation = null; state.followPlayback = true; followTime(position);
    if (state.buffer) {
      music = context.createBufferSource(); music.buffer = state.buffer; music.playbackRate.value = playbackRate; music.connect(gain);
      music.loop = looping; music.loopStart = loopStart; music.loopEnd = loopEnd;
      music.onended = () => { if (state.playing) { pause(); state.position = loopEnd; } };
      music.start(anchor, position);
    } else notice(controls.hits && controls.hitVolume > 0 ? message('无伴奏播放：正在播放谱面音符音。') : message('无伴奏播放：音符音已关闭或音量为零，当前仅运行播放头。'));
    schedule();
  }
  function tone(note, when) {
    const key = '24B'.includes(note) ? 'ka' : 'don';
    if (!hitBuffers.has(key)) hitBuffers.set(key, createHitBuffer(context, note));
    const voice = context.createBufferSource(), level = context.createGain();
    voice.buffer = hitBuffers.get(key); level.gain.value = '34AB'.includes(note) ? 1.15 : .85;
    if (controls.hitVolume > 0) duckMusic(musicDuck.gain, when);
    voice.connect(level); level.connect(hitGain); voice.start(when); voices.add(voice);
    voice.onended = () => { voices.delete(voice); voice.disconnect(); level.disconnect(); };
  }
  function schedule() {
    if (!state.playing) return;
    if (!looping && context.currentTime >= anchor + (loopEnd - origin) / playbackRate) { pause(); state.position = loopEnd; return; }
    if (!controls.hits) return;
    const rate = playbackRate, until = context.currentTime + .12, from = Math.max(scheduledUntil, context.currentTime);
    const cycle = (loopEnd - loopStart) / rate;
    const bars = looping ? state.chart.bars.slice(range.value[0] - 1, range.value[1]) : state.chart.bars;
    for (const item of bars) for (let index = 0; index < item.notes.length; index++) {
      const note = item.notes[index]; if (!'1234AB'.includes(note)) continue;
      const time = barTimeAt(item, index / item.notes.length);
      if (time < 0 || time >= loopEnd || (looping && time < loopStart)) continue;
      let when = anchor + (time - origin) / rate;
      if (looping) {
        when += Math.max(0, Math.ceil((from - when) / cycle)) * cycle;
        for (; when < until; when += cycle) if (when >= from) tone(note, when);
      } else if (when >= from && when < until) tone(note, when);
    }
    for (const when of longHitTimes(spans.value, { from, until, anchor, origin, rate, start: loopStart, end: loopEnd, loop: looping })) tone('1', when);
    scheduledUntil = until;
  }
  function snapshot() {
    const active = state.documents.find(item => item.id === state.activeId);
    if (active) Object.assign(active, Object.fromEntries(documentFields.map(key => [key, state[key]])));
  }
  function persist() {
    snapshot();
    try {
      const documents = state.documents.map(({ id, text, filename, savedText, course, branchRoutes, selected, undo, redo, dirty, invalid, source, encoding }) => ({ id, text, filename, savedText, course, branchRoutes, selected, undo, redo, dirty, invalid, source, encoding }));
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, activeId: state.activeId, documents }));
      state.saveState = '所有谱面及历史已存为浏览器草稿';
      return true;
    } catch (error) { state.saveState = '草稿存储不可用 · 请及时保存文件'; notice(message('草稿保存失败：{p0}', { p0: error }), true); return false; }
  }
  function syncSource() {
    clearTimeout(sourceTimer);
    state.source = bar.value ? barSource(state.text, bar.value) : '';
    state.sourceState = '已同步';
    if (state.commandCell?.bar !== state.selected) state.commandCell = null;
    if (state.customLoop?.[1] > state.chart.bars.length) state.customLoop = null;
  }
  function commit(text, keepSource = false, structure = null) {
    const chart = parseChart(text, parser, structure?.course ?? state.course, structure?.routes ?? state.branchRoutes);
    if (text === state.text) { state.invalid = false; state.sourceState = '已同步'; if (persist()) notice(message('更改已同步。')); return; }
    const waveChanged = chart.wave !== state.chart.wave, startBeat = visible.value.startBeat;
    const playing = state.playing, position = currentTime(); pause();
    const diff = textDiff(state.text, text);
    if (structure?.course !== undefined) diff.courseState = { before: { course: state.course, routes: [...state.branchRoutes] }, after: { course: chart.courseIndex, routes: chart.branchRoutes } };
    else if (structure?.index !== undefined) diff.routeState = { course: state.course, before: [...state.branchRoutes], after: chart.branchRoutes };
    if (structure?.selected !== undefined) diff.measureState = {
      course: state.course,
      before: { selected: state.selected, loop: state.customLoop },
      after: { selected: structure.selected, loop: structure.loop }
    };
    state.undo = [...state.undo.slice(-(HISTORY_LIMIT - 1)), diff]; state.redo = [];
    state.text = text; state.chart = chart; state.course = chart.courseIndex; state.branchRoutes = chart.branchRoutes; state.dirty = text !== state.savedText; state.invalid = false;
    state.viewStart = timelineScale.value.timeAt(startBeat); viewAnimation = null;
    state.selected = Math.max(0, Math.min(state.selected, chart.bars.length - 1));
    if (structure && !structure.preserveSelection) {
      state.selected = structure.selected ?? (structure.course !== undefined ? 0 : Math.min(chart.branches[structure.index].firstBarIndex, chart.bars.length - 1));
      state.selectedCell = null; state.commandCell = null; state.customLoop = structure.loop ?? null; viewAnimation = null;
      const start = bar.value ? measureStart(bar.value) : 0;
      state.position = Math.max(0, start); panTimeline(start, false); state.followPlayback = true;
    }
    if (waveChanged) clearAudio();
    if (!keepSource) syncSource(); else state.sourceState = '已同步';
    if (persist()) notice(message('更改已同步。'));
    if (!waveChanged && playing && !structure) void play(position);
  }
  function requireValid() { if (state.invalid) throw new LocalizedError(message('请先修正当前小节源码。')); }
  function copyMeasures() {
    return guard(() => {
      flushSource(); requireValid();
      const [first, last] = state.customLoop ?? [state.selected + 1, state.selected + 1];
      state.copiedMeasures = copyMeasureContent(state.text, state.chart, first - 1, last - 1);
      notice(message('已复制 {p0} 个小节。', { p0: state.copiedMeasures.length }));
      return true;
    });
  }
  function requestPaste() {
    return guard(() => {
      flushSource(); requireValid();
      if (!bar.value) throw new LocalizedError(message('小节不存在。'));
      if (!state.copiedMeasures?.length) throw new LocalizedError(message('请先复制小节。'));
      pause(); state.pasteRequest++;
      return true;
    });
  }
  function pasteMeasures(mode) {
    return guard(() => {
      flushSource(); requireValid();
      const text = pasteMeasureContent(state.text, state.chart, state.selected, state.copiedMeasures, mode, parser);
      const count = state.copiedMeasures.length, selected = state.selected;
      const loop = mode === 'insert' ? state.customLoop?.map(value => value > selected ? value + count : value) ?? null : state.customLoop;
      commit(text, false, { selected, loop });
      return true;
    });
  }
  function insertBar(side) {
    return guard(() => {
      flushSource(); requireValid();
      const text = insertEmptyBar(state.text, bar.value, side);
      const selected = state.selected + (side === 'after' ? 1 : 0);
      const loop = state.customLoop?.map(value => value > selected ? value + 1 : value) ?? null;
      commit(text, false, { selected, loop });
      return true;
    });
  }
  function deleteBar() {
    return guard(() => {
      flushSource(); requireValid();
      const text = deleteBarWithBalloons(state.text, state.chart, bar.value);
      const deleted = state.selected + 1;
      let loop = null;
      if (state.customLoop) {
        const [first, last] = state.customLoop;
        if (first !== deleted || last !== deleted) loop = [first - (deleted < first ? 1 : 0), last - (deleted <= last ? 1 : 0)];
      }
      commit(text, false, { selected: Math.min(state.selected, state.chart.bars.length - 2), loop });
      return true;
    });
  }
  function clampTimelineStart(start) {
    const bounds = timelineBounds.value, scale = timelineScale.value;
    const first = scale.beatAt(bounds.start), last = scale.beatAt(bounds.end);
    return scale.timeAt(Math.max(first, Math.min(scale.beatAt(start), Math.max(first, last - viewBeats.value))));
  }
  function panTimeline(start, manual = true, smooth = false) {
    if (!Number.isFinite(start)) { notice(message('时间轴位置须为有限数值。'), true); return; }
    if (!state.chart) return;
    if (manual) state.followPlayback = false;
    const target = clampTimelineStart(start);
    if (smooth && !state.playing && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      if (viewAnimation?.target !== target) viewAnimation = { start: visible.value.start, target, started: performance.now() };
    } else { viewAnimation = null; state.viewStart = target; }
  }
  function followTime(position) {
    const { startBeat, endBeat } = visible.value, scale = timelineScale.value;
    const beat = scale.beatAt(position);
    if (beat < startBeat || beat >= endBeat) panTimeline(scale.timeAt(startBeat + Math.floor((beat - startBeat) / viewBeats.value) * viewBeats.value), false);
  }
  function select(index) {
    if (!state.chart?.bars.length) return;
    guard(() => {
      requireValid(); if (!Number.isInteger(index)) throw new LocalizedError(message('小节编号须为整数。'));
      state.commandCell = null;
      state.selected = Math.max(0, Math.min(state.chart.bars.length - 1, index));
      panTimeline(measureStart(bar.value));
      syncSource(); persist();
    });
  }
  function seek(time) { const playing = state.playing; pause(); state.position = Math.max(0, time); if (playing) void play(); }
  function seekMeasure(direction) {
    if (!bar.value || state.invalid) return;
    const bars = state.chart.bars, time = currentTime();
    const index = time >= duration.value ? bars.length : Math.max(0, bars.findLastIndex(item => measureStart(item) <= time));
    const target = Math.max(0, index + direction);
    if (target < bars.length) seek(Math.max(0, measureStart(bars[target])));
  }
  function selectCell(position) {
    if (state.invalid) return;
    if (!state.chart?.bars[position.bar]) { notice(message('请先创建难度谱面。'), true); return; }
    pause(); state.selected = position.bar; state.selectedCell = position; state.commandCell = { ...position }; rewindToSelectedNote(); syncSource(); persist();
  }
  function rewindToSelectedNote() {
    const selected = cell.value;
    if (selected && selected.note !== '0') state.position = Math.max(0, measureStart(state.chart.bars[selected.bar]));
  }
  function clearNoteSelection() {
    state.selectedCell = null; state.commandCell = null; snapshot();
  }
  function selectNote(index, ordinal) {
    return guard(() => {
      requireValid();
      if (!Number.isInteger(index) || !state.chart?.bars[index] || !Number.isInteger(ordinal) || ordinal < 1) throw new LocalizedError(message('请输入有效的小节编号和音符序号。'));
      const item = state.chart.bars[index];
      const slots = [...item.notes].flatMap((note, slot) => note === '0' ? [] : [slot]);
      if (ordinal > slots.length) throw new LocalizedError(message('该小节只有 {p0} 个音符。', { p0: slots.length }));
      const slot = slots[ordinal - 1];
      selectCell({ bar: index, numerator: slot, denominator: item.notes.length, divisions: controls.snap });
      panTimeline(barTimeAt(item, slot / item.notes.length));
      return true;
    });
  }
  function selectAdjacentNote(direction) {
    return guard(() => {
      requireValid();
      const current = state.selectedCell;
      if (!current) throw new LocalizedError(message('请先选择一个音符或落点。'));
      const candidates = state.chart.bars.flatMap(item => [...item.notes].flatMap((note, slot) => note === '0' ? [] : [{ bar: item.index, numerator: slot, denominator: item.notes.length, divisions: controls.snap }]));
      const matches = candidate => (candidate.bar - current.bar || candidate.numerator * current.denominator - current.numerator * candidate.denominator) * direction > 0;
      const next = direction > 0 ? candidates.find(matches) : candidates.findLast(matches);
      if (!next) throw new LocalizedError(message(direction > 0 ? '已经没有下一个音符。' : '已经没有上一个音符。'));
      selectCell(next); panTimeline(barTimeAt(state.chart.bars[next.bar], next.numerator / next.denominator));
      return true;
    });
  }
  function moveCell(direction) {
    if (!bar.value || state.invalid) return;
    const divisions = controls.snap, current = state.selectedCell;
    let index = current?.bar ?? state.selected, slot = 0, denominator = divisions;
    if (current) {
      const position = current.numerator * divisions / current.denominator;
      slot = direction > 0 ? Math.floor(position) + 1 : Math.ceil(position) - 1;
      if (slot < 0) { index--; slot = divisions - 1; }
      else if (slot >= divisions) { index++; slot = 0; }
      const first = Math.max(0, Math.min(index, current.bar)), last = Math.min(state.chart.bars.length - 1, Math.max(index, current.bar));
      for (let candidate = first; candidate <= last; candidate++) {
        const notes = state.chart.bars[candidate].notes;
        for (let note = 0; note < notes.length; note++) {
          if (notes[note] === '0') continue;
          const from = candidate - current.bar || note * current.denominator - current.numerator * notes.length;
          const to = candidate - index || note * denominator - slot * notes.length;
          if (from * direction > 0 && to * direction < 0) { index = candidate; slot = note; denominator = notes.length; }
        }
      }
      if (index < 0 || index >= state.chart.bars.length) return;
    }
    selectCell({ bar: index, numerator: slot, denominator, divisions });
    const time = barTimeAt(state.chart.bars[index], slot / denominator), scale = timelineScale.value;
    const beat = scale.beatAt(time), start = scale.beatAt(viewAnimation?.target ?? visible.value.start);
    if (beat < start || beat >= start + viewBeats.value) panTimeline(scale.timeAt(beat - viewBeats.value * .25), false, true);
  }
  function setCommandPosition(numerator, denominator) {
    guard(() => {
      requireValid();
      if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator < 1 || numerator > denominator || denominator > 65536) throw new LocalizedError(message('指令位置须在 0/1 至 1/1 之间，分母最多 65536。'));
      pause(); state.commandCell = { bar: state.selected, numerator, denominator };
      state.selectedCell = numerator < denominator ? { ...state.commandCell, divisions: controls.snap } : null;
      rewindToSelectedNote();
    });
  }
  function applySettings(settings, atMeasureStart = false) { return guard(() => { requireValid(); commit(setPositionSettings(state.text, state.chart, atMeasureStart ? measureCommand.value : command.value, settings, parser)); return true; }); }
  function applyBranchSource(source, index = null) {
    return guard(() => {
      requireValid();
      const result = setBranchSourceWithBalloons(state.text, state.chart, command.value, source, index, parser);
      commit(result.text, false, { routes: result.branchRoutes, index: result.index });
      if (!state.error) notice(message('分歧结构已保存；若当前路线被移除，将切换到可用路线。'));
      return true;
    });
  }
  function applyMeasureBranch(operation) {
    return guard(() => {
      requireValid();
      const result = setMeasureBranchWithBalloons(state.text, state.chart, bar.value, operation, parser);
      const disabled = result.branchRoutes.length < state.branchRoutes.length;
      const structure = { routes: result.branchRoutes, index: result.index };
      commit(result.text, false, result.preserveSelection ? { ...structure, preserveSelection: true } : { ...structure, selected: result.selected, loop: null });
      if (disabled && !state.error) notice(message('已关闭分歧，当前路线已转为共用小节。'));
      else if (operation.type === 'route' && !state.error) notice(message('分歧结构已保存；若当前路线被移除，将切换到可用路线。'));
      return true;
    });
  }
  function clearSettings() { guard(() => { requireValid(); commit(clearPositionSettings(state.text, bar.value, command.value)); }); }
  function removeCommand(item) { guard(() => { requireValid(); if (item.shared) throw new LocalizedError(message('分歧边界及共用指令不能从路线小节中删除。')); commit(state.text.slice(0, item.start) + state.text.slice(item.end)); }); }
  function chooseNote(value) {
    if (!state.selectedCell || state.invalid) return;
    guard(() => { const item = state.chart.bars[state.selectedCell.bar]; commit(replaceBarWithBalloons(state.text, state.chart, item, setCellNote(item.notes, state.selectedCell, value))); });
  }
  function editSource(value) {
    clearTimeout(sourceTimer); pause(); state.selectedCell = null; state.commandCell = null; state.source = value; state.invalid = true; state.sourceState = '编辑中';
    persist(); sourceTimer = setTimeout(flushSource, 250);
  }
  function flushSource() {
    clearTimeout(sourceTimer);
    if (!state.invalid) return;
    try { commit(replaceBarSourceWithBalloons(state.text, state.chart, bar.value, state.source, parser), true); }
    catch (error) { state.sourceState = '格式错误'; persist(); notice(error, true); }
  }
  function history(redo = false) {
    const from = redo ? state.redo : state.undo;
    if (!from.length) return;
    guard(() => {
      pause(); clearTimeout(sourceTimer);
      const diff = from.at(-1), text = applyDiff(state.text, diff, !redo);
      const selection = diff.courseState?.[redo ? 'after' : 'before'];
      const routes = selection?.routes ?? (diff.routeState?.course === state.course ? diff.routeState[redo ? 'after' : 'before'] : state.branchRoutes);
      const chart = parseChart(text, parser, selection?.course ?? state.course, routes);
      const measure = diff.measureState?.course === chart.courseIndex ? diff.measureState[redo ? 'after' : 'before'] : null;
      const waveChanged = chart.wave !== state.chart.wave, startBeat = visible.value.startBeat;
      if (redo) { state.redo = from.slice(0, -1); state.undo = [...state.undo, diff]; }
      else { state.undo = from.slice(0, -1); state.redo = [...state.redo, diff]; }
      state.text = text; state.chart = chart; state.course = chart.courseIndex; state.branchRoutes = chart.branchRoutes; state.selected = Math.max(0, Math.min(state.selected, chart.bars.length - 1));
      state.viewStart = timelineScale.value.timeAt(startBeat); viewAnimation = null;
      if (measure) { state.selected = Math.min(measure.selected, chart.bars.length - 1); state.customLoop = measure.loop; }
      if (diff.courseState || measure || !chart.bars.length) {
        const start = bar.value ? measureStart(bar.value) : 0;
        state.position = Math.max(0, start); state.viewStart = start; if (!measure) state.customLoop = null; viewAnimation = null; state.followPlayback = true;
      }
      if (waveChanged) clearAudio();
      state.selectedCell = null; state.commandCell = null; state.invalid = false; state.dirty = text !== state.savedText; syncSource(); persist();
    });
  }
  function setLoop(first, last) {
    return guard(() => {
      if (!bar.value) throw new LocalizedError(message('请先创建难度谱面。'));
      if (!Number.isInteger(first) || !Number.isInteger(last)) throw new LocalizedError(message('选择的小节编号须为整数。'));
      first = Math.max(1, Math.min(state.chart.bars.length, first));
      last = Math.max(1, Math.min(state.chart.bars.length, last));
      const resolved = resolveLoop(state.chart.bars, first, last, Infinity);
      const playing = state.playing; pause(); state.loopAnchor = null; state.customLoop = [first, last];
      if (persist()) notice(message('已选择第 {p0}–{p1} 小节；播放时重复该区间。', { p0: first, p1: last }));
      if (playing) void play(resolved.start);
      return true;
    });
  }
  function loopCurrent(preview = false) {
    if (!bar.value) return;
    const start = Math.max(0, measureStart(bar.value));
    if (setLoop(state.selected + 1, state.selected + 1) && preview) void play(start);
  }
  function clearLoop() {
    const playing = state.playing, position = currentTime();
    pause(); state.customLoop = null; state.loopAnchor = null;
    if (persist()) notice(message('已取消小节选择，播放将继续到结束。'));
    if (playing) void play(position);
  }
  function markLoop() {
    if (!bar.value || state.invalid) { notice(message('请先选择有效的小节。'), true); return; }
    if (state.loopAnchor === null) state.loopAnchor = state.selected;
    else setLoop(Math.min(state.loopAnchor, state.selected) + 1, Math.max(state.loopAnchor, state.selected) + 1);
  }
  function stop() {
    pause();
    if (bar.value) state.position = Math.max(0, range.value ? Math.min(...state.chart.bars.slice(range.value[0] - 1, range.value[1]).map(measureStart)) : measureStart(bar.value));
    if (state.chart) { panTimeline(state.position, false); state.followPlayback = true; }
  }
  function setSnap(value) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_SNAP_DIVISIONS) { controls.customSnap = controls.snap; notice(message('吸附细分须为 1–768 之间的整数。'), true); return; }
    controls.snap = value; controls.customSnap = value;
  }
  function changeCourse(value) {
    guard(() => {
      requireValid(); const chart = parseChart(state.text, parser, value); pause();
      state.course = value; state.chart = chart; state.branchRoutes = chart.branchRoutes; state.selected = 0; state.selectedCell = null; state.commandCell = null; state.customLoop = null;
      state.position = Math.max(0, measureStart(chart.bars[0])); syncSource(); persist();
      panTimeline(measureStart(chart.bars[0]), false); state.followPlayback = true;
    });
  }
  function applyCourseEdit(edit) {
    requireValid();
    const result = edit();
    commit(result.text, false, { course: result.course, routes: result.routes ?? [], preserveSelection: result.preserveSelection });
    return true;
  }
  function createCourse(settings) { return guard(() => applyCourseEdit(() => addCourse(state.text, settings))); }
  function removeCourse(index = state.course) {
    return guard(() => applyCourseEdit(() => {
      const result = deleteCourse(state.text, index);
      return index === state.course ? result : { ...result, course: state.course - Number(index < state.course), routes: state.branchRoutes, preserveSelection: true };
    }));
  }
  function createPlayerCharts(style, player) { return guard(() => applyCourseEdit(() => addPlayerCharts(state.text, state.course, style, player))); }
  function setLevel(value) { return guard(() => { requireValid(); commit(setCourseLevel(state.text, state.course, value)); return true; }); }
  function applyBranchRoutes(routes, index) {
    const chart = parseChart(state.text, parser, state.course, routes);
    const relative = bar.value.branchIndex === index ? state.selected - state.chart.branches[index].firstBarIndex : 0;
    pause(); viewAnimation = null; state.chart = chart; state.branchRoutes = chart.branchRoutes;
    state.selected = Math.min(chart.bars.length - 1, chart.branches[index].firstBarIndex + Math.min(relative, Math.max(0, chart.branches[index].barCount - 1)));
    state.selectedCell = null; state.commandCell = null; state.customLoop = null;
    state.position = Math.max(0, measureStart(bar.value)); syncSource();
    panTimeline(measureStart(bar.value), false); state.followPlayback = true;
    if (persist()) notice(message('已切换分歧路线；试听按当前选择播放。'));
  }
  function changeBranch(index, route) {
    guard(() => {
      requireValid();
      const previous = state.chart?.branches[index];
      if (!previous || !previous.routes.includes(route)) throw new LocalizedError(message('分歧路线选择无效。'));
      const routes = [...state.branchRoutes]; routes[index] = route;
      applyBranchRoutes(routes, index);
    });
  }
  function changeAllBranches(route) {
    guard(() => {
      requireValid();
      const branches = state.chart?.branches.filter(branch => branch.routes.length);
      if (!branches?.length || !BRANCH_ROUTES.includes(route)) throw new LocalizedError(message('分歧路线选择无效。'));
      if (branches.some(branch => !branch.routes.includes(route))) throw new LocalizedError(message('部分分歧没有路线 {p0}，请展开逐处选择。', { p0: route }));
      const changed = branches.filter(branch => branch.route !== route);
      if (!changed.length) return;
      const index = changed.find(branch => branch.index === bar.value.branchIndex)?.index ?? changed[0].index;
      applyBranchRoutes(state.chart.branches.map(branch => branch.routes.length ? route : null), index);
    });
  }
  function leaveDocument() {
    pause(); flushSource(); snapshot(); ++audioRequest;
  }
  function activate(document) {
    viewAnimation = null;
    state.activeId = document.id;
    Object.assign(state, Object.fromEntries(documentFields.map(key => [key, document[key]])));
  }
  function switchChart(id) {
    if (id === state.activeId) return;
    const document = state.documents.find(item => item.id === id);
    if (!document) { notice(message('找不到此谱面。'), true); return; }
    leaveDocument(); activate(document);
    if (persist()) notice(state.invalid ? message('已切换谱面；请修正保留的小节源码。') : message('已切换谱面。'), state.invalid);
  }
  function closeChart(id) {
    const document = state.documents.find(item => item.id === id);
    if (!document) return;
    const active = id === state.activeId;
    if (document.saving) { notice(message('谱面正在保存，请完成后再关闭。'), true); return; }
    if (active) { pause(); flushSource(); snapshot(); }
    if ((document.dirty || document.invalid) && !confirm(t('关闭 {p0} 将移除此谱面及其草稿和历史。请先保存需要的内容，是否继续？', { p0: document.filename }))) return;
    const index = state.documents.indexOf(document);
    if (active) { viewAnimation = null; clearTimeout(sourceTimer); ++audioRequest; }
    state.documents = state.documents.filter(item => item.id !== id);
    if (active) {
      const next = state.documents[Math.min(index, state.documents.length - 1)];
      if (next) activate(next);
      else { state.activeId = null; Object.assign(state, emptyDocument()); }
    }
    if (persist()) notice(message('谱面已关闭。'));
  }
  function renameChart(name) {
    return guard(() => {
      if (!state.chart) throw new LocalizedError(message('请先打开谱面。'));
      if (state.saving) throw new LocalizedError(message('请等待保存完成后再修改文件名。'));
      name = chartFilename(name);
      if (name === state.filename) return true;
      state.filename = name; state.fileHandle = null; state.savedText = null; state.dirty = true; persist();
      return true;
    });
  }
  function newChart() {
    loadChart(new TextEncoder().encode('TITLE:Untitled\nBPM:120\nOFFSET:0\n'), 'untitled.tja');
  }
  function loadChart(bytes, name, fileHandle = null) {
    const decoded = decodeChart(bytes), chart = parseChart(decoded.text, parser, 0);
    leaveDocument();
    const start = chart.bars.length ? measureStart(chart.bars[0]) : 0;
    const document = shallowReactive({ ...emptyDocument(), id: nextDocumentId++, text: decoded.text, savedText: decoded.text, fileHandle, chart, branchRoutes: chart.branchRoutes, filename: name, encoding: decoded.encoding, position: Math.max(0, start), viewStart: start });
    state.documents = [...state.documents, document]; activate(document);
    syncSource(); if (persist()) notice(message(chart.variants.length ? '谱面已载入，可直接播放音符音或载入伴奏。' : '歌曲已载入，请从“难度与模式”创建谱面。'));
  }
  async function loadAudio(bytes, name, request) {
    pause(); notice(message('正在解析音频波形…'));
    const buffer = await audioContext().decodeAudioData(bytes);
    if (disposed || request !== audioRequest) return;
    const count = Math.min(120000, buffer.length), peaks = new Float32Array(count), step = buffer.length / count;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < count; index++) for (let sample = Math.floor(index * step); sample < Math.floor((index + 1) * step); sample++) peaks[index] = Math.max(peaks[index], Math.abs(samples[sample]));
    }
    pause(); state.buffer = buffer; state.peaks = peaks; state.audioName = name; state.position = Math.max(0, Math.min(state.position, buffer.duration)); notice(message('音频已就绪。'));
  }
  function clearAudio() {
    ++audioRequest; state.buffer = null; state.peaks = []; state.audioName = emptyDocument().audioName;
  }
  async function openChart(file, fileHandle = null) {
    if (!file) return;
    if (!/\.tja$/i.test(file.name)) { reportFileError(message('请选择 .tja 谱面文件：{p0}', { p0: file.name }), file.name); return; }
    try {
      const bytes = await file.arrayBuffer(); if (disposed) return;
      loadChart(bytes, file.name, fileHandle);
    } catch (error) { if (!disposed) reportFileError(error, file.name); }
  }
  async function openCharts() {
    try {
      const handles = await window.showOpenFilePicker({ multiple: true });
      for (const handle of handles) {
        const file = await handle.getFile();
        if (disposed) return;
        await openChart(file, handle);
      }
    } catch (error) {
      if (!disposed) {
        if (error.name === 'AbortError') notice(message('已取消打开谱面。'));
        else reportFileError(message('打开谱面失败：{p0}', { p0: error }));
      }
    }
  }
  async function openAudio(file) {
    if (!file) return;
    if (!state.chart) { reportFileError(message('请先打开谱面，再载入对应音频。'), file.name); return; }
    const request = ++audioRequest;
    const previousNotice = state.noticeMessage, previousError = state.error;
    try {
      const bytes = await file.arrayBuffer();
      if (!disposed && request === audioRequest) await loadAudio(bytes, file.name, request);
    } catch (error) {
      if (!disposed && request === audioRequest) {
        if (state.noticeMessage?.key === '正在解析音频波形…') notice(previousNotice, previousError);
        reportFileError(message('音频读取失败：{p0}', { p0: error }), file.name);
      }
    }
  }
  function restore() {
    guard(() => {
      if (state.documents.some(item => item.saving)) throw new LocalizedError(message('请等待文件保存完成后再恢复草稿。'));
      const workspace = localStorage.getItem(WORKSPACE_KEY);
      const saved = JSON.parse(workspace || localStorage.getItem('tja-wave-draft') || 'null');
      if (!saved) throw new LocalizedError(message('没有本地草稿。'));
      if (workspace && (saved.version !== 1 || !Array.isArray(saved.documents))) throw new LocalizedError(message('本地工作区格式无效。'));
      const entries = workspace ? saved.documents : [{ ...saved, dirty: true }];
      const ids = new Set();
      const documents = entries.map((item, index) => {
        if (typeof item.text !== 'string' || typeof item.filename !== 'string' || !Number.isInteger(item.course) || item.course < 0 || !Number.isInteger(item.selected) || (item.invalid && typeof item.source !== 'string')) throw new LocalizedError(message('本地谱面草稿格式无效。'));
        const chart = parseChart(item.text, parser, item.course, item.branchRoutes ?? []), undo = item.undo ?? [], redo = item.redo ?? [];
        const savedText = item.savedText === undefined ? (item.dirty ? null : item.text) : item.savedText;
        if (savedText !== null && typeof savedText !== 'string') throw new LocalizedError(message('本地谱面保存状态无效。'));
        if (!Array.isArray(undo) || !Array.isArray(redo) || undo.length + redo.length > HISTORY_LIMIT) throw new LocalizedError(message('本地编辑历史格式无效。'));
        let text = item.text;
        for (const diff of [...undo].reverse()) text = applyDiff(text, diff, true);
        text = item.text;
        for (const diff of [...redo].reverse()) text = applyDiff(text, diff);
        const id = workspace ? item.id : index + 1;
        if (!Number.isSafeInteger(id) || id < 1 || ids.has(id)) throw new LocalizedError(message('本地谱面编号无效。'));
        ids.add(id);
        const selected = Math.max(0, Math.min(item.selected, chart.bars.length - 1));
        const start = chart.bars[selected] ? measureStart(chart.bars[selected]) : 0;
        return shallowReactive({ ...emptyDocument(), id, text: item.text, savedText, filename: item.filename, course: item.course, branchRoutes: chart.branchRoutes, chart, selected, undo, redo, dirty: item.text !== savedText, invalid: Boolean(item.invalid), encoding: item.encoding || '', source: item.invalid ? item.source : chart.bars[selected] ? barSource(item.text, chart.bars[selected]) : '', sourceState: item.invalid ? '格式错误' : '已同步', position: Math.max(0, start), viewStart: start });
      });
      if (state.documents.length && !confirm(t('恢复草稿会替换所有已打开谱面，是否继续？'))) return;
      viewAnimation = null; pause(); clearTimeout(sourceTimer); ++audioRequest;
      state.documents = documents;
      nextDocumentId = Math.max(0, ...documents.map(item => item.id)) + 1;
      const active = documents.find(item => item.id === saved.activeId) || documents[0];
      if (active) { activate(active); flushSource(); }
      else { state.activeId = null; Object.assign(state, emptyDocument()); }
      if (persist()) notice(state.invalid ? message('已恢复谱面及编辑历史；当前小节源码仍有错误，请修正。') : message('已恢复谱面及编辑历史；请重新载入音频。'), state.invalid);
    });
  }
  function updateDocument(document, values) {
    Object.assign(document, values);
    if (state.activeId === document.id) Object.assign(state, values);
  }
  async function saveChart(as = false) {
    if (!state.chart) { notice(message('请先打开谱面。'), true); return false; }
    if (state.saving) { notice(message('此谱面正在保存，请稍候。'), true); return false; }
    flushSource();
    if (state.invalid) { notice(message('请先修正小节源码后再保存。'), true); return false; }
    const input = document.activeElement;
    if (input?.id === 'base-bpm' && !setBpm(Number(input.value))) return false;
    if (input?.id === 'offset' && !setOffset(Number(input.value))) return false;
    if (input?.id === 'chart-name' && !renameChart(input.value)) return false;
    if (input?.id === 'balloon-count' && !setBalloon(Number(input.value))) return false;
    if (input?.dataset?.songField && !setMetadata({ [input.dataset.songField]: input.value })) return false;
    snapshot();
    const target = state.documents.find(item => item.id === state.activeId), text = state.text;
    let handle = as ? null : target.fileHandle, choosing = false;
    updateDocument(target, { saving: true });
    try {
      const blob = new Blob(['\ufeff', text], { type: 'text/plain;charset=utf-8' });
      if (!handle && typeof window.showSaveFilePicker !== 'function') {
        const requested = as ? window.prompt(t('另存为文件名（保存位置由浏览器下载设置决定）'), target.filename) : target.filename;
        if (requested === null) { notice(message('已取消另存为，修改仍保留。')); return false; }
        const filename = chartFilename(requested), url = URL.createObjectURL(blob);
        try {
          const link = document.createElement('a');
          link.href = url; link.download = filename; link.click();
        } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
        updateDocument(target, { filename, fileHandle: null, savedText: null, dirty: true });
        if (persist()) notice(message('浏览器不支持直接写回文件，已请求下载 {p0} 的 UTF-8 副本。请确认下载完成；未保存标记仍保留。', { p0: filename }));
        return true;
      }
      if (!handle) {
        choosing = true;
        handle = await window.showSaveFilePicker({ suggestedName: target.filename, types: chartFileTypes() });
        choosing = false;
      } else {
        const diskText = decodeChart(await (await handle.getFile()).arrayBuffer()).text;
        if (disposed) return false;
        if (diskText !== target.savedText && !confirm(t('{p0} 在磁盘上已发生变化。继续保存将覆盖磁盘内容，是否继续？', { p0: target.filename }))) {
          notice(message('已取消覆盖，修改仍保留。')); return false;
        }
      }
      if (disposed) return false;
      const writable = await handle.createWritable();
      if (disposed) { await writable.abort(); return false; }
      try { await writable.write(blob); await writable.close(); }
      catch (error) {
        try { await writable.abort(); }
        catch (abortError) { throw new LocalizedError(message('{p0}；中止写入失败：{p1}', { p0: error, p1: abortError })); }
        throw error;
      }
      updateDocument(target, { fileHandle: handle, filename: handle.name, savedText: text, dirty: target.text !== text, encoding: 'UTF-8' });
      if (persist()) notice(message(target.dirty || target.invalid ? '已保存 {p0}（UTF-8 BOM）；保存期间的新修改尚未保存。' : '已保存 {p0}（UTF-8 BOM）。', { p0: handle.name }));
      return true;
    } catch (error) {
      if (!disposed) notice(choosing && error.name === 'AbortError' ? message('已取消保存，修改仍保留。') : message('保存 {p0} 失败：{p1}', { p0: target.filename, p1: error }), !(choosing && error.name === 'AbortError'));
      return false;
    } finally { updateDocument(target, { saving: false }); }
  }
  function saveAs() { return saveChart(true); }
  function setOffset(value) {
    return guard(() => { requireValid(); if (!Number.isFinite(value)) throw new LocalizedError(message('偏移无效')); commit(/^OFFSET:/mi.test(state.text) ? state.text.replace(/^OFFSET:[^\r\n]*/mi, `OFFSET:${value}`) : `OFFSET:${value}\n${state.text}`); return true; });
  }
  function setBpm(value) { return guard(() => { requireValid(); commit(setBaseBpm(state.text, value)); return true; }); }
  function setMetadata(values) { return guard(() => { requireValid(); commit(setSongMetadata(state.text, values)); return true; }); }
  function setDivision(value) { guard(() => { requireValid(); commit(replaceBarWithBalloons(state.text, state.chart, bar.value, resizeNotes(bar.value.notes, value))); }); }
  function clearBar() { guard(() => { requireValid(); commit(replaceBarWithBalloons(state.text, state.chart, bar.value, '0'.repeat(bar.value.notes.length))); }); }
  function setBalloon(value) { return guard(() => { requireValid(); if (state.selectedCell) commit(setBalloonCount(state.text, state.chart, state.selectedCell, value)); return true; }); }
  watch(() => [state.activeId, state.chart, state.invalid], () => { state.loopAnchor = null; }, { flush: 'sync' });
  watch(() => controls.rate, () => { if (state.playing) void play(currentTime()); });
  watch(() => controls.volume, value => { if (gain) gain.gain.value = value / 100; });
  watch(() => controls.hitVolume, value => {
    if (hitGain) hitGain.gain.setTargetAtTime(value / 100, context.currentTime, .01);
    if (musicDuck && value === 0) { musicDuck.gain.cancelScheduledValues(context.currentTime); musicDuck.gain.setValueAtTime(1, context.currentTime); }
  });
  watch(() => controls.hits, () => { silence(); if (context) scheduledUntil = context.currentTime; });
  watch(() => state.followPlayback, follow => { if (follow && state.chart) followTime(state.position); });
  function animate(timestamp = performance.now()) {
    if (viewAnimation) {
      const progress = Math.max(0, Math.min(1, (timestamp - viewAnimation.started) / 180));
      const scale = timelineScale.value, start = scale.beatAt(viewAnimation.start), end = scale.beatAt(viewAnimation.target);
      state.viewStart = clampTimelineStart(scale.timeAt(start + (end - start) * (1 - (1 - progress) ** 3)));
      if (progress === 1) viewAnimation = null;
    }
    if (state.playing) {
      const position = currentTime(); state.position = position;
      if (state.followPlayback) followTime(position);
      if (state.followPlayback && !state.invalid && document.activeElement?.id !== 'source') {
        const containing = state.chart.bars.findLastIndex(item => position >= measureStart(item) && position < measureEnd(item));
        const next = containing >= 0 ? containing : state.chart.bars.findLastIndex(item => measureStart(item) <= position);
        if (next >= 0 && next !== state.selected) { state.selected = next; state.commandCell = null; syncSource(); }
      }
    }
    frame = requestAnimationFrame(animate);
  }
  const shortcutKeysDown = new Set();
  function shortcutLetter(event) {
    return /^Key[WSADQEF]$/.test(event.code) ? event.code.slice(3).toLowerCase()
      : /^[wsadqef]$/i.test(event.key) ? event.key.toLowerCase() : null;
  }
  function keydown(event) {
    const key = shortcutLetter(event);
    if (key) shortcutKeysDown.add(key);
    handleShortcut(event);
  }
  function keyup(event) {
    const key = shortcutLetter(event);
    if (!key || shortcutKeysDown.delete(key) || event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    handleShortcut(event);
  }
  function clearShortcutKeys() { shortcutKeysDown.clear(); }
  function handleShortcut(event) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault(); if (!event.repeat) void saveChart(event.shiftKey); return;
    }
    const inDialog = document.activeElement?.closest?.('dialog, [role="dialog"]');
    if (event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey && !event.isComposing && event.key.toLowerCase() === 'w' && !inDialog) {
      event.preventDefault();
      if (!event.repeat && state.activeId !== null) { document.activeElement?.blur?.(); closeChart(state.activeId); }
      return;
    }
    if (state.editorBlocked || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    let key = event.key.toLowerCase();
    if (event.isComposing || event.keyCode === 229 || key === 'process' || key === 'unidentified') {
      if (inDialog) return;
      const physicalKey = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase()
        : /^(Digit|Numpad)[0-9]$/.test(event.code) ? event.code.slice(-1)
        : { Space: ' ', Minus: '-', Equal: '=', NumpadSubtract: '-', NumpadEqual: '=', Escape: 'escape', Delete: 'delete', Backspace: 'backspace', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright' }[event.code];
      if (!physicalKey) return;
      key = physicalKey;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (!event.shiftKey || key === 'a') && ['a', 'c', 'v'].includes(key) && !event.defaultPrevented && !inDialog && bar.value && !document.activeElement?.closest?.('#settings-panel, .song-workspace') && !(key === 'c' && document.getSelection?.()?.toString())) {
      event.preventDefault();
      if (!event.repeat) {
        if (key === 'a') setLoop(event.shiftKey ? state.selected + 1 : 1, event.shiftKey ? state.selected + 1 : state.chart.bars.length);
        else if (key === 'c') copyMeasures();
        else requestPaste();
      }
      return;
    }
    if (key === 'escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !inDialog && (state.loopAnchor !== null || state.selectedCell)) {
      if (state.loopAnchor !== null) { event.preventDefault(); state.loopAnchor = null; return; }
      event.preventDefault(); viewAnimation = null; clearNoteSelection(); return;
    }
    const note = NOTE_TYPES.find(type => (type.shortcut ?? type.value) === key)?.value ?? (['delete', 'backspace'].includes(key) ? '0' : null);
    if (event.code === 'Space' || key === ' ') {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || document.activeElement?.tagName === 'SUMMARY' || inDialog) return;
      event.preventDefault();
      if (!event.repeat) { if (state.playing) pause(); else void play(); }
    }
    else if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); history(event.shiftKey); }
    else if (key === 'f' && event.shiftKey && bar.value && (state.customLoop || state.loopAnchor !== null) && !event.ctrlKey && !event.metaKey && !event.altKey && !inDialog) {
      event.preventDefault(); if (!event.repeat) clearLoop();
    }
    else if (key === 'f' && bar.value && !state.invalid && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !inDialog) {
      event.preventDefault();
      if (event.repeat) return;
      markLoop();
    }
    else if (note !== null && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !inDialog && state.selectedCell && !state.invalid) {
      event.preventDefault(); if (!event.repeat) chooseNote(note);
    }
    else if (['q', 'e'].includes(key) && bar.value && !state.invalid && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !inDialog) {
      event.preventDefault();
      if (event.repeat) return;
      seekMeasure(key === 'q' ? -1 : 1);
    }
    else if (['arrowleft', 'arrowright', 'a', 'd', 'w', 's'].includes(key) && bar.value && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !inDialog) {
      event.preventDefault();
      if (key === 'arrowleft' || key === 'arrowright') {
        const scale = timelineScale.value, start = scale.beatAt(viewAnimation?.target ?? visible.value.start);
        panTimeline(scale.timeAt(start + (key === 'arrowleft' ? -1 : 1) * viewBeats.value / 8), true, true);
      } else if (key === 'a' || key === 'd') moveCell(key === 'a' ? -1 : 1);
      else {
        const next = key === 'w' ? SNAP_DIVISIONS.find(value => value > controls.snap) ?? MAX_SNAP_DIVISIONS : SNAP_DIVISIONS.findLast(value => value < controls.snap) ?? 1;
        setSnap(next); controls.snapChoice = SNAP_DIVISIONS.includes(next) ? String(next) : 'custom';
      }
    }
  }
  function beforeUnload(event) {
    if (reloadApproved) return;
    snapshot();
    if (state.documents.some(item => item.dirty || item.invalid || item.saving)) { event.preventDefault(); event.returnValue = ''; }
  }
  function reloadForUpdate() {
    if (state.saving || state.documents.some(item => item.saving)) { notice(message('请等待所有谱面保存完成后再更新。'), true); return false; }
    pause(); flushSource();
    if (!persist()) return false;
    reloadApproved = true;
    window.location.reload();
    return true;
  }
  onMounted(() => {
    document.addEventListener('keydown', keydown); document.addEventListener('keyup', keyup);
    window.addEventListener('blur', clearShortcutKeys); window.addEventListener('beforeunload', beforeUnload);
    scheduler = setInterval(schedule, 25); animate();
    guard(() => { if (localStorage.getItem(WORKSPACE_KEY) || localStorage.getItem('tja-wave-draft')) restore(); });
  });
  onUnmounted(() => {
    disposed = true; clearTimeout(sourceTimer); clearInterval(scheduler); cancelAnimationFrame(frame);
    pause(); void context?.close(); document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup);
    window.removeEventListener('blur', clearShortcutKeys); window.removeEventListener('beforeunload', beforeUnload);
  });
  return { state, controls, bar, spans, visible, viewSpan, viewBeats, timelineWidth, timelineScale, timelineBounds, chartStats, stats, cell, command, measureCommand, currentTiming, range, duration, metadata, notice, reportFileError, pause, play, stop, seek, seekMeasure, panTimeline, select, selectCell, selectNote, selectAdjacentNote, clearNoteSelection, setCommandPosition, applySettings, applyBranchSource, applyMeasureBranch, clearSettings, removeCommand, chooseNote, editSource, history, setLoop, clearLoop, markLoop, loopCurrent, setSnap, changeCourse, createCourse, removeCourse, createPlayerCharts, setLevel, changeAllBranches, changeBranch, openChart, openCharts, openAudio, newChart, switchChart, closeChart, insertBar, deleteBar, copyMeasures, requestPaste, pasteMeasures, reloadForUpdate, renameChart, restore, saveChart, saveAs, setOffset, setBpm, setMetadata, setDivision, clearBar, setBalloon };
}