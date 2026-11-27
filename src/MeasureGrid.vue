<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Plus } from '@lucide/vue';
import { t } from './i18n.js';
import { NOTE_TYPES, longNoteSpans } from './note-model.js';
import { measureStart } from './loop.js';

const props = defineProps({
  bars: { type: Array, required: true },
  selection: { type: Array, default: null },
  activeIndex: { type: Number, default: null },
  noteIndex: { type: Number, default: null },
  visibleIndices: { type: Array, default: () => [] },
  disabled: Boolean,
  appendable: Boolean,
  unavailable: { type: Function, default: () => false },
  measureTitle: { type: Function, default: null }
});
const miniNotes = computed(() => {
  const spans = longNoteSpans(props.bars);
  return new Map(props.bars.map(item => {
    const start = measureStart(item);
    const carried = spans.find(span => span.start < start && span.end > start);
    const notes = [...item.notes].filter(note => note !== '0' && note !== '8');
    if (carried) notes.unshift(carried.note);
    return [item.index, notes.slice(0, 10)];
  }));
});
const emit = defineEmits(['activate', 'select', 'toggle', 'preview', 'append']);
const measures = ref(null), measureDrag = ref(null);
const dragSelection = computed(() => measureDrag.value?.dragged
  ? [Math.min(measureDrag.value.start, measureDrag.value.end) + 1, Math.max(measureDrag.value.start, measureDrag.value.end) + 1]
  : null);
