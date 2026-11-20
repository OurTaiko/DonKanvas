import { computed, onMounted, onUnmounted, reactive, shallowReactive, watch } from 'vue';
import { TJAParser as parser } from 'tja';
import { decodeChart, parseChart, resizeNotes, setBaseBpm, barTimeAt, barStateAt, setPositionSettings, clearPositionSettings, barSource } from './chart.js';
import { createHitBuffer, MIX_DEFAULTS, duckMusic } from './hit-audio.js';
import { resolveLoop, measureStart, measureEnd } from './loop.js';
import { GRID_DIVISIONS, MAX_SNAP_DIVISIONS } from './grid.js';
import { NOTE_TYPES, cellValue, setCellNote, longNoteSpans } from './note-model.js';
import { longHitTimes } from './long-audio.js';
import { balloonCounts, balloonIndex, setBalloonCount, replaceBarWithBalloons, replaceBarSourceWithBalloons } from './balloon.js';

export const formatTime = value => {
  const sign = value < 0 ? '-' : '';
  value = Math.abs(value);
  return `${sign}${String(Math.floor(value / 60)).padStart(2, '0')}:${(value % 60).toFixed(3).padStart(6, '0')}`;
};

export function useStudio() {
  const state = shallowReactive({ text: '', chart: null, selected: 0, course: 0, buffer: null, peaks: [], playing: false, position: 0, undo: [], redo: [], filename: 'chart.tja', dirty: false, invalid: false, selectedCell: null, commandCell: null, source: '', sourceState: '已同步', encoding: '', audioName: '未载入音频', saveState: '原文件未修改', notice: '正在准备工作台…', error: false, customLoop: null });
  const controls = reactive({ loop: true, hits: true, rate: 1, volume: MIX_DEFAULTS.music, hitVolume: MIX_DEFAULTS.hits, view: 2, snap: GRID_DIVISIONS, snapChoice: '16', customSnap: GRID_DIVISIONS });
  const bar = computed(() => state.chart?.bars[state.selected]);
  const spans = computed(() => state.chart ? longNoteSpans(state.chart.bars) : []);
  const range = computed(() => state.customLoop || [state.selected + 1, state.selected + 1]);
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
  let context, music, gain, musicDuck, hitGain, output, anchor = 0, origin = 0, loopStart = 0, loopEnd = 0, scheduledUntil = 0;
  let sourceTimer, scheduler, frame, disposed = false, audioRequest = 0, chartRequest = 0, playRequest = 0;
  const voices = new Set(), hitBuffers = new Map(), controller = new AbortController();
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
    let time = origin + (context.currentTime - anchor) * (music?.playbackRate.value || controls.rate);
    if (music?.loop && time >= loopEnd) time = loopStart + (time - loopStart) % (loopEnd - loopStart);
    return time;
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
    if (!state.buffer || !state.chart) { notice('请先载入谱面和音频。', true); return; }
    pause();
    const request = ++playRequest;
    try { await audioContext().resume(); } catch (error) { notice(`播放失败：${error.message}`, true); return; }
    if (disposed || request !== playRequest) return;
    if (controls.loop) {
      try { const result = resolveLoop(state.chart.bars, ...range.value, state.buffer.duration); loopStart = result.start; loopEnd = result.end; }
      catch (error) { notice(error.message, true); return; }
    } else { loopStart = 0; loopEnd = state.buffer.duration; }
    let position = from ?? state.position;
    if (controls.loop && (position < loopStart || position >= loopEnd)) position = loopStart;
    position = Math.max(0, Math.min(position, state.buffer.duration - .001));
    music = context.createBufferSource(); music.buffer = state.buffer; music.playbackRate.value = controls.rate; music.connect(gain);
    music.loop = controls.loop; music.loopStart = loopStart; music.loopEnd = loopEnd;
    origin = position; anchor = context.currentTime + .035; scheduledUntil = anchor; state.position = position; state.playing = true;
    music.onended = () => { if (state.playing) { pause(); state.position = state.buffer.duration; } };
    music.start(anchor, position);
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
    if (!state.playing || !controls.hits) return;
    const rate = controls.rate, until = context.currentTime + .12, from = Math.max(scheduledUntil, context.currentTime);
    const cycle = (loopEnd - loopStart) / rate;
    const bars = controls.loop ? state.chart.bars.slice(range.value[0] - 1, range.value[1]) : state.chart.bars;
    for (const item of bars) for (let index = 0; index < item.notes.length; index++) {
      const note = item.notes[index]; if (!'1234'.includes(note)) continue;
      const time = barTimeAt(item, index / item.notes.length);
      if (time < 0 || time >= state.buffer.duration || (controls.loop && (time < loopStart || time >= loopEnd))) continue;
      let when = anchor + (time - origin) / rate;
      if (controls.loop) {
        when += Math.max(0, Math.ceil((from - when) / cycle)) * cycle;
        for (; when < until; when += cycle) if (when >= from) tone(note, when);
      } else if (when >= from && when < until) tone(note, when);
    }
    for (const when of longHitTimes(spans.value, { from, until, anchor, origin, rate, start: loopStart, end: loopEnd, loop: controls.loop })) tone('1', when);
    scheduledUntil = until;
  }
  function persist() {
    try { localStorage.setItem('tja-wave-draft', JSON.stringify({ text: state.text, filename: state.filename, course: state.course, selected: state.selected })); state.saveState = '草稿已保存在此浏览器 · 原文件未修改'; }
    catch { state.saveState = '草稿存储不可用 · 请及时导出'; }
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
    if (text === state.text) { state.invalid = false; state.sourceState = '已同步'; notice('更改已同步。'); return; }
    const playing = state.playing, position = currentTime(); pause();
    state.undo = [...state.undo.slice(-149), state.text]; state.redo = [];
    state.text = text; state.chart = chart; state.dirty = true; state.invalid = false; persist();
    if (!keepSource) syncSource(); else state.sourceState = '已同步';
    notice('更改已同步。'); if (playing) void play(position);
  }
  function requireValid() { if (state.invalid) throw new Error('请先修正当前小节源码。'); }
  function select(index, seek = true) {
    if (!state.chart) return;
    guard(() => {
      requireValid(); if (!Number.isInteger(index)) throw new Error('小节编号须为整数。');
      const playing = state.playing; pause(); state.selectedCell = null; state.commandCell = null;
      state.selected = Math.max(0, Math.min(state.chart.bars.length - 1, index));
      if (seek) state.position = Math.max(0, measureStart(bar.value));
      syncSource(); if (playing) void play();
    });
  }
  function seek(time) { const playing = state.playing; pause(); state.position = Math.max(0, time); if (playing) void play(); }
  function selectCell(position) {
    if (state.invalid) return;
    pause(); state.selected = position.bar; state.selectedCell = position; state.commandCell = { ...position }; syncSource();
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
    sourceTimer = setTimeout(() => {
      try { commit(replaceBarSourceWithBalloons(state.text, state.chart, bar.value, state.source, parser), true); }
      catch (error) { state.sourceState = '格式错误'; notice(error.message, true); }
    }, 250);
  }
  function history(redo = false) {
    const from = redo ? state.redo : state.undo;
    if (!from.length) return;
    pause(); clearTimeout(sourceTimer);
    const text = from.at(-1), chart = parseChart(text, parser, state.course);
    if (redo) { state.redo = from.slice(0, -1); state.undo = [...state.undo, state.text]; }
    else { state.undo = from.slice(0, -1); state.redo = [...state.redo, state.text]; }
    state.text = text; state.chart = chart; state.invalid = false; state.dirty = true; persist(); syncSource();
  }
  function setLoop(first, last) {
    guard(() => {
      const resolved = resolveLoop(state.chart.bars, first, last, Infinity);
      const playing = state.playing; pause(); state.customLoop = [first, last]; state.position = resolved.start;
      notice(`循环范围已设为第 ${first}–${last} 小节。`); if (playing) void play();
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
      state.position = Math.max(0, measureStart(chart.bars[0])); syncSource();
    });
  }
  function loadChart(bytes, name) {
    const decoded = decodeChart(bytes), chart = parseChart(decoded.text, parser, 0);
    pause(); state.text = decoded.text; state.chart = chart; state.course = 0; state.selected = 0;
    state.selectedCell = null; state.commandCell = null; state.customLoop = null;
    state.position = Math.max(0, measureStart(chart.bars[0])); state.filename = name; state.undo = []; state.redo = [];
    state.dirty = false; state.invalid = false; state.encoding = decoded.encoding; state.saveState = '原文件未修改'; syncSource(); notice('谱面已载入。');
  }
  async function loadAudio(bytes, name) {
    const request = ++audioRequest; pause(); notice('正在解析音频波形…');
    const buffer = await audioContext().decodeAudioData(bytes);
    if (disposed || request !== audioRequest) return;
    const count = Math.min(120000, buffer.length), peaks = new Float32Array(count), step = buffer.length / count;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < count; index++) for (let sample = Math.floor(index * step); sample < Math.floor((index + 1) * step); sample++) peaks[index] = Math.max(peaks[index], Math.abs(samples[sample]));
    }
    state.buffer = buffer; state.peaks = peaks; state.audioName = name; notice('音频已就绪。');
  }
  async function tryAudio() {
    const name = state.chart.wave, request = audioRequest;
    if (!name) return;
    const response = await fetch('/media/' + encodeURIComponent(name), { signal: controller.signal });
    if (disposed || request !== audioRequest) return;
    if (response.ok) {
      const bytes = await response.arrayBuffer();
      if (!disposed && request === audioRequest) await loadAudio(bytes, name);
    }
    else notice(`未找到 ${name}，请载入对应音频。`, true);
  }
  async function openChart(file) {
    if (!file || ((state.dirty || state.invalid) && !confirm('当前有效更改已存为草稿。是否打开其他谱面？'))) return;
    const request = ++chartRequest;
    try {
      const bytes = await file.arrayBuffer(); if (disposed || request !== chartRequest) return;
      loadChart(bytes, file.name); ++audioRequest; state.buffer = null; state.peaks = []; state.audioName = '未载入音频'; await tryAudio();
    } catch (error) { if (!disposed) notice(error.message, true); }
  }
  async function openAudio(file) { if (file) try { await loadAudio(await file.arrayBuffer(), file.name); } catch (error) { if (!disposed) notice(`音频读取失败：${error.message}`, true); } }
  function restore() {
    guard(() => {
      const saved = JSON.parse(localStorage.getItem('tja-wave-draft') || 'null');
      if (!saved) throw new Error('没有本地草稿。');
      if ((state.dirty || state.invalid) && !confirm('恢复草稿会替换当前编辑内容，是否继续？')) return;
      const chart = parseChart(saved.text, parser, saved.course); pause();
      state.text = saved.text; state.chart = chart; state.course = saved.course; state.filename = saved.filename;
      state.selected = Math.max(0, Math.min(saved.selected, chart.bars.length - 1)); state.selectedCell = null; state.commandCell = null; state.customLoop = null;
      state.undo = []; state.redo = []; state.dirty = true; state.invalid = false; syncSource(); notice('已恢复草稿；请确认载入的是对应音频。');
    });
  }
  function exportChart() {
    if (!state.chart || state.invalid) { notice('请先修正小节源码后再导出。', true); return; }
    const url = URL.createObjectURL(new Blob(['\ufeff', state.text], { type: 'text/plain;charset=utf-8' })), link = document.createElement('a');
    link.href = url; link.download = state.filename.replace(/\.tja$/i, '') + ' - edited.tja'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    state.dirty = false; notice('已导出 UTF-8 谱面，原文件未修改。');
  }
  function setOffset(value) {
    guard(() => { requireValid(); if (!Number.isFinite(value)) throw new Error('偏移无效'); commit(/^OFFSET:/mi.test(state.text) ? state.text.replace(/^OFFSET:[^\r\n]*/mi, `OFFSET:${value}`) : `OFFSET:${value}\n${state.text}`); });
  }
  function setBpm(value) { guard(() => { requireValid(); commit(setBaseBpm(state.text, value)); }); }
  function setDivision(value) { guard(() => { requireValid(); commit(replaceBarWithBalloons(state.text, state.chart, bar.value, resizeNotes(bar.value.notes, value))); }); }
  function clearBar() { guard(() => { requireValid(); commit(replaceBarWithBalloons(state.text, state.chart, bar.value, '0'.repeat(bar.value.notes.length))); }); }
  function setBalloon(value) { guard(() => { requireValid(); if (state.selectedCell) commit(setBalloonCount(state.text, state.chart, state.selectedCell, value)); }); }
  async function testHits() {
    try { pause(); await audioContext().resume(); if (disposed) return; const when = context.currentTime + .04; tone('1', when); tone('2', when + .35); notice(controls.hitVolume === 0 ? '咚咔音量为 0，请调高后再次试音。' : '正在单独试听：咚、咔。'); }
    catch (error) { notice(`试音失败：${error.message}`, true); }
  }
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
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    if (event.code === 'Space') { event.preventDefault(); if (state.playing) pause(); else void play(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); history(event.shiftKey); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); exportChart(); }
    else if (/^[0-9]$/.test(event.key)) chooseNote(event.key);
    else if (event.key === 'ArrowLeft') { event.preventDefault(); select(state.selected - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); select(state.selected + 1); }
  }
  function beforeUnload(event) { if (state.dirty || state.invalid) { event.preventDefault(); event.returnValue = ''; } }
  onMounted(async () => {
    document.addEventListener('keydown', keydown); window.addEventListener('beforeunload', beforeUnload);
    scheduler = setInterval(schedule, 25); animate();
    const request = chartRequest;
    try {
      const files = await (await fetch('/api/files', { signal: controller.signal })).json(), name = files.find(file => /\.tja$/i.test(file));
      if (!name) { notice('请选择 TJA 谱面和对应音频。'); return; }
      const response = await fetch('/media/' + encodeURIComponent(name), { signal: controller.signal });
      if (!response.ok) throw new Error('谱面读取失败');
      const bytes = await response.arrayBuffer(); if (disposed || request !== chartRequest) return;
      loadChart(bytes, name); await tryAudio();
    } catch (error) { if (!disposed) notice(error.message, true); }
  });
  onUnmounted(() => {
    disposed = true; controller.abort(); clearTimeout(sourceTimer); clearInterval(scheduler); cancelAnimationFrame(frame);
    pause(); void context?.close(); document.removeEventListener('keydown', keydown); window.removeEventListener('beforeunload', beforeUnload);
  });
  return { state, controls, bar, spans, visible, stats, cell, command, range, notice, pause, play, stop, previewRange, seek, select, selectCell, setCommandPosition, applySettings, clearSettings, removeCommand, chooseNote, editSource, history, setLoop, loopCurrent, setSnap, changeCourse, openChart, openAudio, restore, exportChart, setOffset, setBpm, setDivision, clearBar, setBalloon, testHits };
}