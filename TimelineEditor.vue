<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import { Undo2, Redo2 } from '@lucide/vue';
import { barTimeAt, barFractionAt } from './chart.js';
import { measureStart, measureEnd } from './loop.js';
import { GRID_DIVISIONS } from './grid.js';
import { NOTE_TYPES, selectCell, cellValue } from './note-model.js';
import { drawLongSpan, drawNote, drawNoteSelection, noteHitRadius } from './note-render.js';
import { formatTime } from './useStudio.js';

const studio = inject('studio');
const { state, controls, bar, spans, visible, viewSpan, timelineBounds, cell, stats, range } = studio;
const timeline = ref(null), overview = ref(null), customSnap = ref(null), hover = ref(null);
const viewport = ref(null), viewportWidth = ref(1);
const snaps = [4, 8, 12, 16, 24, 32, 48, 64, 96, 192];
const zooms = [[1 / 16, '1/16'], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 2, '1/2'], [1, '1'], [2, '2'], [4, '4'], [8, '8']];
const scrollTime = computed(() => Math.max(0, timelineBounds.value.end - timelineBounds.value.start - viewSpan.value));
const contentWidth = computed(() => Math.max(viewportWidth.value, Math.min(16000000, (timelineBounds.value.end - timelineBounds.value.start) / viewSpan.value * viewportWidth.value)));
let observer, wheelTarget = null, programmaticLeft = null, scrollGeometry = '';
function syncScroll() {
  const element = viewport.value, maximum = element.scrollWidth - element.clientWidth;
  const left = scrollTime.value ? (visible.value.start - timelineBounds.value.start) / scrollTime.value * maximum : 0;
  const geometry = `${state.activeId}:${element.clientWidth}:${element.scrollWidth}`;
  if (geometry !== scrollGeometry) { scrollGeometry = geometry; programmaticLeft = left; wheelTarget = null; }
  if (Math.abs(element.scrollLeft - left) > .5) {
    programmaticLeft = left; wheelTarget = null; element.scrollTo({ left, behavior: 'instant' });
  }
}
function scrollTimeline() {
  if (!state.chart) return;
  const element = viewport.value, maximum = element.scrollWidth - element.clientWidth;
  const automatic = programmaticLeft !== null && Math.abs(element.scrollLeft - programmaticLeft) < 1;
  programmaticLeft = null;
  if (wheelTarget !== null && Math.abs(element.scrollLeft - wheelTarget) < 1) wheelTarget = null;
  studio.panTimeline(timelineBounds.value.start + (maximum ? element.scrollLeft / maximum * scrollTime.value : 0), !automatic);
}
function scrollByPixels(delta) {
  const element = viewport.value;
  state.followPlayback = false; programmaticLeft = null;
  wheelTarget = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, (wheelTarget ?? element.scrollLeft) + delta));
  element.scrollTo({ left: wheelTarget, behavior: state.playing || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}
function wheelTimeline(event) {
  if (!state.chart || event.ctrlKey || event.metaKey || viewport.value.scrollWidth <= viewport.value.clientWidth) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!delta) return;
  event.preventDefault();
  scrollByPixels(delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.value.clientWidth : 1));
}
function keydownTimeline(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || !state.chart) return;
  const width = viewport.value.clientWidth;
  const deltas = { ArrowLeft: -40, ArrowRight: 40, PageUp: -width, PageDown: width, Home: -viewport.value.scrollWidth, End: viewport.value.scrollWidth };
  if (!(event.key in deltas)) return;
  event.preventDefault(); event.stopPropagation(); scrollByPixels(deltas[event.key]);
}
function stopScrolling() {
  wheelTarget = null; programmaticLeft = null;
  viewport.value.scrollTo({ left: viewport.value.scrollLeft, behavior: 'instant' });
}
function canvasContext(canvas) {
  const rectangle = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1;
  const width = Math.max(1, rectangle.width), height = Math.max(1, rectangle.height);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  const brush = canvas.getContext('2d'); brush.setTransform(ratio, 0, 0, ratio, 0, 0); brush.clearRect(0, 0, width, height);
  return { brush, width, height };
}
function drawWave(brush, width, start, end, center, amplitude) {
  brush.fillStyle = '#438875';
  if (!state.buffer) { brush.fillStyle = '#929c94'; brush.font = '12px Studio, sans-serif'; brush.fillText('无伴奏 · 可播放谱面音符音', 14, center); return; }
  const peaks = state.peaks;
  for (let pixel = 0; pixel < width; pixel++) {
    const low = Math.floor((start + pixel / width * (end - start)) / state.buffer.duration * peaks.length);
    const high = Math.ceil((start + (pixel + 1) / width * (end - start)) / state.buffer.duration * peaks.length);
    let peak = 0;
    for (let index = Math.max(0, low); index < Math.min(peaks.length, high); index++) peak = Math.max(peak, peaks[index]);
    if (peak) brush.fillRect(pixel, center - peak * amplitude, 1, Math.max(1, peak * amplitude * 2));
  }
}
function draw() {
  if (!timeline.value || !overview.value) return;
  if (!state.chart) { canvasContext(timeline.value); canvasContext(overview.value); return; }
  const canvas = timeline.value;
  canvas.style.width = `${viewportWidth.value}px`;
  syncScroll();
  const { bars, start, end } = visible.value, { brush, width, height } = canvasContext(canvas);
  const x = time => (time - start) / (end - start) * width, noteY = height - 61;
  brush.fillStyle = '#f3f7f2'; brush.fillRect(0, 23, width, 130);
  brush.fillStyle = '#f6f7f3'; brush.fillRect(0, noteY - 30, width, 60);
  drawWave(brush, width, start, end, 88, 59);
  const eventLabelEnds = [];
  for (const item of bars) {
    let gogo = item.gogo, segmentStart = item.start;
    for (const event of [...item.events.filter(event => event.name.startsWith('GOGO')), { time: item.end, name: 'GOGOEND' }]) {
      if (gogo) { brush.fillStyle = '#e5ac3220'; brush.fillRect(x(segmentStart), noteY - 30, x(event.time) - x(segmentStart), 60); }
      segmentStart = event.time; gogo = event.name === 'GOGOSTART';
    }
    if (item.delay) {
      brush.fillStyle = '#d9a83b22'; brush.fillRect(x(measureStart(item)), 23, x(item.start) - x(measureStart(item)), height - 48);
      brush.fillStyle = '#926b14'; brush.font = '10px Studio, sans-serif'; brush.fillText(`DELAY ${item.delay}s`, x(measureStart(item)) + 4, 36);
    }
    for (const event of item.events.filter(event => event.name === 'DELAY')) { brush.fillStyle = '#d9a83b22'; brush.fillRect(x(event.time), 23, x(event.endTime) - x(event.time), height - 48); }
    if (item.index === state.selected) { brush.fillStyle = '#16745b08'; brush.fillRect(x(measureStart(item)), 0, x(measureEnd(item)) - x(measureStart(item)), height); }
    brush.strokeStyle = '#b7cbd0'; brush.lineWidth = 1; brush.setLineDash([2, 3]);
    for (let step = 1; step < controls.snap; step++) {
      if (step * GRID_DIVISIONS % controls.snap === 0) continue;
      const pos = x(barTimeAt(item, step / controls.snap));
      brush.beginPath(); brush.moveTo(Math.round(pos) + .5, 23); brush.lineTo(Math.round(pos) + .5, height - 25); brush.stroke();
    }
    brush.setLineDash([]);
    for (let step = 0; step < GRID_DIVISIONS; step++) {
      const pos = x(barTimeAt(item, step / GRID_DIVISIONS));
      brush.strokeStyle = step === 0 ? '#6d9480' : step % 4 === 0 ? '#a4bcae' : '#e3e9e1'; brush.lineWidth = 1; brush.beginPath(); brush.moveTo(Math.round(pos) + .5, 23); brush.lineTo(Math.round(pos) + .5, height - 25); brush.stroke();
    }
    brush.fillStyle = '#68776e'; brush.font = '11px Studio, sans-serif'; brush.fillText(`${String(item.index + 1).padStart(3, '0')}  ${item.gogo ? 'GOGO' : ''}`, x(item.start) + 8, 15);
    for (const event of item.events) {
      if (event.time < start || event.time > end) continue;
      const pos = x(event.time);
      brush.strokeStyle = '#ad7e27'; brush.setLineDash([3, 3]); brush.beginPath(); brush.moveTo(pos, 23); brush.lineTo(pos, height - 25); brush.stroke(); brush.setLineDash([]);
      brush.font = '10px Studio, sans-serif';
      const label = event.name === 'SCROLL' ? `×${event.value}` : event.name.startsWith('GOGO') ? event.name === 'GOGOSTART' ? 'GOGO ON' : 'GOGO OFF' : `${event.name} ${event.value}`;
      const labelWidth = brush.measureText(label).width, left = Math.max(3, Math.min(pos + 3, width - labelWidth - 3));
      let row = 0;
      while (row < 6 && (eventLabelEnds[row] ?? -Infinity) > left - 6) row++;
      if (row < 6) {
        eventLabelEnds[row] = left + labelWidth; brush.fillStyle = '#fffffff0'; brush.fillRect(left - 2, 26 + row * 14, labelWidth + 4, 13);
        brush.fillStyle = '#926b14'; brush.fillText(label, left, 36 + row * 14);
      }
    }
    for (let beat = 0; beat < item.numerator; beat++) { const pos = x(barTimeAt(item, beat / item.numerator)); brush.fillStyle = '#859087'; brush.font = '9px Studio, sans-serif'; brush.fillText(String(beat + 1), pos + 4, height - 7); }
  }
  brush.strokeStyle = '#6d9480'; brush.lineWidth = 1; brush.beginPath(); brush.moveTo(width - .5, 23); brush.lineTo(width - .5, height - 25); brush.stroke();
  brush.strokeStyle = '#b7c8bc'; brush.beginPath(); brush.moveTo(0, noteY); brush.lineTo(width, noteY); brush.stroke();
  for (const span of spans.value) drawLongSpan(brush, span, x, noteY, start, end);
  for (const item of bars) for (let index = 0; index < item.notes.length; index++) {
    const note = item.notes[index]; if (note !== '0') drawNote(brush, note, x(barTimeAt(item, index / item.notes.length)), noteY);
  }
  if (state.selectedCell) {
    const selected = state.selectedCell, item = bars.find(item => item.index === selected.bar);
    if (item) drawNoteSelection(brush, cellValue(item.notes, selected), x(barTimeAt(item, selected.numerator / selected.denominator)), noteY);
  }
  if (hover.value) {
    const item = bars.find(item => item.index === hover.value.bar);
    if (item) {
      const pos = x(barTimeAt(item, hover.value.fraction));
      brush.strokeStyle = '#16745b'; brush.lineWidth = 1.5; brush.setLineDash([4, 3]); brush.beginPath(); brush.moveTo(pos, 23); brush.lineTo(pos, height - 25); brush.stroke();
      brush.setLineDash([]);
    }
  }
  const position = state.position;
  if (position >= start && position <= end) { brush.fillStyle = '#c43e35'; brush.fillRect(x(position), 20, 1.5, height - 40); brush.beginPath(); brush.moveTo(x(position) - 4, 20); brush.lineTo(x(position) + 4, 20); brush.lineTo(x(position), 26); brush.fill(); }
  const overviewContext = canvasContext(overview.value), bounds = timelineBounds.value, total = Math.max(.001, bounds.end - bounds.start);
  const overviewX = time => (time - bounds.start) / total * overviewContext.width;
  drawWave(overviewContext.brush, overviewContext.width, bounds.start, bounds.end, overviewContext.height / 2, overviewContext.height * .44);
  overviewContext.brush.fillStyle = '#16745b18'; overviewContext.brush.fillRect(overviewX(start), 0, (end - start) / total * overviewContext.width, overviewContext.height);
  overviewContext.brush.strokeStyle = '#16745b'; overviewContext.brush.strokeRect(overviewX(start), .5, (end - start) / total * overviewContext.width, overviewContext.height - 1);
  overviewContext.brush.fillStyle = '#c43e35'; overviewContext.brush.fillRect(overviewX(position), 0, 1.5, overviewContext.height);
}
function timelineCell(item, time, pixelsPerSecond) {
  const fraction = barFractionAt(item, time);
  let nearest = null, nearestDistance = Infinity;
  for (let index = 0; index < item.notes.length; index++) {
    const note = item.notes[index];
    if (note === '0') continue;
    const difference = Math.abs(barTimeAt(item, index / item.notes.length) - time) * pixelsPerSecond;
    if (difference <= noteHitRadius(note) && difference < nearestDistance) {
      nearest = { numerator: index, denominator: item.notes.length }; nearestDistance = difference;
    }
  }
  if (nearest) return nearest;
  let selected = selectCell(item.notes, fraction, controls.snap), distance = 8;
  const candidates = item.events.map(event => event.slot);
  for (const slot of candidates) {
    const difference = Math.abs(barTimeAt(item, slot / item.notes.length) - time) * pixelsPerSecond;
    if (slot < item.notes.length && difference <= distance) { selected = { numerator: slot, denominator: item.notes.length }; distance = difference; }
  }
  return selected;
}
function point(event) {
  const rect = timeline.value.getBoundingClientRect(), { start, end, bars } = visible.value;
  const time = start + Math.max(0, Math.min(.999999, (event.clientX - rect.left) / rect.width)) * (end - start);
  let item = bars.findLast(item => time >= measureStart(item) && time < measureEnd(item)), distance = Infinity;
  for (const candidate of bars) for (let index = 0; index < candidate.notes.length; index++) {
    const note = candidate.notes[index];
    if (note === '0') continue;
    const difference = Math.abs(barTimeAt(candidate, index / candidate.notes.length) - time) * rect.width / (end - start);
    if (difference <= noteHitRadius(note) && difference < distance) { item = candidate; distance = difference; }
  }
  return { rect, start, end, time, item };
}
function pointerMove(event) {
  if (!state.chart || state.invalid) return;
  const { rect, start, end, time, item } = point(event);
  if (event.clientY - rect.top < rect.height - 100 || !item) { hover.value = null; return; }
  const selected = timelineCell(item, time, rect.width / (end - start));
  hover.value = { bar: item.index, fraction: selected.numerator / selected.denominator };
}
function pointerDown(event) {
  if (!state.chart || state.invalid) return;
  const { rect, start, end, time, item } = point(event);
  if (event.clientY - rect.top < rect.height - 100) { studio.seek(time); return; }
  if (item) studio.selectCell({ bar: item.index, divisions: controls.snap, ...timelineCell(item, time, rect.width / (end - start)) });
}
function overviewClick(event) {
  if (!state.chart) return;
  const rect = overview.value.getBoundingClientRect(), bounds = timelineBounds.value;
  const time = bounds.start + (event.clientX - rect.left) / rect.width * Math.max(.001, bounds.end - bounds.start);
  const containing = state.chart.bars.findLastIndex(item => time >= measureStart(item) && time < measureEnd(item));
  studio.select(Math.max(0, containing >= 0 ? containing : state.chart.bars.findLastIndex(item => measureStart(item) <= time)));
}
function snapChange() {
  hover.value = null;
  if (controls.snapChoice !== 'custom') studio.setSnap(Number(controls.snapChoice));
  else customSnap.value?.focus();
}
watchEffect(draw, { flush: 'post' });
watchEffect(() => { state.activeId; state.selected; visible.value?.start; controls.snap; hover.value = null; });
watch(() => state.playing, playing => {
  if (playing && viewport.value) { stopScrolling(); programmaticLeft = viewport.value.scrollLeft; }
}, { flush: 'sync' });
onMounted(() => {
  const resize = () => { viewportWidth.value = viewport.value.clientWidth; draw(); };
  observer = new ResizeObserver(resize); observer.observe(viewport.value); observer.observe(overview.value.parentElement); resize();
});
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <section class="overview"><div class="section-label"><span>全曲总览</span><span id="overview-range">{{ visible ? `${formatTime(visible.start)} — ${formatTime(visible.end)}` : '' }}</span></div><canvas id="overview" ref="overview" aria-label="全曲波形，点击跳转" role="img" @click="overviewClick"></canvas></section>
  <div class="workspace">
    <section class="editor">
      <div class="editor-bar"><div class="section-label"><span id="selection">小节 {{ String(state.selected + 1).padStart(3, '0') }}</span><span id="meter">{{ bar ? `${bar.bpm} BPM · ${bar.numerator}/${bar.denominator} · SCROLL ${bar.scroll}×${bar.gogo ? ' · Go-Go' : ''}${bar.delay ? ` · DELAY ${bar.delay}s` : ''}` : '' }}</span></div><div class="editor-tools"><button id="undo" class="icon" aria-label="撤销" title="撤销（Ctrl+Z）" :disabled="!state.undo.length" @click="studio.history()"><Undo2 /></button><button id="redo" class="icon" aria-label="重做" title="重做（Ctrl+Shift+Z）" :disabled="!state.redo.length" @click="studio.history(true)"><Redo2 /></button><label class="follow-control"><input id="follow-playback" v-model="state.followPlayback" type="checkbox">跟随播放</label><label title="以基础 BPM 的 4/4 小节时长作为缩放参考">缩放<select id="view" v-model.number="controls.view" aria-label="时间轴缩放"><option v-for="[value, label] in zooms" :key="value" :value="value">{{ label }} 小节宽</option></select></label></div></div>
      <div class="snap-controls"><label>吸附细分<select id="snap-division" v-model="controls.snapChoice" @change="snapChange"><option v-for="value in snaps" :key="value" :value="String(value)">{{ value }} 分</option><option value="custom">自定义</option></select></label><label v-show="controls.snapChoice === 'custom'" id="custom-snap-label">每小节等分<input id="custom-snap" ref="customSnap" v-model.number="controls.customSnap" type="number" min="1" max="768" step="1" @change="studio.setSnap(Number(controls.customSnap))"></label><output id="snap-position">{{ hover ? `小节 ${hover.bar + 1} · ${Number((hover.fraction * controls.snap).toFixed(3))}/${controls.snap}` : `${controls.snap} 等分` }}</output></div>
      <div class="lane-head"><span>音乐波形</span><span>AMPLITUDE</span></div>
      <div ref="viewport" class="timeline-wrap" tabindex="0" role="region" aria-label="连续谱面时间轴，可用滚轮左右滚动" @scroll="scrollTimeline" @wheel="wheelTimeline" @keydown="keydownTimeline" @pointerdown.capture="stopScrolling"><div class="timeline-content" :style="{ width: `${contentWidth}px` }"><canvas id="timeline" ref="timeline" role="img" aria-label="音乐波形与可编辑音符网格" @pointermove="pointerMove" @pointerleave="hover = null" @pointerdown="pointerDown" @contextmenu.prevent></canvas></div></div>
      <section class="cell-inspector">
        <div class="cell-heading"><h3>格子信息</h3><span id="cell-current">{{ cell ? `${cell.name} · ${cell.note}` : '未选择' }}</span></div>
        <dl><div><dt>小节 / 格位</dt><dd id="cell-location">{{ cell ? `第 ${cell.bar + 1} 小节 · ${Number((cell.numerator / cell.denominator * cell.divisions + 1).toFixed(3))}/${cell.divisions} 格` : '—' }}</dd></div><div><dt>音乐时间</dt><dd id="cell-time">{{ cell ? `${formatTime(cell.time)} · ${cell.time.toFixed(4)} s` : '—' }}</dd></div><div><dt>小节内位置</dt><dd id="cell-fraction">{{ cell ? `${cell.numerator}/${cell.denominator}` : '—' }}</dd></div><div><dt>长音状态</dt><dd id="cell-long">{{ cell?.span ? `${NOTE_TYPES[Number(cell.span.note)].name} · ${(cell.span.end - cell.span.start).toFixed(3)} s · ${cell.span.complete ? '已结束' : '缺少结束标记'}` : '—' }}</dd></div></dl>
        <label v-if="cell && cell.ordinal >= 0" class="balloon-control"><span>气球敲击次数</span><input id="balloon-count" type="number" min="1" step="1" aria-label="气球敲击次数" :value="Number.isSafeInteger(cell.count) && cell.count > 0 ? cell.count : ''" placeholder="未设置" :disabled="state.invalid" @change="studio.setBalloon(Number($event.target.value))"><output id="balloon-count-state">第 {{ cell.ordinal + 1 }} 个气球{{ Number.isSafeInteger(cell.count) && cell.count > 0 ? '' : ' · 未设置次数' }}</output></label>
        <div id="palette" class="palette"><button v-for="type in NOTE_TYPES" :key="type.value" :title="`${type.name}（${type.value}）`" :aria-label="`${type.name}（${type.value}）`" :data-value="type.value" :disabled="!cell || state.invalid" :class="{ active: cell?.note === type.value }" :aria-pressed="cell?.note === type.value" @click="studio.chooseNote(type.value)"><span class="choice-symbol" :class="type.shape"></span><span class="choice-name">{{ type.name }}</span><small>{{ type.value }}</small></button></div>
      </section>
      <div class="editor-footer"><span id="note-count">{{ stats.total }} NOTES</span><span id="position-info">主网格 16 格 · 吸附 {{ controls.snap }} 等分 · 源码 {{ bar?.notes.length || 0 }} 格</span></div>
    </section>
    <slot />
  </div>
  <section class="measure-section"><div class="section-label"><span>小节导航</span><span id="total-notes">{{ stats.all }} NOTES</span></div><div id="measures"><button v-for="item in state.chart?.bars || []" :key="item.index" :class="{ active: item.index === state.selected, gogo: item.gogo, 'in-loop': controls.loop && item.index + 1 >= range[0] && item.index + 1 <= range[1] }" :aria-label="`小节 ${item.index + 1}`" :aria-pressed="item.index === state.selected" @click="studio.select(item.index)"><span>{{ String(item.index + 1).padStart(3, '0') }}</span><span class="mini-notes"><i v-for="(note, index) in [...item.notes].filter(note => note !== '0').slice(0, 10)" :key="index" :class="{ blue: '24'.includes(note) }"></i></span></button></div></section>
</template>

<style>
.timeline-wrap{height:auto;padding:0;overscroll-behavior-x:contain}
.timeline-content{min-width:100%}
#timeline{position:sticky;left:0}
.editor-tools .follow-control{white-space:nowrap;gap:4px}
.editor-tools .follow-control input{margin:0;accent-color:var(--green)}
@media(max-width:1000px){.editor-bar,.editor-tools{flex-wrap:wrap}}
</style>