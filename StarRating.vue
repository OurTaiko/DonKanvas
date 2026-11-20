<script setup>
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { Star } from '@lucide/vue';
import { t } from './i18n.js';

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  max: { type: Number, default: 10 },
  disabled: Boolean
});
const emit = defineEmits(['update:modelValue']);
const track = ref(null), preview = ref(null), pointer = ref(null), warningId = useId();
const shown = computed(() => preview.value ?? props.modelValue);
const valid = value => Number.isInteger(value) && value >= 1 && value <= props.max;
const invalid = computed(() => props.modelValue !== 0 && !valid(props.modelValue));
const valueText = computed(() => Number.isFinite(shown.value) && shown.value > 0 ? t('{p0} 星', { p0: shown.value }) : t('未设置星级'));
const sliderValue = computed(() => Number.isFinite(shown.value) ? Math.max(1, Math.min(props.max, Math.round(shown.value))) : 1);
function at(clientX) {
  const bounds = track.value.getBoundingClientRect();
  return Math.max(1, Math.min(10, Math.ceil((clientX - bounds.left) / bounds.width * 10)));
}
function cancel() {
  const id = pointer.value;
  pointer.value = null; preview.value = null;
  if (id !== null && track.value?.hasPointerCapture(id)) track.value.releasePointerCapture(id);
}
function start(event) {
  if (props.disabled || pointer.value !== null || event.button !== 0 || !event.isPrimary || at(event.clientX) > props.max) return;
  event.preventDefault(); track.value.focus({ preventScroll: true });
  pointer.value = event.pointerId; preview.value = at(event.clientX);
  track.value.setPointerCapture(event.pointerId);
}
function move(event) {
  if (pointer.value === event.pointerId) preview.value = Math.min(props.max, at(event.clientX));
}
function finish(event) {
  if (pointer.value !== event.pointerId) return;
  const value = Math.min(props.max, at(event.clientX));
  cancel();
  emit('update:modelValue', value);
}
function keydown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (event.key === 'Escape') {
    if (pointer.value !== null) { event.preventDefault(); event.stopPropagation(); cancel(); }
    return;
  }
  const value = Number.isFinite(props.modelValue) ? props.modelValue : 0;
  const values = { ArrowRight: value + 1, ArrowUp: value + 1, ArrowLeft: value - 1, ArrowDown: value - 1, Home: 1, End: props.max };
  if (!(event.key in values) && ![' ', 'Enter'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  if (props.disabled || !(event.key in values)) return;
  cancel();
  const next = Math.max(1, Math.min(props.max, values[event.key]));
  emit('update:modelValue', next);
}
watch(() => [props.modelValue, props.max, props.disabled], cancel);
onBeforeUnmount(cancel);
</script>

<template>
  <div class="star-rating" :class="{ disabled: props.disabled }">
    <slot :value="shown" />
    <div class="star-input">
      <div ref="track" class="star-track" role="slider" :tabindex="props.disabled ? -1 : 0" :aria-label="t('星级')" aria-valuemin="1" :aria-valuemax="props.max" :aria-valuenow="sliderValue" :aria-valuetext="valueText" :aria-disabled="props.disabled" :aria-invalid="invalid || undefined" :aria-describedby="invalid ? warningId : undefined" :title="t('最高 {p0} 星', { p0: props.max })" @pointerdown="start" @pointermove="move" @pointerup="finish" @pointercancel="cancel" @lostpointercapture="cancel" @keydown="keydown">
        <span v-for="star in 10" :key="star" :data-star="star" :class="{ filled: star <= shown && star <= props.max, blocked: star > props.max }" :title="star > props.max ? t('最高 {p0} 星', { p0: props.max }) : t('{p0} 星', { p0: star })" aria-hidden="true"><Star /></span>
      </div>
    </div>
    <small v-if="invalid" :id="warningId" class="star-warning">{{ t('原文件星级不在当前允许范围内；选择新星级后更新。') }}</small>
  </div>
</template>

<style scoped>
.star-rating{min-width:0;max-width:100%}.star-input{display:flex;align-items:center;gap:8px}.star-track{display:flex;min-width:0;gap:2px;touch-action:pan-y;cursor:pointer;border-radius:4px;user-select:none}.star-track:focus-visible{outline:2px solid var(--green);outline-offset:3px}.star-track>span{display:grid;place-items:center;min-width:0;width:20px;height:28px;flex-shrink:1}.star-track svg{width:18px;max-width:100%;height:18px;stroke:#bba16b;stroke-width:1.6;fill:transparent;pointer-events:none}.star-track .filled svg{stroke:#c08a22;fill:#ecc159}.star-track .blocked{cursor:not-allowed}.star-track .blocked svg{stroke:#c6cec8;fill:#e2e7e3}.star-warning{display:block;max-width:280px;color:#946d28;font-size:11px;line-height:1.5;margin-top:3px}.disabled{opacity:.5}.disabled .star-track{cursor:not-allowed}
</style>
