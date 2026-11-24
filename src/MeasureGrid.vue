<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { t } from './i18n.js';

const props = defineProps({
  bars: { type: Array, required: true },
  selection: { type: Array, default: null },
  activeIndex: { type: Number, default: null },
  anchorIndex: { type: Number, default: null },
  noteIndex: { type: Number, default: null },
  disabled: Boolean,
  unavailable: { type: Function, default: () => false },
  measureTitle: { type: Function, default: null }
});
const emit = defineEmits(['activate', 'select', 'toggle', 'preview']);
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
    const anchor = props.anchorIndex ?? props.activeIndex ?? (props.selection ? props.selection[0] - 1 : index);
    emit('select', Math.min(anchor, index) + 1, Math.max(anchor, index) + 1);
  } else emit('activate', index);
}
let suppressMeasureClick = false;
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
  measureDrag.value = { pointerId: event.pointerId, start: index, end: index, x: event.clientX, y: event.clientY, dragged: false, capture };
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
  suppressMeasureClick = drag.dragged;
  measureDrag.value = null;
  if (drag.capture.hasPointerCapture(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId);
}
function finishDrag(event) {
  const drag = measureDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  moveDrag(event);
  cancelDrag();
  if (drag.dragged) emit('select', Math.min(drag.start, drag.end) + 1, Math.max(drag.start, drag.end) + 1);
}
function keydown(event) {
  if (event.key !== 'Escape' || !measureDrag.value) return;
  event.preventDefault(); event.stopPropagation(); cancelDrag();
}
function captureClick(event) {
  if (suppressMeasureClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
  suppressMeasureClick = false;
}
watch(() => [props.bars, props.disabled], () => cancelDrag(), { flush: 'sync' });
onBeforeUnmount(cancelDrag);
</script>

<template>
  <div ref="measures" class="measure-grid" :class="{ dragging: measureDrag?.dragged }" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="finishDrag" @pointercancel="cancelDrag" @lostpointercapture="cancelDrag" @keydown="keydown" @click.capture="captureClick">
    <button v-for="item in props.bars" :key="item.index" type="button" :data-measure-index="item.index" :disabled="props.disabled || props.unavailable(item)" :title="props.measureTitle?.(item)" :class="{ active: item.index === props.activeIndex, gogo: item.gogo, 'loop-anchor': item.index === props.anchorIndex, 'in-selection': measureSelected(item.index), 'note-selected': item.index === props.noteIndex, 'loop-preview': measureDrag?.dragged && measureSelected(item.index) }" :aria-label="t('小节 {p0}', { p0: item.index + 1 }) + (item.index === props.noteIndex ? ` · ${t('已选音符所在小节')}` : '')" :aria-current="item.index === props.activeIndex ? 'location' : undefined" :aria-pressed="measureSelected(item.index)" @click="viewMeasure($event, item.index)" @dblclick="emit('toggle', item.index)">
      <span>{{ String(item.index + 1).padStart(3, '0') }}</span><span class="mini-notes"><i v-for="(note, index) in [...item.notes].filter(note => note !== '0').slice(0, 10)" :key="index" :class="{ blue: '24B'.includes(note) }"></i></span>
    </button>
  </div>
</template>

<style scoped>
.measure-grid{user-select:none;touch-action:pan-y}.measure-grid.dragging,.measure-grid.dragging button{cursor:crosshair}.measure-grid button.loop-preview{outline:1px solid var(--green);outline-offset:-1px}
.measure-grid button.loop-anchor{outline:2px dashed var(--green);outline-offset:-2px}
.measure-grid button.in-selection{box-shadow:inset 0 3px 0 var(--green)}.measure-grid button.note-selected{position:relative}.measure-grid button.note-selected::after{content:'';position:absolute;right:4px;bottom:4px;width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 0 2px #fff}
</style>
