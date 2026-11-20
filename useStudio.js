import { t, message, LocalizedError, formatMessage } from './i18n.js';
import { computed, onMounted, onUnmounted, reactive, shallowReactive, watch } from 'vue';
import { TJAParser as parser } from 'tja';
import { decodeChart, parseChart, resizeNotes, setBaseBpm, barTimeAt, barStateAt, setPositionSettings, clearPositionSettings, barSource } from './chart.js';
import { createHitBuffer, MIX_DEFAULTS, duckMusic } from './hit-audio.js';
import { resolveLoop, measureStart, measureEnd } from './loop.js';
import { GRID_DIVISIONS, MAX_SNAP_DIVISIONS } from './grid.js';
import { NOTE_TYPES, cellValue, setCellNote, longNoteSpans } from './note-model.js';
import { longHitTimes } from './long-audio.js';
import { balloonCounts, balloonIndex, setBalloonCount, replaceBarWithBalloons, replaceBarSourceWithBalloons } from './balloon.js';
import { HISTORY_LIMIT, textDiff, applyDiff } from './history.js';
import { findWaveFile, indexMediaFiles } from './media-files.js';
import { songMetadata, setSongMetadata } from './metadata.js';

const WORKSPACE_KEY = 'tja-wave-workspace';
const chartFileTypes = () => [{ description: t('TJA 谱面'), accept: { 'text/plain': ['.tja'] } }];
const documentFields = ['text', 'chart', 'selected', 'course', 'buffer', 'peaks', 'position', 'viewStart', 'followPlayback', 'undo', 'redo', 'filename', 'savedText', 'fileHandle', 'sourceHandle', 'chartPath', 'saving', 'dirty', 'invalid', 'selectedCell', 'commandCell', 'source', 'sourceState', 'encoding', 'audioName', 'customLoop'];
const emptyDocument = () => ({ text: '', chart: null, selected: 0, course: 0, buffer: null, peaks: [], position: 0, viewStart: 0, followPlayback: true, undo: [], redo: [], filename: 'chart.tja', savedText: null, fileHandle: null, sourceHandle: null, chartPath: '', saving: false, dirty: false, invalid: false, selectedCell: null, commandCell: null, source: '', sourceState: '已同步', encoding: '', audioName: '无伴奏 · 可直接播放谱面', customLoop: null });
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
  const state = shallowReactive({ ...emptyDocument(), documents: [], activeId: null, mediaDirectoryName: '', playing: false, saveState: '尚未打开谱面', noticeMessage: '请选择 TJA 谱面，可无伴奏播放或载入对应音频。', get notice() { return formatMessage(this.noticeMessage); }, error: false });
  let nextDocumentId = 1, viewAnimation = null;
  let mediaDirectory = null, mediaFiles = null;
  const controls = reactive({ loop: true, hits: true, rate: 1, volume: MIX_DEFAULTS.music, hitVolume: MIX_DEFAULTS.hits, view: 2, snap: GRID_DIVISIONS, snapChoice: '16', customSnap: GRID_DIVISIONS });
  const bar = computed(() => state.chart?.bars[state.selected]);
  const spans = computed(() => state.chart ? longNoteSpans(state.chart.bars) : []);
  const range = computed(() => state.customLoop || [state.selected + 1, state.selected + 1]);
  const metadata = computed(() => songMetadata(state.text));
  const duration = computed(() => state.buffer?.duration ?? state.chart?.bars.reduce((end, item) => Math.max(end, measureEnd(item)), 0) ?? 0);
  const timelineBounds = computed(() => state.chart?.bars.reduce((bounds, item) => ({ start: Math.min(bounds.start, measureStart(item)), end: Math.max(bounds.end, measureEnd(item)) }), { start: 0, end: duration.value }) || { start: 0, end: 0 });
  const viewSpan = computed(() => state.chart ? 240 / state.chart.baseBpm * controls.view : 1);
  const visible = computed(() => {
    if (!state.chart) return null;
    const bounds = timelineBounds.value;
    const start = Math.max(bounds.start, Math.min(state.viewStart, Math.max(bounds.start, bounds.end - viewSpan.value)));
    const end = start + viewSpan.value;
    const bars = state.chart.bars.filter(item => measureEnd(item) >= start && measureStart(item) <= end);
    return { bars, start, end };
  });
  const stats = computed(() => {
    const notes = [...(bar.value?.notes || '')];
    return { don: notes.filter(note => '13'.includes(note)).length, ka: notes.filter(note => '24'.includes(note)).length, other: notes.filter(note => '56789'.includes(note)).length, total: notes.filter(note => note !== '0').length,
      all: state.chart?.bars.reduce((sum, item) => sum + [...item.notes].filter(note => note !== '0').length, 0) || 0 };
  });
  const cell = computed(() => {
    const selected = state.selectedCell, item = selected && state.chart?.bars[selected.bar];
    if (!item) return null;
    const note = cellValue(item.notes, selected), time = barTimeAt(item, selected.numerator / selected.denominator);
    const ordinal = balloonIndex(state.chart, selected), count = ordinal >= 0 ? balloonCounts(state.text, state.course)[ordinal] : undefined;
    return { ...selected, note, time, ordinal, count, name: t(NOTE_TYPES[Number(note)].name), span: spans.value.find(span => time >= span.start - .000001 && time <= span.end + .000001) };
  });
  const command = computed(() => {
    if (!bar.value) return null;
    const position = state.commandCell || { bar: state.selected, numerator: 0, denominator: 1 };
    const fraction = position.numerator / position.denominator;
    const commands = fraction === 0 ? bar.value.commands : bar.value.events.filter(event => event.slot * position.denominator === position.numerator * bar.value.notes.length);
    return { ...position, fraction, commands, timing: barStateAt(bar.value, fraction), time: barTimeAt(bar.value, fraction) };
  });
  let context, music, gain, musicDuck, hitGain, output, anchor = 0, origin = 0, loopStart = 0, loopEnd = 0, scheduledUntil = 0, playbackRate = 1, looping = false;
  let sourceTimer, scheduler, frame, disposed = false, audioRequest = 0, playRequest = 0;
  const voices = new Set(), hitBuffers = new Map();
  const notice = (message, error = false) => { state.noticeMessage = message; state.error = error; };
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
    if (!state.chart) { notice(message('请先载入谱面。'), true); return; }
    if (!(duration.value > 0)) { notice(message('谱面没有可播放的正时间区间，请检查 OFFSET 和 DELAY。'), true); return; }
    pause();
    const request = ++playRequest;
    try { await audioContext().resume(); } catch (error) { notice(message('播放失败：{p0}', { p0: error }), true); return; }
    if (disposed || request !== playRequest) return;
    if (controls.loop) {
      try { const result = resolveLoop(state.chart.bars, ...range.value, duration.value); loopStart = result.start; loopEnd = result.end; }
      catch (error) { notice(error, true); return; }
    } else { loopStart = 0; loopEnd = duration.value; }
    playbackRate = controls.rate; looping = controls.loop;
    let position = from ?? state.position;
    if (controls.loop && (position < loopStart || position >= loopEnd)) position = loopStart;
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
    const key = '24'.includes(note) ? 'ka' : 'don';
    if (!hitBuffers.has(key)) hitBuffers.set(key, createHitBuffer(context, note));
    const voice = context.createBufferSource(), level = context.createGain();
    voice.buffer = hitBuffers.get(key); level.gain.value = '34'.includes(note) ? 1.15 : .85;
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
      const note = item.notes[index]; if (!'1234'.includes(note)) continue;
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
      const documents = state.documents.map(({ id, text, filename, savedText, course, selected, undo, redo, dirty, invalid, source, encoding }) => ({ id, text, filename, savedText, course, selected, undo, redo, dirty, invalid, source, encoding }));
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
  function commit(text, keepSource = false) {
    const chart = parseChart(text, parser, state.course);
    if (text === state.text) { state.invalid = false; state.sourceState = '已同步'; if (persist()) notice(message('更改已同步。')); return; }
    const waveChanged = chart.wave !== state.chart.wave;
    const playing = state.playing, position = currentTime(); pause();
    state.undo = [...state.undo.slice(-(HISTORY_LIMIT - 1)), textDiff(state.text, text)]; state.redo = [];
    state.text = text; state.chart = chart; state.dirty = text !== state.savedText; state.invalid = false;
    state.selected = Math.min(state.selected, chart.bars.length - 1);
    if (waveChanged) clearAudio();
    if (!keepSource) syncSource(); else state.sourceState = '已同步';
    if (persist()) notice(message('更改已同步。'));
    if (waveChanged) void autoAudio(); else if (playing) void play(position);
  }
  function requireValid() { if (state.invalid) throw new LocalizedError(message('请先修正当前小节源码。')); }
  function clampTimelineStart(start) {
    const bounds = timelineBounds.value;
    return Math.max(bounds.start, Math.min(start, Math.max(bounds.start, bounds.end - viewSpan.value)));
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
    const { start, end } = visible.value;
    if (position < start || position >= end) panTimeline(start + Math.floor((position - start) / viewSpan.value) * viewSpan.value, false);
  }
  function select(index, seek = true) {
    if (!state.chart) return;
    guard(() => {
      requireValid(); if (!Number.isInteger(index)) throw new LocalizedError(message('小节编号须为整数。'));
      const playing = state.playing; pause(); state.selectedCell = null; state.commandCell = null;
      state.selected = Math.max(0, Math.min(state.chart.bars.length - 1, index));
      if (seek) state.position = Math.max(0, measureStart(bar.value));
      panTimeline(measureStart(bar.value), false); state.followPlayback = true;
      syncSource(); persist(); if (playing) void play();
    });
  }
  function seek(time) { const playing = state.playing; pause(); state.position = Math.max(0, time); if (playing) void play(); }
  function selectCell(position) {
    if (state.invalid) return;
    pause(); state.selected = position.bar; state.selectedCell = position; state.commandCell = { ...position }; syncSource(); persist();
  }
  function moveCell(direction) {
    if (!state.chart || state.invalid) return;
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
    const time = barTimeAt(state.chart.bars[index], slot / denominator), start = viewAnimation?.target ?? visible.value.start;
    if (time < start || time >= start + viewSpan.value) panTimeline(time - viewSpan.value * .25, false, true);
  }
  function setCommandPosition(numerator, denominator) {
    guard(() => {
      requireValid();
      if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator < 1 || numerator > denominator || denominator > 65536) throw new LocalizedError(message('指令位置须在 0/1 至 1/1 之间，分母最多 65536。'));
      pause(); state.commandCell = { bar: state.selected, numerator, denominator };
      state.selectedCell = numerator < denominator ? { ...state.commandCell, divisions: controls.snap } : null;
    });
  }
  function applySettings(settings) { guard(() => { requireValid(); commit(setPositionSettings(state.text, state.chart, command.value, settings, parser)); }); }
  function clearSettings() { guard(() => { requireValid(); commit(clearPositionSettings(state.text, bar.value, command.value)); }); }
  function removeCommand(item) { guard(() => { requireValid(); commit(state.text.slice(0, item.start) + state.text.slice(item.end)); }); }
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
      const diff = from.at(-1), text = applyDiff(state.text, diff, !redo), chart = parseChart(text, parser, state.course);
      const waveChanged = chart.wave !== state.chart.wave;
      if (redo) { state.redo = from.slice(0, -1); state.undo = [...state.undo, diff]; }
      else { state.undo = from.slice(0, -1); state.redo = [...state.redo, diff]; }
      state.text = text; state.chart = chart; state.selected = Math.min(state.selected, chart.bars.length - 1);
      if (waveChanged) clearAudio();
      state.selectedCell = null; state.commandCell = null; state.invalid = false; state.dirty = text !== state.savedText; syncSource(); persist();
      if (waveChanged) void autoAudio();
    });
  }
  function setLoop(first, last) {
    return guard(() => {
      if (!state.chart) throw new LocalizedError(message('请先载入谱面。'));
      if (!Number.isInteger(first) || !Number.isInteger(last)) throw new LocalizedError(message('循环小节须为整数。'));
      first = Math.max(1, Math.min(state.chart.bars.length, first));
      last = Math.max(1, Math.min(state.chart.bars.length, last));
      const resolved = resolveLoop(state.chart.bars, first, last, Infinity);
      const playing = state.playing; pause(); state.customLoop = [first, last]; state.position = resolved.start;
      panTimeline(resolved.start, false); state.followPlayback = true;
      if (!state.invalid) { state.selected = first - 1; state.selectedCell = null; state.commandCell = null; syncSource(); }
      if (persist()) notice(message('循环范围已设为第 {p0}–{p1} 小节。', { p0: first, p1: last }));
      if (playing) void play(resolved.start);
      return true;
    });
  }
  function loopCurrent(preview = false) {
    if (!bar.value) return;
    const playing = state.playing; pause(); state.customLoop = null; state.position = Math.max(0, measureStart(bar.value));
    panTimeline(measureStart(bar.value), false); state.followPlayback = true;
    if (preview) controls.loop = true;
    if (preview || playing) void play();
  }
  function stop() {
    pause();
    if (bar.value) state.position = Math.max(0, controls.loop ? Math.min(...state.chart.bars.slice(range.value[0] - 1, range.value[1]).map(measureStart)) : measureStart(bar.value));
    if (state.chart) { panTimeline(state.position, false); state.followPlayback = true; }
  }
  function previewRange() {
    if (!state.chart) return;
    controls.loop = true;
    void play(Math.max(0, Math.min(...state.chart.bars.slice(range.value[0] - 1, range.value[1]).map(measureStart))));
  }
  function setSnap(value) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_SNAP_DIVISIONS) { controls.customSnap = controls.snap; notice(message('吸附细分须为 1–768 之间的整数。'), true); return; }
    controls.snap = value; controls.customSnap = value;
  }
  function changeCourse(value) {
    guard(() => {
      requireValid(); const chart = parseChart(state.text, parser, value); pause();
      state.course = value; state.chart = chart; state.selected = 0; state.selectedCell = null; state.commandCell = null; state.customLoop = null;
      state.position = Math.max(0, measureStart(chart.bars[0])); syncSource(); persist();
      panTimeline(measureStart(chart.bars[0]), false); state.followPlayback = true;
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
    if (!state.invalid) void autoAudio();
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
    if (active && !state.invalid) void autoAudio();
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
    loadChart(new TextEncoder().encode('TITLE:Untitled\nBPM:120\nOFFSET:0\nCOURSE:Oni\nLEVEL:1\n#START\n0000,\n#END\n'), 'untitled.tja');
  }
  function loadChart(bytes, name, fileHandle = null, chartPath = '') {
    const decoded = decodeChart(bytes), chart = parseChart(decoded.text, parser, 0);
    leaveDocument();
    const document = shallowReactive({ ...emptyDocument(), id: nextDocumentId++, text: decoded.text, savedText: decoded.text, fileHandle, sourceHandle: fileHandle, chartPath, chart, filename: name, encoding: decoded.encoding, position: Math.max(0, measureStart(chart.bars[0])), viewStart: measureStart(chart.bars[0]) });
    state.documents = [...state.documents, document]; activate(document);
    syncSource(); if (persist()) notice(message('谱面已载入，可直接播放音符音或载入伴奏。'));
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
    try {
      const bytes = await file.arrayBuffer(); if (disposed) return;
      loadChart(bytes, file.name, fileHandle, file.webkitRelativePath?.split('/').slice(1).join('/') || '');
      await autoAudio();
    } catch (error) { if (!disposed) notice(error, true); }
  }
  async function openCharts() {
    try {
      const handles = await window.showOpenFilePicker({ multiple: true, types: chartFileTypes() });
      for (const handle of handles) {
        const file = await handle.getFile();
        if (disposed) return;
        await openChart(file, handle);
      }
    } catch (error) {
      if (!disposed) notice(error.name === 'AbortError' ? message('已取消打开谱面。') : message('打开谱面失败：{p0}', { p0: error }), error.name !== 'AbortError');
    }
  }
  async function openAudio(file) {
    if (!file) return;
    if (!state.chart) { notice(message('请先打开谱面，再载入对应音频。'), true); return; }
    const request = ++audioRequest;
    try {
      const bytes = await file.arrayBuffer();
      if (!disposed && request === audioRequest) await loadAudio(bytes, file.name, request);
    } catch (error) { if (!disposed && request === audioRequest) notice(message('音频读取失败：{p0}', { p0: error }), true); }
  }
  async function autoAudio() {
    if (!state.chart?.wave || state.buffer) return false;
    const wave = state.chart.wave;
    if (!mediaDirectory && !mediaFiles) {
      notice(message('WAVE: {p0}；关联音频文件夹后可自动载入，也可直接无伴奏播放。', { p0: wave }));
      return false;
    }
    const request = ++audioRequest;
    const options = { directory: mediaDirectory, files: mediaFiles, chartHandle: state.sourceHandle || state.fileHandle, chartPath: state.chartPath, chartName: state.filename };
    try {
      const file = await findWaveFile(wave, options);
      if (disposed || request !== audioRequest) return false;
      const bytes = await file.arrayBuffer();
      if (disposed || request !== audioRequest) return false;
      await loadAudio(bytes, file.name, request);
      return !disposed && request === audioRequest;
    } catch (error) {
      if (!disposed && request === audioRequest) notice(message('自动载入 {p0} 失败：{p1} 可继续无伴奏播放或手动载入音频。', { p0: wave, p1: error }), true);
      return false;
    }
  }
  async function chooseMediaDirectory() {
    try {
      const directory = await window.showDirectoryPicker({ id: 'tja-audio-directory', mode: 'read' });
      if (disposed) return false;
      mediaDirectory = directory; mediaFiles = null; ++audioRequest;
      state.mediaDirectoryName = directory.name;
      notice(message('已关联音频文件夹 {p0}，将按 WAVE 自动匹配音频。', { p0: directory.name }));
      await autoAudio();
      return true;
    } catch (error) {
      if (!disposed) notice(error.name === 'AbortError' ? message('已取消关联音频文件夹。') : message('关联音频文件夹失败：{p0}', { p0: error }), error.name !== 'AbortError');
      return false;
    }
  }
  async function setMediaFiles(files) {
    if (!files.length) return false;
    try {
      const indexed = indexMediaFiles(files);
      mediaDirectory = null; mediaFiles = indexed.files; ++audioRequest;
      state.mediaDirectoryName = indexed.name;
      notice(message('已关联音频文件夹 {p0}，将按 WAVE 自动匹配音频。', { p0: indexed.name }));
      await autoAudio();
      return true;
    } catch (error) { notice(message('关联音频文件夹失败：{p0}', { p0: error }), true); return false; }
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
        const chart = parseChart(item.text, parser, item.course), undo = item.undo ?? [], redo = item.redo ?? [];
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
        return shallowReactive({ ...emptyDocument(), id, text: item.text, savedText, filename: item.filename, course: item.course, chart, selected, undo, redo, dirty: item.text !== savedText, invalid: Boolean(item.invalid), encoding: item.encoding || '', source: item.invalid ? item.source : barSource(item.text, chart.bars[selected]), sourceState: item.invalid ? '格式错误' : '已同步', position: Math.max(0, measureStart(chart.bars[selected])), viewStart: measureStart(chart.bars[selected]) });
      });
      if (state.documents.length && !confirm(t('恢复草稿会替换所有已打开谱面，是否继续？'))) return;
      viewAnimation = null; pause(); clearTimeout(sourceTimer); ++audioRequest;
      state.documents = documents;
      nextDocumentId = Math.max(0, ...documents.map(item => item.id)) + 1;
      const active = documents.find(item => item.id === saved.activeId) || documents[0];
      if (active) { activate(active); flushSource(); }
      else { state.activeId = null; Object.assign(state, emptyDocument()); }
      if (persist()) notice(state.invalid ? message('已恢复谱面及编辑历史；当前小节源码仍有错误，请修正。') : message('已恢复谱面及编辑历史；音频可重新载入或关联文件夹匹配。'), state.invalid);
      if (!state.invalid) void autoAudio();
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
  watch(() => [controls.loop, controls.rate], () => { if (state.playing) void play(currentTime()); });
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
      state.viewStart = clampTimelineStart(viewAnimation.start + (viewAnimation.target - viewAnimation.start) * (1 - (1 - progress) ** 3));
      if (progress === 1) viewAnimation = null;
    }
    if (state.playing) {
      const position = currentTime(); state.position = position;
      if (state.followPlayback) followTime(position);
      if (state.followPlayback && (!controls.loop || state.customLoop) && !state.invalid && document.activeElement?.id !== 'source') {
        const containing = state.chart.bars.findLastIndex(item => position >= measureStart(item) && position < measureEnd(item));
        const next = containing >= 0 ? containing : state.chart.bars.findLastIndex(item => measureStart(item) <= position);
        if (next >= 0 && next !== state.selected) { state.selected = next; state.selectedCell = null; state.commandCell = null; syncSource(); }
      }
    }
    frame = requestAnimationFrame(animate);
  }
  function keydown(event) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault(); if (!event.repeat) void saveChart(event.shiftKey); return;
    }
    const inDialog = document.activeElement?.closest?.('dialog, [role="dialog"]');
    if (event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey && !event.isComposing && event.key.toLowerCase() === 'w' && !inDialog) {
      event.preventDefault();
      if (!event.repeat && state.activeId !== null) { document.activeElement?.blur?.(); closeChart(state.activeId); }
      return;
    }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing && !inDialog && state.selectedCell) {
      event.preventDefault(); viewAnimation = null; state.selectedCell = null; state.commandCell = null; snapshot(); return;
    }
    const note = /^[0-9]$/.test(event.key) ? event.key : ['Delete', 'Backspace'].includes(event.key) ? '0' : null;
    if (event.code === 'Space' || event.key === ' ') {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing || document.activeElement?.tagName === 'SUMMARY' || inDialog) return;
      event.preventDefault();
      if (!event.repeat) { if (state.playing) pause(); else void play(); }
    }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); history(event.shiftKey); }
    else if (note !== null && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing && !inDialog && state.selectedCell && !state.invalid) {
      event.preventDefault(); if (!event.repeat) chooseNote(note);
    }
    else if (['ArrowLeft', 'ArrowRight'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing && !inDialog) {
      event.preventDefault(); moveCell(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }
  function beforeUnload(event) {
    snapshot();
    if (state.documents.some(item => item.dirty || item.invalid || item.saving)) { event.preventDefault(); event.returnValue = ''; }
  }
  onMounted(() => {
    document.addEventListener('keydown', keydown); window.addEventListener('beforeunload', beforeUnload);
    scheduler = setInterval(schedule, 25); animate();
    guard(() => { if (localStorage.getItem(WORKSPACE_KEY) || localStorage.getItem('tja-wave-draft')) restore(); });
  });
  onUnmounted(() => {
    disposed = true; clearTimeout(sourceTimer); clearInterval(scheduler); cancelAnimationFrame(frame);
    pause(); void context?.close(); document.removeEventListener('keydown', keydown); window.removeEventListener('beforeunload', beforeUnload);
  });
  return { state, controls, bar, spans, visible, viewSpan, timelineBounds, stats, cell, command, range, duration, metadata, notice, pause, play, stop, previewRange, seek, panTimeline, select, selectCell, setCommandPosition, applySettings, clearSettings, removeCommand, chooseNote, editSource, history, setLoop, loopCurrent, setSnap, changeCourse, openChart, openCharts, openAudio, autoAudio, chooseMediaDirectory, setMediaFiles, newChart, switchChart, closeChart, renameChart, restore, saveChart, saveAs, setOffset, setBpm, setMetadata, setDivision, clearBar, setBalloon };
}