<script setup>
import { inject } from 'vue';
import DifficultyIcon from './DifficultyIcon.vue';
import { courseLabel, variantLabel } from './courses.js';

const { state } = inject('studio');
</script>

<template>
  <div class="document-title"><span class="document-difficulty" role="img" :title="courseLabel(state.chart.variant.course)" :aria-label="courseLabel(state.chart.variant.course)"><DifficultyIcon :course="state.chart.variant.course" /></span><h1 id="song-title" :title="state.chart.title">{{ state.chart.title }}</h1><span id="document-mode" :title="variantLabel(state.chart.variant)">{{ variantLabel(state.chart.variant) }}</span><span v-if="state.encoding" id="encoding">{{ state.encoding }}</span></div>
</template>
