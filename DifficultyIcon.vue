<script setup>
import { computed } from 'vue';
import { Flame, Leaf, Mountain, Music2, Sparkles, Sprout } from '@lucide/vue';

const props = defineProps({ course: { type: String, required: true } });
const icons = new Map([['Easy', Sprout], ['Normal', Leaf], ['Hard', Mountain], ['Oni', Flame], ['Edit', Sparkles]]);
const icon = computed(() => icons.get(props.course) ?? Music2);
</script>

<template>
  <span class="difficulty-icon" :data-course="props.course" aria-hidden="true"><component :is="icon" /></span>
</template>

<style scoped>
.difficulty-icon{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:7px;background:#e8eeea;color:#52675b}.difficulty-icon svg{width:14px;height:14px}
.difficulty-icon[data-course=Easy]{background:#fff0c8;color:#8b6311}.difficulty-icon[data-course=Normal]{background:#e6f4e5;color:#357344}.difficulty-icon[data-course=Hard]{background:#e8f1fb;color:#286aa1}.difficulty-icon[data-course=Oni]{background:#f6e8f7;color:#8f4d94}.difficulty-icon[data-course=Edit]{background:#fae4ed;color:#933b66}
</style>
