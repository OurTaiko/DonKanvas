<script setup>
import { t } from './i18n.js';
import { computed, inject, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import { BetweenHorizontalStart, BetweenHorizontalEnd, Trash2, ChevronLeft, ChevronRight } from '@lucide/vue';
import { barTimeAt, barFractionAt } from './chart.js';
import { measureStart, measureEnd } from './loop.js';
import { GRID_DIVISIONS, SNAP_DIVISIONS } from './grid.js';
import { NOTE_TYPES, selectCell, cellValue } from './note-model.js';
import { drawLongSpan, drawNote, drawNoteSelection, noteHitRadius } from './note-render.js';
import { formatTime } from './useStudio.js';

const studio = inject('studio');
const { state, controls, bar, spans, visible, viewBeats, timelineScale, timelineBounds, cell, stats, chartStats, currentTiming, range } = studio;
const balloonHits = computed(() => {
  const { balloon, special } = chartStats.value;
  return balloon === null || special === null ? null : balloon + special;
});
const cellAttributes = computed(() => {
  const selected = cell.value, timing = currentTiming.value;
  return [
    { id: 'cell-fraction', label: '位置', value: selected ? `${selected.numerator}/${selected.denominator}` : '—' },
    { id: 'cell-time', label: '音乐时间', value: selected ? `${formatTime(selected.time)} · ${selected.time.toFixed(4)} s` : '—' },
    { id: 'cell-bpm', label: 'BPM', value: String(timing.bpm) },
    { id: 'cell-scroll', label: '卷轴倍率', value: `${timing.scroll}×` },
    { id: 'cell-meter', label: '拍号', value: `${timing.numerator}/${timing.denominator}` },
    ...(timing.gogo ? [{ id: 'cell-gogo', label: 'Go-Go 状态', value: t('开始') }] : []),
    ...(timing.delay ? [{ id: 'cell-delay', label: '延迟 / s', value: String(timing.delay) }] : []),
    ...(selected?.span ? [{ id: 'cell-long', label: '长音状态', value: `${t(NOTE_TYPES[Number(selected.span.note)].name)} · ${(selected.span.end - selected.span.start).toFixed(3)} s · ${selected.span.complete ? t('已结束') : t('缺少结束标记')}` }] : [])
  ];
});
const balloonStatus = computed(() => {
  const selected = cell.value;
  return selected && selected.ordinal >= 0 ? t('第 {p0} 个气球{p1}', { p0: selected.ordinal + 1, p1: Number.isSafeInteger(selected.count) && selected.count > 0 ? '' : t(' · 未设置次数') }) : '';
});
const timeline = ref(null), overview = ref(null), customSnap = ref(null), hover = ref(null);
const measures = ref(null), measureDrag = ref(null);
const loopSelection = computed(() => measureDrag.value?.dragged
  ? [Math.min(measureDrag.value.start, measureDrag.value.end) + 1, Math.max(measureDrag.value.start, measureDrag.value.end) + 1]
  : controls.loop ? range.value : null);
const viewport = ref(null), viewportWidth = ref(1);
const snaps = SNAP_DIVISIONS;
const zooms = [[1 / 16, '1/16'], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 2, '1/2'], [1, '1'], [2, '2'], [4, '4'], [8, '8']];
const firstBeat = computed(() => timelineScale.value.beatAt(timelineBounds.value.start));
const totalBeats = computed(() => timelineScale.value.beatAt(timelineBounds.value.end) - firstBeat.value);
const scrollBeats = computed(() => Math.max(0, totalBeats.value - viewBeats.value));
const contentWidth = computed(() => Math.max(viewportWidth.value, Math.min(16000000, totalBeats.value / viewBeats.value * viewportWidth.value)));
let observer, wheelTarget = null, programmaticLeft = null, scrollGeometry = '';
function syncScroll() {
  const element = viewport.value;
  if (!element) return;
  const maximum = element.scrollWidth - element.clientWidth;
  const left = scrollBeats.value ? (visible.value.startBeat - firstBeat.value) / scrollBeats.value * maximum : 0;
  const geometry = `${state.activeId}:${element.clientWidth}:${element.scrollWidth}`;
  if (geometry !== scrollGeometry) { scrollGeometry = geometry; programmaticLeft = left; wheelTarget = null; }
  if (Math.abs(element.scrollLeft - left) > .5) {
    programmaticLeft = left; wheelTarget = null; element.scrollTo({ left, behavior: 'instant' });
  }
}
function scrollTimeline() {
  if (!state.chart) return;
  const element = viewport.value, maximum = element.scrollWidth - element.clientWidth;
  const expected = scrollBeats.value ? (visible.value.startBeat - firstBeat.value) / scrollBeats.value * maximum : 0;
  const automatic = Math.abs(element.scrollLeft - expected) < 1 || programmaticLeft !== null && Math.abs(element.scrollLeft - programmaticLeft) < 1;
  programmaticLeft = null;
  if (wheelTarget !== null && Math.abs(element.scrollLeft - wheelTarget) < 1) wheelTarget = null;
  if (!automatic) studio.panTimeline(timelineScale.value.timeAt(firstBeat.value + (maximum ? element.scrollLeft / maximum * scrollBeats.value : 0)));
}
function scrollByPixels(delta) {
  const element = viewport.value;
  studio.panTimeline(visible.value.start); programmaticLeft = null;
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
  const deltas = { PageUp: -width, PageDown: width, Home: -viewport.value.scrollWidth, End: viewport.value.scrollWidth };
  if (!(event.key in deltas)) return;
  event.preventDefault(); event.stopPropagation(); scrollByPixels(deltas[event.key]);
}
function stopScrolling() {
  if (state.chart) studio.panTimeline(visible.value.start, false);
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
function drawWave(brush, width, start, end, center, amplitude, timeAt = fraction => start + fraction * (end - start)) {
  brush.fillStyle = '#438875';
  if (!state.buffer) { brush.fillStyle = '#929c94'; brush.font = '12px Studio, sans-serif'; brush.fillText(t('无伴奏 · 可播放谱面音符音'), 14, center); return; }
  const peaks = state.peaks;
  for (let pixel = 0; pixel < width; pixel++) {
    const low = Math.floor(timeAt(pixel / width) / state.buffer.duration * peaks.length);
    const high = Math.ceil(timeAt((pixel + 1) / width) / state.buffer.duration * peaks.length);
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
  const { bars, start, end, startBeat } = visible.value, { brush, width, height } = canvasContext(canvas);
  const scale = timelineScale.value, beats = viewBeats.value;
  const x = time => (scale.beatAt(time) - startBeat) / beats * width, noteY = height - 61;
  brush.fillStyle = '#f3f7f2'; brush.fillRect(0, 23, width, 130);
  brush.fillStyle = '#f6f7f3'; brush.fillRect(0, noteY - 30, width, 60);
  drawWave(brush, width, start, end, 88, 59, fraction => scale.timeAt(startBeat + fraction * beats));
  const eventLabelEnds = [];
  for (const item of bars) {
    let gogo = item.gogo, segmentStart = item.start;
    for (const event of [...item.events.filter(event => event.name.startsWith('GOGO')), { time: item.end, name: 'GOGOEND' }]) {
      if (gogo) { brush.fillStyle = '#e5ac3220'; brush.fillRect(x(segmentStart), noteY - 30, x(event.time) - x(segmentStart), 60); }
      segmentStart = event.time; gogo = event.name === 'GOGOSTART';
    }
    if (item.delay) {
      brush.fillStyle = '#d9a83b22'; brush.fillRect(x(measureStart(item)), 23, x(item.start) - x(measureStart(item)), height - 48);
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
      if (step === 0 && !item.barline && !item.branchStart) continue;
      const pos = x(barTimeAt(item, step / GRID_DIVISIONS));
      brush.strokeStyle = step === 0 ? item.branchStart ? '#b88a24' : '#6d9480' : step % 4 === 0 ? '#a4bcae' : '#e3e9e1'; brush.lineWidth = 1; brush.beginPath(); brush.moveTo(Math.round(pos) + .5, 23); brush.lineTo(Math.round(pos) + .5, height - 25); brush.stroke();
    }
    brush.fillStyle = '#68776e'; brush.font = '11px Studio, sans-serif'; brush.fillText(`${String(item.index + 1).padStart(3, '0')}  ${item.route || ''}${item.gogo ? ' GOGO' : ''}`, x(item.start) + 8, 15);
    for (const event of item.instructions) {
      if (event.time < start || event.time > end) continue;
      const pos = x(event.time);
      brush.strokeStyle = '#ad7e27'; brush.setLineDash([3, 3]); brush.beginPath(); brush.moveTo(pos, 23); brush.lineTo(pos, height - 25); brush.stroke(); brush.setLineDash([]);
      brush.font = '10px Studio, sans-serif';
      const label = event.name === 'SCROLL' ? `×${event.value}` : event.name.startsWith('GOGO') ? event.name === 'GOGOSTART' ? 'GOGO ON' : 'GOGO OFF' : event.value ? `${event.name} ${event.value}` : event.name;
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
function timelineCell(item, time, x) {
  const fraction = barFractionAt(item, time);
  let nearest = null, nearestDistance = Infinity;
  for (let index = 0; index < item.notes.length; index++) {
    const note = item.notes[index];
    if (note === '0') continue;
    const difference = Math.abs(x(barTimeAt(item, index / item.notes.length)) - x(time));
    if (difference <= noteHitRadius(note) && difference < nearestDistance) {
      nearest = { numerator: index, denominator: item.notes.length }; nearestDistance = difference;
    }
  }
  if (nearest) return nearest;
  let selected = selectCell(item.notes, fraction, controls.snap), distance = 8;
  const candidates = item.events.map(event => event.slot);
  for (const slot of candidates) {
    const difference = Math.abs(x(barTimeAt(item, slot / item.notes.length)) - x(time));
    if (slot < item.notes.length && difference <= distance) { selected = { numerator: slot, denominator: item.notes.length }; distance = difference; }
  }
  return selected;
}
function point(event) {
  const rect = timeline.value.getBoundingClientRect(), { startBeat, bars } = visible.value;
  const scale = timelineScale.value, beats = viewBeats.value;
  const time = scale.timeAt(startBeat + Math.max(0, Math.min(.999999, (event.clientX - rect.left) / rect.width)) * beats);
  const x = value => (scale.beatAt(value) - startBeat) / beats * rect.width;
  let item = bars.findLast(item => time >= measureStart(item) && time < measureEnd(item)), distance = Infinity;
  for (const candidate of bars) for (let index = 0; index < candidate.notes.length; index++) {
    const note = candidate.notes[index];
    if (note === '0') continue;
    const difference = Math.abs(x(barTimeAt(candidate, index / candidate.notes.length)) - x(time));
    if (difference <= noteHitRadius(note) && difference < distance) { item = candidate; distance = difference; }
  }
  return { rect, time, item, x };
}
function pointerMove(event) {
  if (!state.chart || state.invalid) return;
  const { rect, time, item, x } = point(event);
  if (event.clientY - rect.top < rect.height - 100 || !item) { hover.value = null; return; }
  const selected = timelineCell(item, time, x);
  hover.value = { bar: item.index, fraction: selected.numerator / selected.denominator };
}
function pointerDown(event) {
  if (!state.chart || state.invalid) return;
  const { rect, time, item, x } = point(event);
  if (event.clientY - rect.top < rect.height - 100) { studio.seek(time); return; }
  if (item) {
    event.preventDefault(); viewport.value.focus({ preventScroll: true });
    studio.selectCell({ bar: item.index, divisions: controls.snap, ...timelineCell(item, time, x) });
  }
}
function overviewClick(event) {
  if (!state.chart) return;
  const rect = overview.value.getBoundingClientRect(), bounds = timelineBounds.value;
  const time = bounds.start + (event.clientX - rect.left) / rect.width * Math.max(.001, bounds.end - bounds.start);
  const containing = state.chart.bars.findLastIndex(item => time >= measureStart(item) && time < measureEnd(item));
  studio.select(Math.max(0, containing >= 0 ? containing : state.chart.bars.findLastIndex(item => measureStart(item) <= time)));
}
let suppressMeasureClick = false;
function measureAt(event) {
  const button = document.elementFromPoint(event.clientX, event.clientY)?.closest('button[data-measure-index]');
  return button && measures.value?.contains(button) ? Number(button.dataset.measureIndex) : null;
}
function startMeasureLoop(event) {
  if (!event.isPrimary || event.button !== 0 || measureDrag.value || !state.chart || state.invalid) return;
  suppressMeasureClick = false;
  const index = measureAt(event);
  if (index === null) return;
  const capture = event.target.closest('button[data-measure-index]');
  measureDrag.value = { pointerId: event.pointerId, start: index, end: index, x: event.clientX, y: event.clientY, dragged: false, capture };
  capture.setPointerCapture(event.pointerId);
}
function moveMeasureLoop(event) {
  const drag = measureDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const index = measureAt(event);
  if (index !== null) drag.end = index;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 5) drag.dragged = true;
}
function cancelMeasureLoop(event) {
  const drag = measureDrag.value;
  if (!drag || event && event.pointerId !== drag.pointerId) return;
  suppressMeasureClick = drag.dragged;
  measureDrag.value = null;
  if (drag.capture.hasPointerCapture(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId);
}
function finishMeasureLoop(event) {
  const drag = measureDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  moveMeasureLoop(event);
  cancelMeasureLoop();
  if (drag.dragged) studio.setLoop(Math.min(drag.start, drag.end) + 1, Math.max(drag.start, drag.end) + 1, true);
}
function measureLoopKeydown(event) {
  if (event.key !== 'Escape' || !measureDrag.value) return;
  event.preventDefault(); event.stopPropagation(); cancelMeasureLoop();
}
function measureLoopClick(event) {
  if (suppressMeasureClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
  suppressMeasureClick = false;
}
watch(() => [state.activeId, state.chart, state.invalid], () => cancelMeasureLoop(), { flush: 'sync' });
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
  const resize = () => { if (viewport.value) { viewportWidth.value = viewport.value.clientWidth; draw(); } };
  observer = new ResizeObserver(resize); observer.observe(viewport.value); observer.observe(overview.value.parentElement); resize();
});
onUnmounted(() => { cancelMeasureLoop(); observer?.disconnect(); });
</script>

<template>
  <section class="overview"><div class="section-label"><span>{{ t('全曲总览') }}</span><span id="overview-range">{{ visible ? `${formatTime(visible.start)} — ${formatTime(visible.end)}` : '' }}</span></div><canvas id="overview" ref="overview" :aria-label="t('全曲波形，点击跳转')" role="img" @click="overviewClick"></canvas></section>
  <div class="workspace">
    <section class="editor">
      <div class="editor-bar"><div class="measure-nav">
        <label for="bar-number">{{ t('小节') }}</label>
        <button id="bar-prev" class="icon" :title="t('上一小节')" :aria-label="t('上一小节')" :disabled="!bar || state.invalid" @click="studio.select(state.selected - 1)"><ChevronLeft /></button>
        <input id="bar-number" type="number" min="1" :max="state.chart?.bars.length" :value="state.selected + 1" :disabled="!bar || state.invalid" @change="studio.select(Number($event.target.value) - 1); $event.target.value = state.selected + 1">
        <button id="bar-next" class="icon" :title="t('下一小节')" :aria-label="t('下一小节')" :disabled="!bar || state.invalid" @click="studio.select(state.selected + 1)"><ChevronRight /></button>
      </div><div class="editor-actions">
        <div class="measure-actions" role="group" :aria-label="t('插入小节')">
          <button id="insert-bar-before" :title="t('在当前小节前插入空白小节')" :disabled="!bar || state.invalid" @click="studio.insertBar('before')"><BetweenHorizontalStart aria-hidden="true" />{{ t('前插小节') }}</button>
          <button id="insert-bar-after" :title="t('在当前小节后插入空白小节')" :disabled="!bar || state.invalid" @click="studio.insertBar('after')"><BetweenHorizontalEnd aria-hidden="true" />{{ t('后插小节') }}</button>
        </div>
        <button id="delete-bar" class="delete-measure" :title="state.chart.bars.length <= 1 ? t('不能删除最后一个小节。') : t('删除当前小节及其音符和指令')" :disabled="!bar || state.invalid || state.chart.bars.length <= 1" @click="studio.deleteBar"><Trash2 aria-hidden="true" />{{ t('删除小节') }}</button>
      </div></div>
      <div class="lane-head editor-tools">
        <label>{{ t('吸附细分') }}<select id="snap-division" v-model="controls.snapChoice" @change="snapChange"><option v-for="value in snaps" :key="value" :value="String(value)">{{ value }} {{ t('分') }}</option><option value="custom">{{ t('自定义') }}</option></select></label>
        <label v-show="controls.snapChoice === 'custom'" id="custom-snap-label">{{ t('每小节等分') }}<input id="custom-snap" ref="customSnap" v-model.number="controls.customSnap" type="number" min="1" max="768" step="1" @change="studio.setSnap(Number(controls.customSnap))"></label>
        <label :title="t('以 4/4 小节的拍数作为缩放参考')">{{ t('缩放') }}<select id="view" v-model.number="controls.view" :aria-label="t('时间轴缩放')"><option v-for="[value, label] in zooms" :key="value" :value="value">{{ label }} {{ t('小节宽') }}</option></select></label>
        <label class="follow-control"><input id="follow-playback" v-model="state.followPlayback" type="checkbox">{{ t('跟随播放') }}</label>
      </div>
      <div ref="viewport" class="timeline-wrap" tabindex="0" role="region" :aria-label="t('连续谱面时间轴，可用滚轮左右滚动')" @scroll="scrollTimeline" @wheel="wheelTimeline" @keydown="keydownTimeline" @pointerdown.capture="stopScrolling"><div class="timeline-content" :style="{ width: `${contentWidth}px` }"><canvas id="timeline" ref="timeline" role="img" :aria-label="t('音乐波形与可编辑音符网格')" @pointermove="pointerMove" @pointerleave="hover = null" @pointerdown="pointerDown" @contextmenu.prevent></canvas></div></div>
      <section class="cell-inspector" :aria-label="t('音符编辑')">
        <dl>
          <div v-for="attribute in cellAttributes" :key="attribute.id"><dt>{{ t(attribute.label) }}</dt><dd :id="attribute.id" :title="attribute.value">{{ attribute.value }}</dd></div>
          <div class="balloon-control" :class="{ 'is-inactive': !cell || cell.ordinal < 0 }">
            <dt><label for="balloon-count">{{ t('气球敲击次数') }}</label></dt>
            <dd><input id="balloon-count" type="number" min="1" step="1" :aria-label="t('气球敲击次数')" aria-describedby="balloon-count-state" :title="balloonStatus" :value="Number.isSafeInteger(cell?.count) && cell.count > 0 ? cell.count : ''" :placeholder="t('未设置')" :disabled="!cell || cell.ordinal < 0 || state.invalid" @change="studio.setBalloon(Number($event.target.value))"><output id="balloon-count-state">{{ balloonStatus }}</output></dd>
          </div>
        </dl>
        <div class="measure-info">
          <span v-if="state.playing && currentTiming.bar.index !== state.selected">{{ t('播放小节 {p0}', { p0: String(currentTiming.bar.index + 1).padStart(3, '0') }) }}</span>
          <span id="note-count">{{ t('音符数：{p0}', { p0: stats.total }) }}</span>
          <span id="bar-grid">{{ t('主网格') }} {{ GRID_DIVISIONS }} {{ t('格') }}</span>
          <span id="bar-snap">{{ t('吸附细分') }} {{ t('{p0} 等分', { p0: controls.snap }) }}</span>
          <span id="bar-slots">{{ t('源码格数') }} {{ bar?.notes.length || 0 }} {{ t('格') }}</span>
        </div>
      </section>
    </section>
  </div>
  <section class="measure-section">
    <div class="measure-heading"><div class="section-label"><span>{{ t('全局导航') }}</span><span id="total-notes">{{ t('音符数：{p0}', { p0: stats.all }) }}</span></div><output v-if="state.loopAnchor !== null" id="measure-loop-anchor">{{ t('已标记第 {p0} 小节，再按 F 完成循环范围，Esc 取消。', { p0: state.loopAnchor + 1 }) }}</output></div>
    <div class="chart-statistics" :aria-label="t('谱面统计')">
      <span class="bar-count"><b id="bar-count">{{ state.chart.bars.length }}</b> {{ t('小节') }}</span>
      <span>{{ t('咚') }} <b id="chart-don-count">{{ chartStats.don }}</b></span>
      <span>{{ t('咔') }} <b id="chart-ka-count">{{ chartStats.ka }}</b></span>
      <span>{{ t('连打') }} <b id="chart-roll-seconds">{{ chartStats.rollSeconds.toFixed(3) }}</b> s</span>
      <span>{{ t('气球 / 特殊连打') }} <b id="chart-balloon-hits">{{ balloonHits ?? t('未完整设置') }}</b></span>
    </div>
    <div id="measures" ref="measures" :class="{ dragging: measureDrag?.dragged }" @pointerdown="startMeasureLoop" @pointermove="moveMeasureLoop" @pointerup="finishMeasureLoop" @pointercancel="cancelMeasureLoop" @lostpointercapture="cancelMeasureLoop" @keydown="measureLoopKeydown" @click.capture="measureLoopClick"><button v-for="item in state.chart?.bars || []" :key="item.index" :data-measure-index="item.index" :class="{ active: item.index === state.selected, gogo: item.gogo, 'loop-anchor': item.index === state.loopAnchor, 'in-loop': loopSelection && item.index + 1 >= loopSelection[0] && item.index + 1 <= loopSelection[1], 'loop-preview': measureDrag?.dragged && item.index + 1 >= loopSelection[0] && item.index + 1 <= loopSelection[1] }" :aria-label="t('小节 {p0}', { p0: item.index + 1 })" :aria-pressed="item.index === state.selected" @click="studio.select(item.index)"><span>{{ String(item.index + 1).padStart(3, '0') }}</span><span class="mini-notes"><i v-for="(note, index) in [...item.notes].filter(note => note !== '0').slice(0, 10)" :key="index" :class="{ blue: '24B'.includes(note) }"></i></span></button></div>
  </section>
</template>

<style>
.timeline-wrap{height:auto;padding:0;overscroll-behavior-x:contain}
#measures{user-select:none;touch-action:pan-y}#measures.dragging,#measures.dragging button{cursor:crosshair}#measures button.loop-preview{outline:1px solid var(--green);outline-offset:-1px}
#measure-loop-anchor{font-size:11px;color:var(--green);font-variant-numeric:tabular-nums}#measures button.loop-anchor{outline:2px dashed var(--green);outline-offset:-2px}
.measure-nav{display:flex;align-items:center;gap:6px;min-width:0}.measure-nav label{display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap}.measure-nav input{width:64px;min-width:0;min-height:30px;padding:4px 6px}.measure-nav>.icon{width:30px;min-width:30px;min-height:30px;padding:5px}
.chart-statistics{display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;min-width:0;margin-top:10px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}.chart-statistics>span{white-space:nowrap}.chart-statistics b{font-weight:500;color:var(--ink)}
.measure-info{display:flex;flex-wrap:wrap;align-items:center;gap:4px 16px;min-height:24px;margin-bottom:4px;color:var(--muted);font-size:11px}.measure-info>span{white-space:nowrap}
.measure-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.measure-heading>.section-label{display:flex;gap:12px;min-width:0}.measure-actions{display:inline-flex;max-width:100%;margin-right:6px;border:1px solid var(--line);border-radius:5px;background:#fff}.measure-actions button{min-width:0;min-height:28px;padding:4px 8px;gap:4px;border:0;border-radius:0;font-size:11px}.measure-actions button:first-child{border-radius:4px 0 0 4px}.measure-actions button:last-child{border-left:1px solid var(--line);border-radius:0 4px 4px 0}.measure-actions button svg{width:14px;height:14px}
.timeline-content{min-width:100%}
#timeline{position:sticky;left:0}
.editor-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}
.editor-bar,.lane-head.editor-tools{background:var(--paper)}
.lane-head.editor-tools{justify-content:flex-start;padding:8px 20px;border-bottom:1px solid var(--line)}
.editor-actions .delete-measure{min-height:30px;padding:4px 8px;gap:4px;font-size:11px}.delete-measure svg{width:14px;height:14px}.delete-measure:hover:not(:disabled){color:#bd352b;border-color:#bd352b;background:#fff2ef}
.editor-tools .follow-control{margin-left:auto;white-space:nowrap;gap:4px}
.editor-tools .follow-control input{margin:0;accent-color:var(--green)}
.editor-tools label{white-space:nowrap}
.editor-tools #custom-snap{width:64px;min-width:0;padding:5px;font-size:11px}
.choice-symbol.duet{position:relative}.choice-symbol.duet::after{content:'2P';position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:bold 8px sans-serif}
.editor-bar,.editor-tools{flex-wrap:wrap}
</style>