<script setup>
import { t } from './i18n.js';
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import { BetweenHorizontalStart, BetweenHorizontalEnd, Trash2, Undo2, Redo2, X, Grid2X2, Map, TriangleAlert, Ellipsis, Check, ChevronRight, ZoomIn, Crosshair, Maximize2, Ruler, ChevronsLeft, ChevronsRight } from '@lucide/vue';
import SectionHeading from './SectionHeading.vue';
import BranchControls from './BranchControls.vue';
import MeasureGrid from './MeasureGrid.vue';
import { barTimeAt, barFractionAt, BRANCH_ROUTES, BRANCH_ROUTE_NAMES } from './chart.js';
import { measureStart, measureEnd } from './loop.js';
import { SNAP_DIVISIONS } from './grid.js';
import { NOTE_TYPES, selectCell, cellValue } from './note-model.js';
import { drawLongSpan, drawNote, drawNoteSelection, noteHitRadius } from './note-render.js';
import { createTimelineViewport, TIMELINE_GUTTER } from './timeline.js';
import { formatTime } from './useStudio.js';

const studio = inject('studio');
defineProps({ mobile: Boolean });
const toolbar = ref(null), toolsMenu = ref(null), compactTools = ref(true), toolsOpen = ref(false);
const zoomMenu = ref(null), zoomOptions = ref(null), zoomOpen = ref(false), zoomPosition = ref({});
const zoomChoices = computed(() => [{ value: 'auto', label: t('自动'), icon: Maximize2 }, ...zooms.map(([value, label]) => ({ value, label: `${label} ${t('小节宽')}`, icon: Ruler }))]);
async function openZoom() {
  zoomOpen.value = !zoomOpen.value;
  if (!zoomOpen.value) return;
  const rect = zoomMenu.value.querySelector('summary').getBoundingClientRect();
  const width = Math.min(180, innerWidth - 16), height = Math.min(300, innerHeight - 16);
  const left = rect.left >= width + 8 ? rect.left - width : Math.min(rect.right, innerWidth - width - 8);
  zoomPosition.value = { left: `${Math.max(8, left)}px`, top: `${Math.max(8, Math.min(rect.top, innerHeight - height - 8))}px`, width: `${width}px`, maxHeight: `${height}px` };
  await nextTick();
  zoomOptions.value?.querySelector('[aria-checked="true"]')?.focus();
}
function closeZoom() {
  zoomOpen.value = false;
  zoomMenu.value?.querySelector('summary').focus();
}
function zoomKeydown(event) {
  if (['Escape', 'ArrowLeft'].includes(event.key)) {
    event.preventDefault(); event.stopPropagation(); closeZoom();
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); event.stopPropagation();
    const items = [...zoomOptions.value.querySelectorAll('[role="menuitemradio"]')];
    const current = items.indexOf(document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index].focus();
  }
}
watch([toolsOpen, compactTools], () => { zoomOpen.value = false; });
function dismissTools(event) {
  if (!compactTools.value || !toolsMenu.value?.open) return;
  if (event.type === 'keydown') {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation();
    toolsMenu.value.querySelector('summary').focus();
  } else if (toolsMenu.value.contains(event.target) || zoomOptions.value?.contains(event.target)) return;
  toolsOpen.value = false;
}
const { state, controls, bar, spans, visible, viewBeats, timelineScale, timelineBounds, timelineScrollBounds, cell, command, stats, chartStats, selectedTiming, range } = studio;
const balloonHits = computed(() => {
  const { balloon, special } = chartStats.value;
  return balloon === null || special === null ? null : balloon + special;
});
const positionSummary = computed(() => {
  const timing = selectedTiming.value;
  if (!timing) return null;
  const position = cell.value ?? command.value;
  return {
    measure: timing.bar.index + 1,
    fraction: `${position.numerator}/${position.denominator}`,
    time: position.time
  };
});
const cellAttributes = computed(() => {
  const selected = cell.value, timing = selectedTiming.value;
  return [
    { id: 'cell-bpm', label: 'BPM', value: String(timing.bpm) },
    { id: 'cell-scroll', label: '卷轴倍率', value: `${timing.scroll}×` },
    { id: 'cell-meter', label: '拍号', value: `${timing.numerator}/${timing.denominator}` },
    { id: 'cell-gogo', label: 'GOGOTIME', value: t(timing.gogo ? '是' : '否') },
    { id: 'cell-delay', label: '延迟 / s', value: String(timing.delay) },
    ...(selected?.span ? [{ id: 'cell-long', label: '长音状态', value: `${t(NOTE_TYPES[Number(selected.span.note)].name)} · ${(selected.span.end - selected.span.start).toFixed(3)} s`, warning: selected.span.complete ? null : t('缺少结束标记') }] : [])
  ];
});
const timeline = ref(null), overview = ref(null), customSnap = ref(null), hover = ref(null);
const overviewHover = ref(null);
const overviewSelection = computed(() => {
  if (!cell.value) return null;
  const { start, end } = timelineBounds.value;
  return (cell.value.time - start) / Math.max(.001, end - start) * 100;
});
const measurePreview = ref(null);
function measureSelected(index) {
  const selected = measurePreview.value ?? range.value;
  return Boolean(selected && index + 1 >= selected[0] && index + 1 <= selected[1]);
}
function toggleMeasure(index) {
  if (range.value && index + 1 >= range.value[0] && index + 1 <= range.value[1]) studio.clearLoop();
  else studio.setLoop(index + 1, index + 1);
}
const viewport = ref(null), viewportWidth = studio.timelineWidth;
const snaps = SNAP_DIVISIONS;
const zooms = [[1 / 2, '1/2'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [6, '6'], [8, '8']];
const firstBeat = computed(() => timelineScale.value.beatAt(timelineScrollBounds.value.start));
const totalBeats = computed(() => timelineScale.value.beatAt(timelineScrollBounds.value.end) - firstBeat.value);
const scrollBeats = computed(() => Math.max(0, totalBeats.value - viewBeats.value));
const contentWidth = computed(() => Math.max(viewportWidth.value, Math.min(16000000, totalBeats.value / viewBeats.value * viewportWidth.value)) + TIMELINE_GUTTER * 2);
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
  const element = viewport.value;
  if (!state.chart || !element) return;
  const maximum = element.scrollWidth - element.clientWidth;
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
  const drawingHeight = canvas === timeline.value ? Math.max(150, height) : height;
  const brush = canvas.getContext('2d'); brush.setTransform(ratio, 0, 0, ratio * height / drawingHeight, 0, 0); brush.clearRect(0, 0, width, drawingHeight);
  return { brush, width, height: drawingHeight };
}
function drawWave(brush, width, start, end, center, amplitude, timeAt = fraction => start + fraction * (end - start), color = '#9fc5b8') {
  brush.fillStyle = color;
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
function gogoIntervals(item) {
  const intervals = [];
  let gogo = item.gogo, start = item.start;
  for (const event of [...item.events.filter(event => event.name.startsWith('GOGO')), { time: item.end, name: 'GOGOEND' }]) {
    if (gogo) intervals.push([start, event.time]);
    start = event.time; gogo = event.name === 'GOGOSTART';
  }
  return intervals;
}
function branchColor(route) {
  return { N: '#a3a8ae', E: '#459de0', M: '#e45b99' }[route];
}
function drawOverviewSections(brush, x, height) {
  for (const item of state.chart.bars) {
    brush.fillStyle = '#f46b32';
    for (const [start, end] of gogoIntervals(item)) brush.fillRect(x(start), 0, x(end) - x(start), 3);
    if (item.route) {
      brush.fillStyle = branchColor(item.route);
      brush.fillRect(x(measureStart(item)), height - 3, x(measureEnd(item)) - x(measureStart(item)), 3);
    }
  }
}
function drawOverviewRange(brush, x, height) {
  const selected = state.chart.bars.filter(item => measureSelected(item.index));
  if (!selected.length) return;
  const left = x(Math.min(...selected.map(measureStart))), right = x(Math.max(...selected.map(measureEnd)));
  const width = right - left, edge = Math.min(2, width / 2);
  brush.fillStyle = '#2457d640'; brush.fillRect(left, 0, width, height);
  brush.fillStyle = '#7b91bb';
  brush.fillRect(left, 0, edge, height); brush.fillRect(right - edge, 0, edge, height);
}
function draw() {
  if (!timeline.value || !overview.value) return;
  if (!state.chart) { canvasContext(timeline.value); canvasContext(overview.value); return; }
  const canvas = timeline.value;
  canvas.style.width = `${viewportWidth.value + TIMELINE_GUTTER * 2}px`;
  syncScroll();
  const { bars, start, end } = visible.value, { brush, height } = canvasContext(canvas);
  const scale = timelineScale.value, beats = viewBeats.value, width = viewportWidth.value;
  const { x, timeAt } = createTimelineViewport(scale, visible.value, beats, width), noteY = height - 61;
  const noteLaneHeight = height - 25 - (noteY - 30);
  const waveformHeight = Math.max(0, height - 120);
  brush.fillStyle = '#f3f7f2'; brush.fillRect(TIMELINE_GUTTER, 23, width, waveformHeight);
  brush.fillStyle = '#f6f7f3'; brush.fillRect(TIMELINE_GUTTER, noteY - 30, width, noteLaneHeight);
  const waveformWidth = width + TIMELINE_GUTTER * 2;
  brush.save();
  if (!state.buffer) brush.translate(TIMELINE_GUTTER, 0);
  drawWave(brush, waveformWidth, timeAt(0), timeAt(waveformWidth), 23 + waveformHeight / 2, Math.max(0, waveformHeight / 2 - 6), fraction => timeAt(fraction * waveformWidth), '#72a592');
  brush.restore();
  const eventLabelEnds = [];
  for (const item of bars) {
    brush.fillStyle = '#f46b3220';
    for (const [start, end] of gogoIntervals(item)) brush.fillRect(x(start), noteY - 30, x(end) - x(start), noteLaneHeight);
    if (item.delay) {
      brush.fillStyle = '#d9a83b22'; brush.fillRect(x(measureStart(item)), 23, x(item.start) - x(measureStart(item)), height - 48);
    }
    for (const event of item.events.filter(event => event.name === 'DELAY')) { brush.fillStyle = '#d9a83b22'; brush.fillRect(x(event.time), 23, x(event.endTime) - x(event.time), height - 48); }
    if (item.index === state.selected) { brush.fillStyle = '#16745b08'; brush.fillRect(x(measureStart(item)), 0, x(measureEnd(item)) - x(measureStart(item)), height); }
    if (measureSelected(item.index)) { brush.fillStyle = '#16745b'; brush.fillRect(x(measureStart(item)), 20, x(measureEnd(item)) - x(measureStart(item)), 3); }
    const guideDivisions = item.numerator;
    brush.strokeStyle = '#b7cbd0'; brush.lineWidth = 1; brush.setLineDash([2, 3]);
    for (let step = 1; step < controls.snap; step++) {
      if (step * guideDivisions % controls.snap === 0) continue;
      const pos = x(barTimeAt(item, step / controls.snap));
      brush.beginPath(); brush.moveTo(Math.round(pos) + .5, 23); brush.lineTo(Math.round(pos) + .5, height - 25); brush.stroke();
    }
    brush.setLineDash([]);
    for (let step = 0; step < guideDivisions; step++) {
      if (step === 0 && !item.barline && !item.branchStart) continue;
      const pos = x(barTimeAt(item, step / guideDivisions));
      brush.strokeStyle = step === 0 ? item.branchStart ? '#b88a24' : '#6d9480' : '#a4bcae'; brush.lineWidth = 1; brush.beginPath(); brush.moveTo(Math.round(pos) + .5, 23); brush.lineTo(Math.round(pos) + .5, height - 25); brush.stroke();
    }
    brush.fillStyle = '#68776e'; brush.font = '11px Studio, sans-serif'; brush.fillText(`${String(item.index + 1).padStart(3, '0')}  ${item.route || ''}${item.gogo ? ' GOGO' : ''}`, x(item.start) + 8, 15);
    for (const event of item.instructions) {
      if (event.time < start || event.time > end) continue;
      const pos = x(event.time);
      brush.strokeStyle = '#ad7e27'; brush.setLineDash([3, 3]); brush.beginPath(); brush.moveTo(pos, 23); brush.lineTo(pos, height - 25); brush.stroke(); brush.setLineDash([]);
      brush.font = '10px Studio, sans-serif';
      const label = event.name === 'SCROLL' ? `×${event.value}` : event.name.startsWith('GOGO') ? event.name === 'GOGOSTART' ? 'GOGO ON' : 'GOGO OFF' : event.value ? `${event.name} ${event.value}` : event.name;
      const labelWidth = brush.measureText(label).width, left = Math.max(TIMELINE_GUTTER + 3, Math.min(pos + 3, TIMELINE_GUTTER + width - labelWidth - 3));
      let row = 0;
      while (row < 6 && (eventLabelEnds[row] ?? -Infinity) > left - 6) row++;
      if (row < 6) {
        eventLabelEnds[row] = left + labelWidth; brush.fillStyle = '#fffffff0'; brush.fillRect(left - 2, 26 + row * 14, labelWidth + 4, 13);
        brush.fillStyle = '#926b14'; brush.fillText(label, left, 36 + row * 14);
      }
    }
    for (let beat = 0; beat < item.numerator; beat++) { const pos = x(barTimeAt(item, beat / item.numerator)); brush.fillStyle = '#859087'; brush.font = '9px Studio, sans-serif'; brush.fillText(String(beat + 1), pos + 4, height - 7); }
  }
  brush.strokeStyle = '#b7c8bc'; brush.lineWidth = 1; brush.beginPath(); brush.moveTo(TIMELINE_GUTTER, noteY); brush.lineTo(TIMELINE_GUTTER + width, noteY); brush.stroke();
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
  if (position >= start && position <= end) { brush.fillStyle = '#c43e35'; brush.fillRect(x(position), 23, 1.5, height - 48); brush.beginPath(); brush.moveTo(x(position) - 4, 20); brush.lineTo(x(position) + 4, 20); brush.lineTo(x(position), 26); brush.fill(); }
  brush.fillStyle = '#b8b8b880';
  brush.fillRect(0, 23, TIMELINE_GUTTER, height - 48);
  brush.fillRect(TIMELINE_GUTTER + width, 23, TIMELINE_GUTTER, height - 48);
  const overviewContext = canvasContext(overview.value), bounds = timelineBounds.value, total = Math.max(.001, bounds.end - bounds.start);
  const overviewX = time => (time - bounds.start) / total * overviewContext.width;
  drawWave(overviewContext.brush, overviewContext.width, bounds.start, bounds.end, overviewContext.height / 2, overviewContext.height * .44);
  overviewContext.brush.fillStyle = '#16745b18'; overviewContext.brush.fillRect(overviewX(start), 0, (end - start) / total * overviewContext.width, overviewContext.height);
  overviewContext.brush.strokeStyle = '#16745b'; overviewContext.brush.strokeRect(overviewX(start), .5, (end - start) / total * overviewContext.width, overviewContext.height - 1);
  drawOverviewRange(overviewContext.brush, overviewX, overviewContext.height);
  drawOverviewSections(overviewContext.brush, overviewX, overviewContext.height);
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
const touchGuide = ref(false);
let touchGesture = null;
function cancelTouchSelection() {
  const gesture = touchGesture;
  touchGesture = null; touchGuide.value = false;
  if (!gesture) return;
  clearTimeout(gesture.timer);
  if (gesture.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
}
function startTouchSelection(event, allowHold) {
  if (event.pointerType !== 'touch') return;
  const gesture = { pointerId: event.pointerId, target: event.currentTarget, startX: event.clientX, startY: event.clientY, lastX: event.clientX, scrollLeft: viewport.value.scrollLeft, active: false, timer: null };
  touchGesture = gesture;
  gesture.target.setPointerCapture(gesture.pointerId);
  if (allowHold) gesture.timer = setTimeout(() => {
    if (touchGesture !== gesture || state.invalid || state.editorBlocked || !state.selectedCell) return;
    gesture.active = true; touchGuide.value = true; hover.value = null;
  }, 450);
}
function moveTouchSelection(event) {
  const gesture = touchGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return false;
  if (!gesture.active) {
    gesture.lastX = event.clientX;
    const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
    if (Math.hypot(dx, dy) > 8) {
      clearTimeout(gesture.timer);
      if (Math.abs(dx) > Math.abs(dy)) viewport.value.scrollTo({ left: gesture.scrollLeft - dx, behavior: 'instant' });
    }
    return true;
  }
  event.preventDefault();
  const steps = Math.trunc((event.clientX - gesture.lastX) / 24);
  gesture.lastX += steps * 24;
  for (let step = 0; step < Math.abs(steps); step++) studio.moveCell(Math.sign(steps));
  return true;
}
function finishTouchSelection(event) {
  if (event.pointerId === touchGesture?.pointerId) cancelTouchSelection();
}
watch(() => [state.activeId, state.chart, state.invalid, state.editorBlocked], cancelTouchSelection, { flush: 'sync' });
function point(event) {
  const rect = timeline.value.getBoundingClientRect();
  const projection = createTimelineViewport(timelineScale.value, visible.value, viewBeats.value, viewportWidth.value);
  return { rect, ...projection.hitTest(event.clientX - rect.left) };
}
function pointerMove(event) {
  if (moveTouchSelection(event) || event.pointerType === 'touch') return;
  if (!state.chart || state.invalid) return;
  const { rect, time, item, x } = point(event);
  if (event.clientY - rect.top < rect.height * (1 - 100 / Math.max(150, rect.height)) || !item) { hover.value = null; return; }
  const selected = timelineCell(item, time, x);
  hover.value = { bar: item.index, fraction: selected.numerator / selected.denominator };
}
function pointerDown(event) {
  if (!state.chart || state.invalid || state.editorBlocked) return;
  if (event.pointerType === 'touch' && (event.isPrimary === false || touchGesture)) { cancelTouchSelection(); return; }
  const { rect, time, item, x } = point(event);
  if (event.clientY - rect.top < rect.height * (1 - 100 / Math.max(150, rect.height))) { studio.seek(Math.max(timelineBounds.value.start, Math.min(timelineBounds.value.end, time))); startTouchSelection(event, false); return; }
  if (item) {
    event.preventDefault(); viewport.value.focus({ preventScroll: true });
    const pixel = event.clientX - rect.left;
    studio.selectCell({ bar: item.index, divisions: controls.snap, ...timelineCell(item, time, x) }, pixel < TIMELINE_GUTTER || pixel >= TIMELINE_GUTTER + viewportWidth.value);
  }
  startTouchSelection(event, Boolean(item));
}
let overviewDrag = null;
function overviewTime(event) {
  const rect = overview.value.getBoundingClientRect(), bounds = timelineBounds.value;
  const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
  return bounds.start + fraction * Math.max(.001, bounds.end - bounds.start);
}
function hoverOverview(event) {
  const canvas = overview.value;
  if (!canvas || !state.chart || event.pointerType === 'touch') { overviewHover.value = null; return; }
  const rect = canvas.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) { overviewHover.value = null; return; }
  const time = overviewTime(event);
  const index = state.chart.bars.findLastIndex(item => time >= measureStart(item) && time < measureEnd(item));
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  overviewHover.value = { time, measure: index >= 0 ? index + 1 : null, x, y, fraction: x / Math.max(1, rect.width) };
}
function overviewClick(event) {
  if (!state.chart || state.invalid) return;
  const time = overviewTime(event);
  const containing = state.chart.bars.findLastIndex(item => time >= measureStart(item) && time < measureEnd(item));
  studio.select(Math.max(0, containing >= 0 ? containing : state.chart.bars.findLastIndex(item => measureStart(item) <= time)));
  studio.seek(time);
}
function startOverviewDrag(event) {
  if (!event.isPrimary || event.button !== 0 || overviewDrag || !state.chart || state.invalid) return;
  event.preventDefault();
  const time = overviewTime(event), view = visible.value, scale = timelineScale.value;
  const start = time >= view.start && time <= view.end ? view.start : scale.timeAt(scale.beatAt(time) - viewBeats.value / 2);
  overviewDrag = { pointerId: event.pointerId, x: event.clientX, time, start, dragged: false, capture: overview.value };
  overview.value.setPointerCapture(event.pointerId);
}
function moveOverviewDrag(event) {
  const drag = overviewDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (Math.abs(event.clientX - drag.x) >= 4) drag.dragged = true;
  if (drag.dragged) studio.panTimeline(drag.start + overviewTime(event) - drag.time);
}
function cancelOverviewDrag(event) {
  const drag = overviewDrag;
  if (!drag || event && event.pointerId !== drag.pointerId) return;
  overviewDrag = null;
  if (drag.capture.hasPointerCapture(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId);
}
function finishOverviewDrag(event) {
  const drag = overviewDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  moveOverviewDrag(event);
  cancelOverviewDrag();
  if (!drag.dragged) overviewClick(event);
}
watch(() => [state.activeId, state.chart, state.invalid], () => { cancelOverviewDrag(); overviewHover.value = null; }, { flush: 'sync' });
async function snapChange() {
  hover.value = null;
  if (controls.snapChoice !== 'custom') studio.setSnap(Number(controls.snapChoice));
  else {
    toolsOpen.value = true;
    await nextTick();
    customSnap.value?.focus();
  }
}
watchEffect(draw, { flush: 'post' });
watchEffect(() => { state.activeId; state.selected; visible.value?.start; controls.snap; hover.value = null; });
watch(() => state.playing, playing => {
  if (playing && viewport.value) { stopScrolling(); programmaticLeft = viewport.value.scrollLeft; }
}, { flush: 'sync' });
onMounted(() => {
  const resize = () => {
    zoomOpen.value = false;
    compactTools.value = toolbar.value.clientWidth < 1100;
    if (viewport.value) { viewportWidth.value = Math.max(1, viewport.value.clientWidth - TIMELINE_GUTTER * 2); draw(); }
  };
  observer = new ResizeObserver(resize); observer.observe(toolbar.value); observer.observe(viewport.value); observer.observe(overview.value.parentElement); resize();
  document.addEventListener('pointerdown', dismissTools);
  document.addEventListener('focusin', dismissTools);
});
onUnmounted(() => {
  cancelTouchSelection(); cancelOverviewDrag(); observer?.disconnect();
  document.removeEventListener('pointerdown', dismissTools);
  document.removeEventListener('focusin', dismissTools);
});
</script>

<template>
  <div class="workspace">
    <section class="editor">
      <div ref="toolbar" class="lane-head editor-tools editor-bar" :class="{ 'compact-tools': compactTools }"><div class="measure-nav">
        <label for="bar-number" :title="t('查看小节')"><span class="tool-label">{{ t('查看小节') }}</span></label>
        <input id="bar-number" type="number" min="1" :max="state.chart?.bars.length" step="1" :value="state.selected + 1" :disabled="!bar || state.invalid" @change="studio.select(Number($event.target.value) - 1); $event.target.value = state.selected + 1">
      </div>
        <label :title="t('吸附栅格')"><span class="tool-label">{{ t('吸附栅格') }}</span><select id="snap-division" v-model="controls.snapChoice" :aria-label="t('吸附栅格')" @change="snapChange"><option v-for="value in snaps" :key="value" :value="String(value)">{{ value }} {{ t('分') }}</option><option value="custom">{{ t('自定义') }}</option></select></label>
        <div class="editor-history"><button id="undo" class="icon" :aria-label="t('撤销')" :title="t('撤销（Ctrl+Z）')" :disabled="!state.undo.length" @click="studio.history()"><Undo2 /></button><button id="redo" class="icon" :aria-label="t('重做')" :title="t('重做（Ctrl+Shift+Z）')" :disabled="!state.redo.length" @click="studio.history(true)"><Redo2 /></button></div>
        <details ref="toolsMenu" class="tools-menu" :open="!compactTools || toolsOpen" @keydown="dismissTools">
        <summary :aria-label="t('更多工具')" :title="t('更多工具')" @click.prevent="toolsOpen = !toolsOpen"><Ellipsis /></summary>
        <div class="tools-panel" @scroll="zoomOpen = false">
        <label v-show="controls.snapChoice === 'custom'" id="custom-snap-label"><Grid2X2 v-if="compactTools" aria-hidden="true" /><span class="menu-item-label">{{ t('每小节等分') }}</span><input id="custom-snap" ref="customSnap" v-model.number="controls.customSnap" type="number" min="1" max="768" step="1" @change="studio.setSnap(Number(controls.customSnap))"></label>
        <details v-if="compactTools" ref="zoomMenu" class="zoom-menu" :open="zoomOpen">
          <summary :title="t('以 4/4 小节的拍数作为缩放参考')" aria-haspopup="menu" :aria-expanded="zoomOpen" @click.prevent="openZoom" @keydown.right.prevent="!zoomOpen && openZoom()" @keydown.esc="zoomOpen && zoomKeydown($event)"><ZoomIn aria-hidden="true" /><span class="menu-item-label">{{ t('缩放') }}</span><ChevronRight aria-hidden="true" /></summary>
          <Teleport to="body"><div v-if="zoomOpen" ref="zoomOptions" class="zoom-options" role="menu" :aria-label="t('时间轴缩放')" :style="zoomPosition" @keydown="zoomKeydown">
            <button v-for="choice in zoomChoices" :key="choice.value" type="button" role="menuitemradio" :aria-checked="controls.view === choice.value" @click="controls.view = choice.value; closeZoom()"><component :is="choice.icon" aria-hidden="true" />{{ choice.label }}<span class="menu-check"><Check v-if="controls.view === choice.value" aria-hidden="true" /></span></button>
          </div></Teleport>
        </details>
        <label v-else :title="t('以 4/4 小节的拍数作为缩放参考')">{{ t('缩放') }}<select id="view" v-model.number="controls.view" :aria-label="t('时间轴缩放')"><option value="auto">{{ t('自动') }}</option><option v-for="[value, label] in zooms" :key="value" :value="value">{{ label }} {{ t('小节宽') }}</option></select></label>
      <div class="editor-actions">
        <div class="measure-actions" role="group" :aria-label="t('插入小节')">
          <button id="insert-bar-before" :title="t('在当前小节前插入空白小节')" :disabled="!bar || state.invalid" @click="studio.insertBar('before')"><BetweenHorizontalStart aria-hidden="true" />{{ t('前插小节') }}</button>
          <button id="insert-bar-after" :title="t('在当前小节后插入空白小节')" :disabled="!bar || state.invalid" @click="studio.insertBar('after')"><BetweenHorizontalEnd aria-hidden="true" />{{ t('后插小节') }}</button>
        </div>
        <button id="delete-bar" class="delete-measure" :title="state.chart.bars.length <= 1 ? t('不能删除最后一个小节。') : t('删除当前小节及其音符和指令')" :disabled="!bar || state.invalid || state.chart.bars.length <= 1" @click="studio.deleteBar"><Trash2 aria-hidden="true" />{{ t('删除小节') }}</button>
      </div>
        <button v-if="compactTools" id="follow-playback" type="button" role="menuitemcheckbox" :aria-checked="state.followPlayback" @click="state.followPlayback = !state.followPlayback"><Crosshair aria-hidden="true" />{{ t('跟随播放') }}<span class="menu-check"><Check v-if="state.followPlayback" aria-hidden="true" /></span></button>
        <label v-else class="follow-control"><input id="follow-playback" v-model="state.followPlayback" type="checkbox" role="switch"><span class="switch-track" aria-hidden="true"></span>{{ t('跟随播放') }}</label>
        </div></details>
      </div>
      <div class="timeline-frame"><div ref="viewport" class="timeline-wrap" tabindex="0" role="region" :aria-label="t('连续谱面时间轴，可用滚轮左右滚动')" @scroll="scrollTimeline" @wheel="wheelTimeline" @keydown="keydownTimeline" @pointerdown.capture="stopScrolling"><div class="timeline-content" :style="{ width: `${contentWidth}px` }"><canvas id="timeline" ref="timeline" role="img" :aria-label="t('音乐波形与可编辑音符网格')" @pointermove="pointerMove" @pointerleave="hover = null" @pointerdown="pointerDown" @pointerup="finishTouchSelection" @pointercancel="finishTouchSelection" @lostpointercapture="finishTouchSelection" @contextmenu.prevent></canvas></div></div><div v-if="touchGuide" class="touch-selection-guide" role="status" :aria-label="t('左右滑动微调选择')"><ChevronsLeft aria-hidden="true" /><ChevronsRight aria-hidden="true" /></div></div>
      <section class="overview">
        <div class="overview-caption"><span class="overview-legend"><i class="gogo"></i>GOGOTIME <span v-for="route in BRANCH_ROUTES" :key="route" class="overview-route"><i :style="{ background: branchColor(route) }"></i>{{ t(BRANCH_ROUTE_NAMES[route]) }}</span></span><span id="overview-range">{{ visible ? `${formatTime(visible.start)} — ${formatTime(visible.end)}` : '' }}</span></div>
        <div class="overview-wave">
          <svg v-if="overviewSelection !== null" class="overview-selection" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" :style="{ left: `${overviewSelection}%` }"><circle cx="12" cy="12" r="7" stroke-width="1" stroke-dasharray="4 2" stroke-linecap="butt" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /></svg>
          <span v-if="overviewHover" id="overview-hover" role="tooltip" :style="{ left: `${overviewHover.x}px`, top: `${overviewHover.y}px`, transform: `translate(${-overviewHover.fraction * 100}%, calc(-100% - 12px))` }">{{ formatTime(overviewHover.time) }} · {{ t('小节 {p0}', { p0: overviewHover.measure ?? '—' }) }}</span>
          <canvas id="overview" ref="overview" :aria-label="t('全曲波形，点击跳转，拖动浏览')" :aria-describedby="range ? 'selection-summary' : undefined" role="img" @pointerenter="hoverOverview" @pointerleave="overviewHover = null" @pointerdown="startOverviewDrag" @pointermove="hoverOverview($event); moveOverviewDrag($event)" @pointerup="finishOverviewDrag" @pointercancel="cancelOverviewDrag($event); overviewHover = null" @lostpointercapture="cancelOverviewDrag"></canvas>
        </div>
      </section>
      <div class="editor-information">
      <div class="editor-information-left">
      <Teleport to="#mobile-position-panel" :disabled="!mobile" defer>
      <section class="cell-inspector" :aria-label="t('落点信息')">
        <SectionHeading class="position-caption" :icon="Grid2X2" :title="t('落点信息')">
          <span class="position-source">{{ t('所选落点') }}</span>
          <template #description>
            <div v-if="positionSummary" class="position-summary">
              <span>{{ t('小节 {p0}', { p0: positionSummary.measure }) }}</span>
              <span v-if="positionSummary.fraction" id="cell-fraction">{{ t('位置') }} {{ positionSummary.fraction }}</span>
              <span id="cell-time" :title="`${positionSummary.time.toFixed(4)} s`">{{ formatTime(positionSummary.time) }}</span>
            </div>
          </template>
        </SectionHeading>
        <dl>
          <div v-for="attribute in cellAttributes" :key="attribute.id"><dt>{{ t(attribute.label) }}</dt><dd :id="attribute.id" :title="attribute.value">{{ attribute.value }}<span v-if="attribute.warning" class="attribute-warning"><TriangleAlert aria-hidden="true" />{{ attribute.warning }}</span></dd></div>
        </dl>
      </section>
      </Teleport>
  <Teleport to="#mobile-navigation-panel" :disabled="!mobile" defer>
  <section class="measure-section">
    <div class="measure-heading">
      <SectionHeading :icon="Map" :title="t('全局导航')">
        <output v-if="range" id="selection-summary">{{ t('已选小节：{p0}–{p1}', { p0: range[0], p1: range[1] }) }}</output>
        <button v-if="range || state.loopAnchor !== null" type="button" class="clear-measure-selection" @click="studio.clearLoop"><X aria-hidden="true" />{{ t('取消选择') }}</button>
        <template #description>
          <div class="chart-statistics" :aria-label="t('谱面统计')">
            <span class="bar-count"><b id="bar-count">{{ state.chart.bars.length }}</b> {{ t('小节') }}</span>
            <span id="total-notes">{{ t('音符数：{p0}', { p0: stats.all }) }}</span>
            <span>{{ t('咚') }} <b id="chart-don-count">{{ chartStats.don }}</b></span>
            <span>{{ t('咔') }} <b id="chart-ka-count">{{ chartStats.ka }}</b></span>
            <span>{{ t('连打') }} <b id="chart-roll-seconds">{{ chartStats.rollSeconds.toFixed(3) }}</b> s</span>
            <span>{{ t('气球 / 特殊连打') }} <b id="chart-balloon-hits">{{ balloonHits ?? t('未完整设置') }}</b></span>
          </div>
        </template>
      </SectionHeading>
      <output v-if="state.loopAnchor !== null" id="measure-loop-anchor">{{ t('已标记第 {p0} 小节，再按 F 完成区间选择，Esc 取消。', { p0: state.loopAnchor + 1 }) }}</output>
    </div>
    <MeasureGrid id="measures" :key="state.activeId" :bars="state.chart?.bars || []" :selection="range" :active-index="state.selected" :anchor-index="state.loopAnchor" :note-index="state.selectedCell?.bar" :disabled="state.invalid" @activate="studio.select" @select="studio.setLoop" @toggle="toggleMeasure" @preview="measurePreview = $event" />
  </section>
  </Teleport>
      </div>
      <Teleport to="#mobile-branch-panel" :disabled="!mobile" defer><BranchControls /></Teleport>
      </div>
    </section>
  </div>
</template>

<style>
.editor-core:has(#timeline) .editor-scroll{display:flex;overflow:hidden}
.editor-core:has(#timeline) .workspace{flex:1;min-width:0;min-height:0}
.workspace>.editor{display:flex;flex-direction:column;min-height:0;overflow:hidden}
.editor>.editor-bar,.editor>.timeline-frame,.editor>.overview{flex-shrink:0}
.editor-information{display:grid;grid-template-columns:minmax(0,1fr) 420px;grid-template-rows:minmax(0,1fr);align-items:stretch;flex:1;min-height:0;overflow:hidden}
.editor-information-left{grid-column:1;grid-row:1;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
.editor-information-left>.measure-section{min-width:0}
.editor-information>section.branch-context{grid-column:2;grid-row:1;width:420px;max-width:100%;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;align-self:stretch;align-content:start;border-top:1px solid var(--line);border-left:1px solid var(--line);border-bottom:0}
@container(max-width:840px){.editor-information{grid-template-columns:minmax(0,1fr);grid-template-rows:auto;align-content:start;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}.editor-information-left{display:contents}.editor-information-left>.cell-inspector,.editor-information-left>.measure-section,.editor-information>section.branch-context{grid-column:1;grid-row:auto}.editor-information>section.branch-context{width:auto;overflow:visible;border-left:0}}
.overview-caption{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;padding:4px 6px;color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums;pointer-events:none}
.overview-caption>#overview-range{white-space:nowrap}
.overview-wave{position:relative}
.overview-selection{position:absolute;z-index:1;top:50%;width:24px;height:24px;transform:translate(-50%,-50%);color:#49638c;stroke-width:2;pointer-events:none}
.overview-legend{display:flex;align-items:center;gap:4px;white-space:nowrap}
.overview-legend i{width:10px;height:3px}.overview-legend .gogo{background:#f46b32}.overview-route{display:inline-flex;align-items:center;gap:4px;margin-left:4px}
.timeline-wrap{height:auto;padding:0;overscroll-behavior-x:contain}
.timeline-frame{position:relative;isolation:isolate}
.timeline-frame:focus-within::after{content:'';position:absolute;inset:0;z-index:1;border:2px solid var(--green);pointer-events:none}
.timeline-frame .timeline-wrap:focus{outline:none}
#measure-loop-anchor{font-size:11px;color:var(--green);font-variant-numeric:tabular-nums}
#selection-summary{font-size:11px;color:var(--green)}
.clear-measure-selection{align-self:center;min-height:20px;padding:0 6px;gap:4px;border:0;background:transparent;font-size:11px}.clear-measure-selection svg{width:14px;height:14px}
.position-caption{margin-bottom:12px}.position-source{font-size:11px;color:var(--muted)}
.position-summary{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--ink);font-variant-numeric:tabular-nums}.position-summary>span{white-space:nowrap}
.measure-nav{display:flex;align-items:center;gap:6px;min-width:0}.measure-nav label{display:flex;align-items:center;gap:6px;font-size:11px;white-space:nowrap}.measure-nav input{width:64px;min-width:0;height:28px;min-height:28px;padding:4px 6px;border:1px solid var(--line);border-radius:4px;background:#fff;text-align:center;font-size:11px}
.chart-statistics{display:flex;align-items:center;gap:4px 12px;flex-wrap:wrap;min-width:0;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}.chart-statistics>span{white-space:nowrap}.chart-statistics b{font-weight:500;color:var(--ink)}
.measure-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.measure-actions{display:inline-flex;max-width:100%;margin-right:6px;border:0;border-radius:5px;background:transparent}.measure-actions button{min-width:0;padding:4px 8px;gap:4px;border:0;border-radius:4px;font-size:11px}.measure-actions button svg{width:14px;height:14px}
.timeline-content{min-width:100%}
.timeline-frame #timeline{height:250px;position:sticky;left:0;touch-action:pan-y pinch-zoom}
.touch-selection-guide{position:absolute;z-index:2;left:0;right:0;bottom:min(25px,16.666667%);height:min(66px,44%);display:flex;align-items:center;justify-content:space-between;padding:0 36px;background:#0006;color:var(--green);pointer-events:none}.touch-selection-guide>svg{width:40px;height:40px;max-height:100%;filter:drop-shadow(1px 0 0 #ccc) drop-shadow(-1px 0 0 #ccc) drop-shadow(0 1px 0 #ccc) drop-shadow(0 -1px 0 #ccc);animation:touch-selection-left .7s ease-in-out infinite alternate}.touch-selection-guide>svg:last-child{animation-name:touch-selection-right}
@keyframes touch-selection-left{to{transform:translateX(-4px)}}
@keyframes touch-selection-right{to{transform:translateX(4px)}}
@media(prefers-reduced-motion:reduce){.touch-selection-guide>svg{animation:none}}
@media(max-width:900px){.workspace>.editor{display:flex;flex-direction:column;min-height:0}.editor>.editor-bar,.editor>.overview{flex-shrink:0}.editor>.overview{padding:0}.editor>.timeline-frame{flex:0 1 186px;height:186px;min-height:0}.timeline-frame>.timeline-wrap,.timeline-frame .timeline-content,.timeline-frame #timeline{height:100%}}
.editor-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.editor-history{display:flex;align-items:center;gap:4px}.editor-history>.icon{width:28px;min-width:28px;padding:4px}.editor-history svg{width:14px;height:14px}
.editor-bar,.lane-head.editor-tools{background:var(--paper)}
.editor .editor-bar{margin-left:0;padding:4px 12px}
.lane-head.editor-tools{justify-content:flex-start;gap:6px;padding:4px 12px;border-bottom:1px solid var(--line);font:400 11px/normal system-ui,sans-serif;color:var(--muted)}
.editor-tools input[type=number],.editor-tools select{background:#fff}
.editor-tools :is(input[type=number],select,button){box-sizing:border-box;height:28px;min-height:28px;padding-block:0;line-height:normal;font-size:11px}
.editor-actions .delete-measure{padding:4px 8px;gap:4px;font-size:11px}.delete-measure svg{width:14px;height:14px}.delete-measure:hover:not(:disabled){color:#bd352b;border-color:#bd352b;background:#fff2ef}
.editor-tools .follow-control{position:relative;margin-left:auto;white-space:nowrap;gap:6px;cursor:pointer}
.editor-tools .follow-control input{position:absolute;width:1px;height:1px;margin:0;opacity:0;clip-path:inset(50%)}
.switch-track{position:relative;display:inline-block;flex-shrink:0;width:30px;height:18px;border-radius:9px;background:#929c94}
.switch-track::before{content:'';position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;background:#fff}
.follow-control input:checked+.switch-track{background:var(--green)}
.follow-control input:checked+.switch-track::before{transform:translateX(12px)}
.follow-control input:focus-visible+.switch-track{outline:2px solid var(--green);outline-offset:3px}
.editor-tools label{min-height:28px;line-height:normal;white-space:nowrap}
.editor-tools #custom-snap{width:64px;min-width:0;padding-inline:6px;font-size:11px}
.editor-tools :is(label,input,select,button,option){font:inherit}
.choice-symbol.duet{position:relative}.choice-symbol.duet::after{content:'2P';position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:bold 8px sans-serif}
.editor-bar,.editor-tools{flex-wrap:nowrap}
.tools-menu,.tools-panel{display:flex;flex:1;align-items:center;gap:6px;min-width:0}.tools-menu>summary{display:none}
.tools-menu::details-content{display:contents}
.compact-tools{position:relative}.compact-tools .tools-menu{display:block;margin-left:auto}
.compact-tools .tools-menu>summary{display:flex;align-items:center;justify-content:center;width:28px;height:28px;cursor:pointer;list-style:none;border-radius:4px}
.tools-menu>summary::-webkit-details-marker{display:none}.tools-menu>summary:focus-visible{outline:2px solid var(--green);outline-offset:-2px}
.compact-tools .tools-menu{flex:none}
.compact-tools .tools-panel{position:absolute;z-index:10;right:8px;top:100%;display:flex;flex-direction:column;align-items:stretch;gap:2px;width:280px;max-width:calc(100vw - 16px);max-height:50dvh;overflow:auto;overscroll-behavior:contain;padding:5px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);font:400 12px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px #202a2820}
.compact-tools .tools-menu:not([open])>.tools-panel{display:none}
.compact-tools .tools-panel>label{justify-content:space-between;margin-left:0;min-height:36px;padding:4px 8px;border-radius:4px}.compact-tools .editor-actions,.compact-tools .measure-actions{display:contents}.compact-tools .tools-panel button{width:100%;height:auto;min-height:36px;justify-content:flex-start;padding:7px 8px;border:0;border-radius:4px;background:transparent;text-align:left;white-space:normal}.compact-tools .tools-panel button:not(:disabled):hover,.compact-tools .tools-panel>label:hover{background:#edf5ef}.compact-tools .tools-panel .switch-track{order:1;margin-left:auto}
.zoom-menu>summary{display:flex;align-items:center;gap:8px;min-height:36px;padding:7px 8px;border-radius:4px;cursor:pointer;list-style:none}.zoom-menu>summary::-webkit-details-marker{display:none}.zoom-menu>summary:hover{background:#edf5ef}.zoom-menu>summary:focus-visible{outline:2px solid var(--green);outline-offset:-2px}
.zoom-options{position:fixed;z-index:50;overflow:auto;overscroll-behavior:contain;padding:5px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);font:400 12px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px #202a2820}.zoom-options button{width:100%;min-height:36px;justify-content:flex-start;padding:7px 8px;border:0;border-radius:4px;background:transparent;text-align:left}.zoom-options button:hover{background:#edf5ef}.menu-check{display:inline-flex;align-items:center;justify-content:center;flex:0 0 17px;width:17px;height:17px;margin-left:auto}
.compact-tools .tools-panel :is(button,label,input,summary),.zoom-options button{font:inherit;color:inherit}.compact-tools .menu-item-label{flex:1}
@container(max-width:480px){.editor .editor-bar{padding-inline:6px;gap:4px}.measure-nav{gap:4px}.measure-nav input{width:42px;padding-inline:2px}.editor-tools>label{gap:4px}.editor-tools #snap-division{width:65px;padding-inline:2px}.editor-history{gap:0}}
@container(max-width:480px){.tool-label,.measure-nav>label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}}
@media(max-width:900px){.editor-information{display:none}}
</style>