const measureSelection = computed(() => dragSelection.value ?? props.selection);
watch(dragSelection, selection => emit('preview', selection), { flush: 'sync' });
function measureSelected(index) {
  const selected = measureSelection.value;
  return Boolean(selected && index + 1 >= selected[0] && index + 1 <= selected[1]);
}
function viewMeasure(event, index) {
  if (props.disabled || props.unavailable(props.bars[index])) return;
  if (event.shiftKey) {
    const anchor = props.activeIndex ?? (props.selection ? props.selection[0] - 1 : index);
    emit('select', Math.min(anchor, index) + 1, Math.max(anchor, index) + 1);
  } else emit('activate', index);
}
let suppressMeasureClick = false;
let lastTouchTap = null, suppressDoubleClickUntil = -Infinity;
function doubleClick(event, index) {
  if (props.disabled || props.unavailable(props.bars[index]) || event.timeStamp <= suppressDoubleClickUntil) return;
  emit('toggle', index);
}
function measureAt(event) {
  const button = document.elementFromPoint(event.clientX, event.clientY)?.closest('button[data-measure-index]');
  return button && !button.disabled && measures.value?.contains(button) ? Number(button.dataset.measureIndex) : null;
}
function startDrag(event) {
  if (!event.isPrimary || event.button !== 0 || measureDrag.value || props.disabled) return;
  suppressMeasureClick = false;
  const index = measureAt(event);
  if (index === null) return;
  const capture = event.target.closest('button[data-measure-index]');
  measureDrag.value = { pointerId: event.pointerId, pointerType: event.pointerType, time: event.timeStamp, start: index, end: index, x: event.clientX, y: event.clientY, dragged: false, capture };
  capture.setPointerCapture(event.pointerId);
}
function moveDrag(event) {
  const drag = measureDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const index = measureAt(event);
  if (index !== null) drag.end = index;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 5) drag.dragged = true;
}
function cancelDrag(event) {
  const drag = measureDrag.value;
  if (!drag || event && event.pointerId !== drag.pointerId) return;
  if (event) lastTouchTap = null;
  suppressMeasureClick = drag.dragged;
  measureDrag.value = null;
  if (drag.capture.hasPointerCapture(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId);
}
function finishDrag(event) {
  const drag = measureDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  moveDrag(event);
  cancelDrag();
  if (drag.dragged) { lastTouchTap = null; emit('select', Math.min(drag.start, drag.end) + 1, Math.max(drag.start, drag.end) + 1); }
  else if (drag.pointerType === 'touch' && event.timeStamp - drag.time <= 350) {
    if (lastTouchTap && lastTouchTap.index === drag.start && event.timeStamp - lastTouchTap.time <= 350 && Math.hypot(event.clientX - lastTouchTap.x, event.clientY - lastTouchTap.y) <= 24) {
      lastTouchTap = null; suppressMeasureClick = true;
      suppressDoubleClickUntil = event.timeStamp + 500;
      emit('toggle', drag.start);
    } else lastTouchTap = { index: drag.start, time: event.timeStamp, x: event.clientX, y: event.clientY };
  } else lastTouchTap = null;
}
function keydown(event) {
  if (event.key !== 'Escape' || !measureDrag.value) return;
  event.preventDefault(); event.stopPropagation(); cancelDrag();
}
function captureClick(event) {
  if (suppressMeasureClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
  suppressMeasureClick = false;
}
watch(() => [props.bars, props.disabled], () => { lastTouchTap = null; cancelDrag(); }, { flush: 'sync' });
onBeforeUnmount(cancelDrag);
</script>

<template>
  <div ref="measures" class="measure-grid" :class="{ dragging: measureDrag?.dragged }" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="finishDrag" @pointercancel="cancelDrag" @lostpointercapture="cancelDrag" @keydown="keydown" @click.capture="captureClick">
    <button v-for="item in props.bars" :key="item.index" type="button" :data-measure-index="item.index" :disabled="props.disabled || props.unavailable(item)" :title="props.measureTitle?.(item) ?? (props.visibleIndices.includes(item.index) ? t('当前视图内的小节') : undefined)" :class="{ active: item.index === props.activeIndex, gogo: item.gogo, 'in-selection': measureSelected(item.index), 'in-view': props.visibleIndices.includes(item.index), 'loop-preview': measureDrag?.dragged && measureSelected(item.index) }" :aria-label="t('小节 {p0}', { p0: item.index + 1 }) + (item.index === props.noteIndex ? ` · ${t('已选音符所在小节')}` : '') + (props.visibleIndices.includes(item.index) ? ` · ${t('当前视图内的小节')}` : '')" :aria-current="item.index === props.activeIndex ? 'location' : undefined" :aria-pressed="measureSelected(item.index)" @click="viewMeasure($event, item.index)" @dblclick="doubleClick($event, item.index)">
      <span>{{ String(item.index + 1).padStart(3, '0') }}</span><span class="mini-notes"><i v-for="(note, index) in miniNotes.get(item.index)" :key="index" :data-note="note" :title="t(NOTE_TYPES.find(type => type.value === note).name)" :class="{ blue: '24B'.includes(note), roll: '56'.includes(note), balloon: note === '7', special: note === '9' }"></i></span>
    </button>
    <button v-if="props.appendable" type="button" class="append-measure" :disabled="props.disabled || !props.bars.length" :aria-label="t('末尾追加小节')" :title="t('末尾追加小节（Shift+Enter）')" @click="emit('append')"><Plus aria-hidden="true" /></button>
  </div>
</template>

<style scoped>
.measure-grid{user-select:none;touch-action:pan-y;grid-template-columns:repeat(auto-fill,minmax(56px,1fr))}.measure-grid.dragging,.measure-grid.dragging button{cursor:crosshair}.measure-grid button.loop-preview{outline:1px solid var(--selection);outline-offset:-1px}
.measure-grid button{padding:7px}
.measure-grid .append-measure{min-height:44px;display:grid;place-items:center;border-style:dashed;color:var(--green)}
.append-measure svg{width:18px;height:18px}
.measure-grid button.active{background:var(--selection-soft);border-color:var(--selection-line);color:var(--selection-ink)}
.measure-grid button.in-selection{box-shadow:inset 0 3px 0 var(--selection)}
.measure-grid .mini-notes{width:40px;max-width:100%;justify-content:center;gap:1px;overflow:visible}
.measure-grid .mini-notes i{width:3px;min-width:3px;flex:0 0 3px}
.measure-grid button.in-view .mini-notes{background:#dceee2;box-shadow:0 0 0 4px #dceee2;border-radius:2px}
.measure-grid .mini-notes i.roll{background:#e6b800}.measure-grid .mini-notes i.balloon{background:#f07800}.measure-grid .mini-notes i.special{background:#ff78ae}.measure-grid button:hover:not(:disabled){background:#edf5ef}
</style>
