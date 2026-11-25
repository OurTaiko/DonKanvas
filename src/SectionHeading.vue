<script setup>
defineProps({
  icon: { type: [Object, Function], required: true },
  title: { type: String, required: true }
});
</script>

<template>
  <div class="section-caption">
    <span class="section-emblem" aria-hidden="true"><component :is="icon" /></span>
    <div class="section-caption-content">
      <div class="section-title-row"><h2>{{ title }}</h2><slot /></div>
      <div v-if="$slots.description" class="section-description"><slot name="description" /></div>
    </div>
  </div>
</template>

<style scoped>
.section-caption{display:flex;align-items:flex-start;gap:10px;min-width:0;min-height:34px}
.section-emblem{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;color:var(--green);background:#e2eee5;flex-shrink:0}
.section-emblem :deep(svg){width:18px;height:18px}
.section-caption-content{min-width:0}
.section-title-row{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;min-height:20px}
.section-title-row h2{min-width:0;margin:0;font-size:13px;font-weight:600;line-height:1.5;overflow-wrap:anywhere}
.section-description{margin-top:2px;font-size:11px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}
</style>
