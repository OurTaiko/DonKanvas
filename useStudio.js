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
const chartFileTypes = [{ description: 'TJA 谱面', accept: { 'text/plain': ['.tja'] } }];
const documentFields = ['text', 'chart', 'selected', 'course', 'buffer', 'peaks', 'position', 'undo', 'redo', 'filename', 'savedText', 'fileHandle', 'sourceHandle', 'chartPath', 'saving', 'dirty', 'invalid', 'selectedCell', 'commandCell', 'source', 'sourceState', 'encoding', 'audioName', 'customLoop'];
const emptyDocument = () => ({ text: '', chart: null, selected: 0, course: 0, buffer: null, peaks: [], position: 0, undo: [], redo: [], filename: 'chart.tja', savedText: null, fileHandle: null, sourceHandle: null, chartPath: '', saving: false, dirty: false, invalid: false, selectedCell: null, commandCell: null, source: '', sourceState: '已同步', encoding: '', audioName: '无伴奏 · 可直接播放谱面', customLoop: null });
function chartFilename(name) {
  name = name.trim();
  if (!name || /[\\/:*?"<>|\r\n]/.test(name)) throw new Error('请输入有效的谱面文件名。');
  return /\.tja$/i.test(name) ? name : `${name}.tja`;
}

export const formatTime = value => {
  const sign = value < 0 ? '-' : '';
  value = Math.abs(value);
  return `${sign}${String(Math.floor(value / 60)).padStart(2, '0')}:${(value % 60).toFixed(3).padStart(6, '0')}`;
};

export function useStudio() {
  const state = shallowReactive({ ...emptyDocument(), documents: [], activeId: null, mediaDirectoryName: '', playing: false, saveState: '尚未打开谱面', notice: '请选择 TJA 谱面，可无伴奏播放或载入对应音频。', error: false });
  let nextDocumentId = 1;
  let mediaDirectory = null, mediaFiles = null;
  const controls = reactive({ loop: true, hits: true, rate: 1, volume: MIX_DEFAULTS.music, hitVolume: MIX_DEFAULTS.hits, view: 2, snap: GRID_DIVISIONS, snapChoice: '16', customSnap: GRID_DIVISIONS });
  const bar = computed(() => state.chart?.bars[state.selected]);
  const spans = computed(() => state.chart ? longNoteSpans(state.chart.bars) : []);
  const range = computed(() => state.customLoop || [state.selected + 1, state.selected + 1]);
  const metadata = computed(() => songMetadata(state.text));
  const duration = computed(() => state.buffer?.duration ?? state.chart?.bars.reduce((end, item) => Math.max(end, measureEnd(item)), 0) ?? 0);
  const visible = computed(() => {
    if (!state.chart) return null;
    const bars = state.chart.bars.slice(state.selected, state.selected + controls.view);
    return { bars, start: Math.min(...bars.map(measureStart)), end: Math.max(...bars.map(measureEnd)) };
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
    return { ...selected, note, time, ordinal, count, name: NOTE_TYPES[Number(note)].name, span: spans.value.find(span => time >= span.start - .000001 && time <= span.end + .000001) };
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
  const notice = (message, error = false) => { state.notice = message; state.error = error; };
  const guard = action => { try { return action(); } catch (error) { notice(error.message, true); } };
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
    if (!state.chart) { notice('请先载入谱面。', true); return; }
    if (!(duration.value > 0)) { notice('谱面没有可播放的正时间区间，请检查 OFFSET 和 DELAY。', true); return; }
    pause();
    const request = ++playRequest;
    try { await audioContext().resume(); } catch (error) { notice(`播放失败：${error.message}`, true); return; }
    if (disposed || request !== playRequest) return;
    if (controls.loop) {
      try { const result = resolveLoop(state.chart.bars, ...range.value, duration.value); loopStart = result.start; loopEnd = result.end; }
      catch (error) { notice(error.message, true); return; }
    } else { loopStart = 0; loopEnd = duration.value; }
    playbackRate = controls.rate; looping = controls.loop;
    let position = from ?? state.position;
    if (controls.loop && (position < loopStart || position >= loopEnd)) position = loopStart;
    if (!looping && position >= loopEnd) position = 0;
    position = Math.max(0, Math.min(position, Math.max(0, duration.value - .001)));
    origin = position; anchor = context.currentTime + .035; scheduledUntil = anchor; state.position = position; state.playing = true;
    if (state.buffer) {
      music = context.createBufferSource(); music.buffer = state.buffer; music.playbackRate.value = playbackRate; music.connect(gain);
      music.loop = looping; music.loopStart = loopStart; music.loopEnd = loopEnd;
      music.onended = () => { if (state.playing) { pause(); state.position = loopEnd; } };
      music.start(anchor, position);
    } else notice(controls.hits && controls.hitVolume > 0 ? '无伴奏播放：正在播放谱面音符音。' : '无伴奏播放：音符音已关闭或音量为零，当前仅运行播放头。');
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
    } catch (error) { state.saveState = '草稿存储不可用 · 请及时保存文件'; notice(`草稿保存失败：${error.message}`, true); return false; }
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
    if (text === state.text) { state.invalid = false; state.sourceState = '已同步'; if (persist()) notice('更改已同步。'); return; }
    const waveChanged = chart.wave !== state.chart.wave;
    const playing = state.playing, position = currentTime(); pause();
    state.undo = [...state.undo.slice(-(HISTORY_LIMIT - 1)), textDiff(state.text, text)]; state.redo = [];
    state.text = text; state.chart = chart; state.dirty = text !== state.savedText; state.invalid = false;
    state.selected = Math.min(state.selected, chart.bars.length - 1);
    if (waveChanged) clearAudio();
    if (!keepSource) syncSource(); else state.sourceState = '已同步';
    if (persist()) notice('更改已同步。');
    if (waveChanged) void autoAudio(); else if (playing) void play(position);
  }
  function requireValid() { if (state.invalid) throw new Error('请先修正当前小节源码。'); }
  function select(index, seek = true) {
    if (!state.chart) return;
    guard(() => {
      requireValid(); if (!Number.isInteger(index)) throw new Error('小节编号须为整数。');
      const playing = state.playing; pause(); state.selectedCell = null; state.commandCell = null;
      state.selected = Math.max(0, Math.min(state.chart.bars.length - 1, index));
      if (seek) state.position = Math.max(0, measureStart(bar.value));
      syncSource(); persist(); if (playing) void play();
    });
  }
  function seek(time) { const playing = state.playing; pause(); state.position = Math.max(0, time); if (playing) void play(); }
  function selectCell(position) {
    if (state.invalid) return;
    pause(); state.selected = position.bar; state.selectedCell = position; state.commandCell = { ...position }; syncSource(); persist();
  }
  function setCommandPosition(numerator, denominator) {
    guard(() => {
      requireValid();
      if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator < 1 || numerator > denominator || denominator > 65536) throw new Error('指令位置须在 0/1 至 1/1 之间，分母最多 65536。');
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
    catch (error) { state.sourceState = '格式错误'; persist(); notice(error.message, true); }
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
      if (!state.chart) throw new Error('请先载入谱面。');
      if (!Number.isInteger(first) || !Number.isInteger(last)) throw new Error('循环小节须为整数。');
      first = Math.max(1, Math.min(state.chart.bars.length, first));
      last = Math.max(1, Math.min(state.chart.bars.length, last));
      const resolved = resolveLoop(state.chart.bars, first, last, Infinity);
      const playing = state.playing; pause(); state.customLoop = [first, last]; state.position = resolved.start;
      if (!state.invalid) { state.selected = first - 1; state.selectedCell = null; state.commandCell = null; syncSource(); }
      if (persist()) notice(`循环范围已设为第 ${first}–${last} 小节。`);
      if (playing) void play(resolved.start);
      return true;
    });
  }
  function loopCurrent(preview = false) {
    if (!bar.value) return;
    const playing = state.playing; pause(); state.customLoop = null; state.position = Math.max(0, measureStart(bar.value));
    if (preview) controls.loop = true;
    if (preview || playing) void play();
  }
  function stop() {
    pause();
    if (bar.value) state.position = Math.max(0, controls.loop ? Math.min(...state.chart.bars.slice(range.value[0] - 1, range.value[1]).map(measureStart)) : measureStart(bar.value));
  }
  function previewRange() {
    if (!state.chart) return;
    controls.loop = true;
    void play(Math.max(0, Math.min(...state.chart.bars.slice(range.value[0] - 1, range.value[1]).map(measureStart))));
  }
  function setSnap(value) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_SNAP_DIVISIONS) { controls.customSnap = controls.snap; notice('吸附细分须为 1–768 之间的整数。', true); return; }
    controls.snap = value; controls.customSnap = value;
  }
  function changeCourse(value) {
    guard(() => {
      requireValid(); const chart = parseChart(state.text, parser, value); pause();
      state.course = value; state.chart = chart; state.selected = 0; state.selectedCell = null; state.commandCell = null; state.customLoop = null;
      state.position = Math.max(0, measureStart(chart.bars[0])); syncSource(); persist();
    });
  }
  function leaveDocument() {
    pause(); flushSource(); snapshot(); ++audioRequest;
  }
  function activate(document) {
    state.activeId = document.id;
    Object.assign(state, Object.fromEntries(documentFields.map(key => [key, document[key]])));
  }
  function switchChart(id) {
    if (id === state.activeId) return;
    const document = state.documents.find(item => item.id === id);
    if (!document) { notice('找不到此谱面。', true); return; }
    leaveDocument(); activate(document);
    if (persist()) notice(state.invalid ? '已切换谱面；请修正保留的小节源码。' : '已切换谱面。', state.invalid);
    if (!state.invalid) void autoAudio();
  }
  function closeChart(id) {
    const document = state.documents.find(item => item.id === id);
    if (!document) return;
    const active = id === state.activeId;
    if (document.saving) { notice('谱面正在保存，请完成后再关闭。', true); return; }
    if (active) { pause(); flushSource(); snapshot(); }
    if ((document.dirty || document.invalid) && !confirm(`关闭 ${document.filename} 将移除此谱面及其草稿和历史。请先保存需要的内容，是否继续？`)) return;
    const index = state.documents.indexOf(document);
    if (active) { clearTimeout(sourceTimer); ++audioRequest; }
    state.documents = state.documents.filter(item => item.id !== id);
    if (active) {
      const next = state.documents[Math.min(index, state.documents.length - 1)];
      if (next) activate(next);
      else { state.activeId = null; Object.assign(state, emptyDocument()); }
    }
    if (persist()) notice('谱面已关闭。');
    if (active && !state.invalid) void autoAudio();
  }
  function renameChart(name) {
    return guard(() => {
      if (!state.chart) throw new Error('请先打开谱面。');
      if (state.saving) throw new Error('请等待保存完成后再修改文件名。');
      name = chartFilename(name);
      if (name === state.filename) return true;
      state.filename = name; state.fileHandle = null; state.savedText = null; state.dirty = true; persist();
      return true;
    });
  }
  function newChart() {
    loadChart(new TextEncoder().encode('TITLE:Untitled\nBPM:120\nOFFSET:0\nCOURSE:Oni\nLEVEL:1\n#START\n0000,\n#END\n'), 'untitled.tja');
    state.savedText = null; state.dirty = true; persist();
  }
  function loadChart(bytes, name, fileHandle = null, chartPath = '') {
    const decoded = decodeChart(bytes), chart = parseChart(decoded.text, parser, 0);
    leaveDocument();
    const document = shallowReactive({ ...emptyDocument(), id: nextDocumentId++, text: decoded.text, savedText: decoded.text, fileHandle, sourceHandle: fileHandle, chartPath, chart, filename: name, encoding: decoded.encoding, position: Math.max(0, measureStart(chart.bars[0])) });
    state.documents = [...state.documents, document]; activate(document);
    syncSource(); if (persist()) notice('谱面已载入，可直接播放音符音或载入伴奏。');
  }
  async function loadAudio(bytes, name, request) {
    pause(); notice('正在解析音频波形…');
    const buffer = await audioContext().decodeAudioData(bytes);
    if (disposed || request !== audioRequest) return;
    const count = Math.min(120000, buffer.length), peaks = new Float32Array(count), step = buffer.length / count;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < count; index++) for (let sample = Math.floor(index * step); sample < Math.floor((index + 1) * step); sample++) peaks[index] = Math.max(peaks[index], Math.abs(samples[sample]));
    }
    pause(); state.buffer = buffer; state.peaks = peaks; state.audioName = name; state.position = Math.max(0, Math.min(state.position, buffer.duration)); notice('音频已就绪。');
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
    } catch (error) { if (!disposed) notice(error.message, true); }
  }
  async function openCharts() {
    try {
      const handles = await window.showOpenFilePicker({ multiple: true, types: chartFileTypes });
      for (const handle of handles) {
        const file = await handle.getFile();
        if (disposed) return;
        await openChart(file, handle);
      }
    } catch (error) {
      if (!disposed) notice(error.name === 'AbortError' ? '已取消打开谱面。' : `打开谱面失败：${error.message}`, error.name !== 'AbortError');
    }
  }
  async function openAudio(file) {
    if (!file) return;
    if (!state.chart) { notice('请先打开谱面，再载入对应音频。', true); return; }
    const request = ++audioRequest;
    try {
      const bytes = await file.arrayBuffer();
      if (!disposed && request === audioRequest) await loadAudio(bytes, file.name, request);
    } catch (error) { if (!disposed && request === audioRequest) notice(`音频读取失败：${error.message}`, true); }
  }
  async function autoAudio() {
    if (!state.chart?.wave || state.buffer) return false;
    const wave = state.chart.wave;
    if (!mediaDirectory && !mediaFiles) {
      notice(`WAVE: ${wave}；关联音频文件夹后可自动载入，也可直接无伴奏播放。`);
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
      if (!disposed && request === audioRequest) notice(`自动载入 ${wave} 失败：${error.message} 可继续无伴奏播放或手动载入音频。`, true);
      return false;
    }
  }
  async function chooseMediaDirectory() {
    try {
      const directory = await window.showDirectoryPicker({ id: 'tja-audio-directory', mode: 'read' });
      if (disposed) return false;
      mediaDirectory = directory; mediaFiles = null; ++audioRequest;
      state.mediaDirectoryName = directory.name;
      notice(`已关联音频文件夹 ${directory.name}，将按 WAVE 自动匹配音频。`);
      await autoAudio();
      return true;
    } catch (error) {
      if (!disposed) notice(error.name === 'AbortError' ? '已取消关联音频文件夹。' : `关联音频文件夹失败：${error.message}`, error.name !== 'AbortError');
      return false;
    }
  }
  async function setMediaFiles(files) {
    if (!files.length) return false;
    try {
      const indexed = indexMediaFiles(files);
      mediaDirectory = null; mediaFiles = indexed.files; ++audioRequest;
      state.mediaDirectoryName = indexed.name;
      notice(`已关联音频文件夹 ${indexed.name}，将按 WAVE 自动匹配音频。`);
      await autoAudio();
      return true;
    } catch (error) { notice(`关联音频文件夹失败：${error.message}`, true); return false; }
  }
  function restore() {
    guard(() => {
      if (state.documents.some(item => item.saving)) throw new Error('请等待文件保存完成后再恢复草稿。');
      const workspace = localStorage.getItem(WORKSPACE_KEY);
      const saved = JSON.parse(workspace || localStorage.getItem('tja-wave-draft') || 'null');
      if (!saved) throw new Error('没有本地草稿。');
      if (workspace && (saved.version !== 1 || !Array.isArray(saved.documents))) throw new Error('本地工作区格式无效。');
      const entries = workspace ? saved.documents : [{ ...saved, dirty: true }];
      const ids = new Set();
      const documents = entries.map((item, index) => {
        if (typeof item.text !== 'string' || typeof item.filename !== 'string' || !Number.isInteger(item.course) || item.course < 0 || !Number.isInteger(item.selected) || (item.invalid && typeof item.source !== 'string')) throw new Error('本地谱面草稿格式无效。');
        const chart = parseChart(item.text, parser, item.course), undo = item.undo ?? [], redo = item.redo ?? [];
        const savedText = item.savedText === undefined ? (item.dirty ? null : item.text) : item.savedText;
        if (savedText !== null && typeof savedText !== 'string') throw new Error('本地谱面保存状态无效。');
        if (!Array.isArray(undo) || !Array.isArray(redo) || undo.length + redo.length > HISTORY_LIMIT) throw new Error('本地编辑历史格式无效。');
        let text = item.text;
        for (const diff of [...undo].reverse()) text = applyDiff(text, diff, true);
        text = item.text;
        for (const diff of [...redo].reverse()) text = applyDiff(text, diff);
        const id = workspace ? item.id : index + 1;
        if (!Number.isSafeInteger(id) || id < 1 || ids.has(id)) throw new Error('本地谱面编号无效。');
        ids.add(id);
        const selected = Math.max(0, Math.min(item.selected, chart.bars.length - 1));
        return shallowReactive({ ...emptyDocument(), id, text: item.text, savedText, filename: item.filename, course: item.course, chart, selected, undo, redo, dirty: item.text !== savedText, invalid: Boolean(item.invalid), encoding: item.encoding || '', source: item.invalid ? item.source : barSource(item.text, chart.bars[selected]), sourceState: item.invalid ? '格式错误' : '已同步', position: Math.max(0, measureStart(chart.bars[selected])) });
      });
      if (state.documents.length && !confirm('恢复草稿会替换所有已打开谱面，是否继续？')) return;
      pause(); clearTimeout(sourceTimer); ++audioRequest;
      state.documents = documents;
      nextDocumentId = Math.max(0, ...documents.map(item => item.id)) + 1;
      const active = documents.find(item => item.id === saved.activeId) || documents[0];
      if (active) { activate(active); flushSource(); }
      else { state.activeId = null; Object.assign(state, emptyDocument()); }
      if (persist()) notice(state.invalid ? '已恢复谱面及编辑历史；当前小节源码仍有错误，请修正。' : '已恢复谱面及编辑历史；音频可重新载入或关联文件夹匹配。', state.invalid);
      if (!state.invalid) void autoAudio();
    });
  }
  function updateDocument(document, values) {
    Object.assign(document, values);
    if (state.activeId === document.id) Object.assign(state, values);
  }
  async function saveChart(as = false) {
    if (!state.chart) { notice('请先打开谱面。', true); return false; }
    if (state.saving) { notice('此谱面正在保存，请稍候。', true); return false; }
    flushSource();
    if (state.invalid) { notice('请先修正小节源码后再保存。', true); return false; }
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
        const requested = as ? window.prompt('另存为文件名（保存位置由浏览器下载设置决定）', target.filename) : target.filename;
        if (requested === null) { notice('已取消另存为，修改仍保留。'); return false; }
        const filename = chartFilename(requested), url = URL.createObjectURL(blob);
        try {
          const link = document.createElement('a');
          link.href = url; link.download = filename; link.click();
        } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
        updateDocument(target, { filename, fileHandle: null, savedText: null, dirty: true });
        if (persist()) notice(`浏览器不支持直接写回文件，已请求下载 ${filename} 的 UTF-8 副本。请确认下载完成；未保存标记仍保留。`);
        return true;
      }
      if (!handle) {
        choosing = true;
        handle = await window.showSaveFilePicker({ suggestedName: target.filename, types: chartFileTypes });
        choosing = false;
      } else {
        const diskText = decodeChart(await (await handle.getFile()).arrayBuffer()).text;
        if (disposed) return false;
        if (diskText !== target.savedText && !confirm(`${target.filename} 在磁盘上已发生变化。继续保存将覆盖磁盘内容，是否继续？`)) {
          notice('已取消覆盖，修改仍保留。'); return false;
        }
      }
      if (disposed) return false;
      const writable = await handle.createWritable();
      if (disposed) { await writable.abort(); return false; }
      try { await writable.write(blob); await writable.close(); }
      catch (error) {
        try { await writable.abort(); }
        catch (abortError) { throw new Error(`${error.message}；中止写入失败：${abortError.message}`); }
        throw error;
      }
      updateDocument(target, { fileHandle: handle, filename: handle.name, savedText: text, dirty: target.text !== text, encoding: 'UTF-8' });
      if (persist()) notice(`已保存 ${handle.name}（UTF-8 BOM）${target.dirty || target.invalid ? '；保存期间的新修改尚未保存。' : '。'}`);
      return true;
    } catch (error) {
      if (!disposed) notice(choosing && error.name === 'AbortError' ? '已取消保存，修改仍保留。' : `保存 ${target.filename} 失败：${error.message}`, !(choosing && error.name === 'AbortError'));
      return false;
    } finally { updateDocument(target, { saving: false }); }
  }
  function saveAs() { return saveChart(true); }
  function setOffset(value) {
    return guard(() => { requireValid(); if (!Number.isFinite(value)) throw new Error('偏移无效'); commit(/^OFFSET:/mi.test(state.text) ? state.text.replace(/^OFFSET:[^\r\n]*/mi, `OFFSET:${value}`) : `OFFSET:${value}\n${state.text}`); return true; });
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
  function animate() {
    if (state.playing) {
      const position = currentTime(); state.position = position;
      if ((!controls.loop || state.customLoop) && !state.invalid && document.activeElement?.id !== 'source') {
        const { start, end } = visible.value;
        if (position >= end || position < start) {
          const containing = state.chart.bars.findLastIndex(item => position >= measureStart(item) && position < measureEnd(item));
          const next = containing >= 0 ? containing : state.chart.bars.findLastIndex(item => measureStart(item) <= position);
          if (next >= 0 && next !== state.selected) { state.selected = next; state.selectedCell = null; state.commandCell = null; syncSource(); }
        }
      }
    }
    frame = requestAnimationFrame(animate);
  }
  function keydown(event) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault(); if (!event.repeat) void saveChart(event.shiftKey); return;
    }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    if (event.code === 'Space') {
      if (['BUTTON', 'SUMMARY'].includes(document.activeElement?.tagName)) return;
      event.preventDefault(); if (state.playing) pause(); else void play();
    }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); history(event.shiftKey); }
    else if (/^[0-9]$/.test(event.key)) chooseNote(event.key);
    else if (event.key === 'ArrowLeft') { event.preventDefault(); select(state.selected - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); select(state.selected + 1); }
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
  return { state, controls, bar, spans, visible, stats, cell, command, range, duration, metadata, notice, pause, play, stop, previewRange, seek, select, selectCell, setCommandPosition, applySettings, clearSettings, removeCommand, chooseNote, editSource, history, setLoop, loopCurrent, setSnap, changeCourse, openChart, openCharts, openAudio, autoAudio, chooseMediaDirectory, setMediaFiles, newChart, switchChart, closeChart, renameChart, restore, saveChart, saveAs, setOffset, setBpm, setMetadata, setDivision, clearBar, setBalloon };
}