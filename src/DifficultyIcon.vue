<script setup>
import { computed } from 'vue';
import { Music2 } from '@lucide/vue';

const props = defineProps({ course: { type: String, required: true } });
const shapes = new Map([['Easy', 'flower'], ['Normal', 'bamboo'], ['Hard', 'pine'], ['Oni', 'monster'], ['Edit', 'monster']]);
const shape = computed(() => shapes.get(props.course));
</script>

<template>
  <span class="difficulty-icon" :data-course="props.course" aria-hidden="true">
    <svg v-if="shape" viewBox="0 0 24 24" fill="none">
      <g v-if="shape === 'flower'" fill="currentColor"><path d="M12 3c4-4 8 2 5 5 6-1 7 6 2 8 3 4-3 8-7 4-4 4-10 0-7-4-5-2-4-9 2-8-3-3 1-9 5-5Z" /><circle cx="12" cy="12" r="3" fill="#fff4ce" /></g>
      <g v-else-if="shape === 'bamboo'" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21V4m6 17V7M7 9h4m-4 6h4m2-3h4m-4 5h4" /><path d="M7 7C2 7 2 3 2 3c4 0 5 4 5 4Zm10 3c1-4 5-4 5-4s0 4-5 4ZM6 16c-4 0-4-3-4-3s4 0 4 3Z" fill="currentColor" stroke="none" /></g>
      <g v-else-if="shape === 'pine'" fill="currentColor"><path d="m12 2 5 7h-3l6 6h-4l6 5H2l6-5H4l6-6H7Z" /><path d="M10.5 19h3v4h-3Z" /></g>
      <g v-else fill="currentColor"><path d="m5 8-2-6 7 3h4l7-3-2 6c2 2 3 5 2 8-1 4-5 6-9 6S4 20 3 16c-1-3 0-6 2-8Z" /><path d="m6 11 4 2-4 1Zm12 0-4 2 4 1Z" fill="#fff" /><path d="M8 17q4 4 8 0" stroke="#fff" stroke-width="1.5" stroke-linecap="round" /></g>
    </svg>
    <Music2 v-else />
  </span>
</template>

<style scoped>
.difficulty-icon{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:24px;height:24px;border-radius:6px;background:#e8eeea;color:#52675b}.difficulty-icon svg{width:20px;height:20px}
.difficulty-icon[data-course=Easy]{background:#fff0e7;color:#e35b36}.difficulty-icon[data-course=Normal]{background:#e6f4e5;color:#32915b}.difficulty-icon[data-course=Hard]{background:#e8f1fb;color:#3376bd}.difficulty-icon[data-course=Oni]{background:#f8eafa;color:#bc56c4}.difficulty-icon[data-course=Edit]{background:#eee7f6;color:#623592}
</style>
