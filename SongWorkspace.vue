<script setup>
import { inject, ref, watch } from 'vue';
import { ChevronDown, Info } from '@lucide/vue';
import { t } from './i18n.js';
import { SONG_FIELDS } from './metadata.js';
import CourseControls from './CourseControls.vue';

const studio = inject('studio'), { state } = studio;
const courses = ref(null), error = ref(false);
const fieldGroups = [
  { label: '基本信息', expanded: true, fields: SONG_FIELDS.filter(field => !field.localized) },
  { label: '多语言信息', expanded: false, fields: SONG_FIELDS.filter(field => field.localized) }
];
watch(() => state.activeId, () => { error.value = false; });
watch(() => state.error, failed => { if (!failed) error.value = false; });
function updateMetadata(key, event) {
  const success = studio.setMetadata({ [key]: event.target.value });
  error.value = !success;
  event.target.value = studio.metadata.value[key];
}
defineExpose({ focusTree: () => courses.value.focusTree() });
</script>

<template>
  <aside class="song-workspace" :aria-label="t('歌曲工作区')" @keydown.space.stop @keydown.left.stop @keydown.right.stop>
    <details class="metadata-editor">
      <summary><Info class="metadata-icon" aria-hidden="true" /><b>{{ t('歌曲信息') }}</b><span>{{ studio.metadata.value.TITLE || 'Untitled' }}</span><ChevronDown class="metadata-chevron" /></summary>
      <form novalidate @submit.prevent>
        <details v-for="group in fieldGroups" :key="group.label" class="metadata-group" :open="group.expanded">
          <summary><ChevronDown class="metadata-chevron" />{{ t(group.label) }}</summary>
          <div class="metadata-fields">
            <label v-for="field in group.fields" :key="field.key">{{ t(field.label) }}<input :id="`metadata-${field.key.toLowerCase()}`" :data-song-field="field.key" :value="studio.metadata.value[field.key]" :disabled="state.invalid" :type="field.numeric ? 'number' : 'text'" :step="field.numeric ? 'any' : undefined" :aria-label="t(field.label)" autocomplete="off" @change="updateMetadata(field.key, $event)"></label>
          </div>
        </details>
        <p v-if="error && state.error" class="metadata-error" role="alert">{{ state.notice }}</p>
      </form>
    </details>
    <CourseControls ref="courses" />
  </aside>
</template>

<style scoped>
.song-workspace{display:block;padding:0;border-left:0;position:relative;height:100%;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;border-right:1px solid var(--line);background:#f5f7f5}
.metadata-icon{color:var(--green)}
.metadata-editor{border-bottom:1px solid var(--line)}.metadata-editor summary{display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12px}.metadata-editor>summary{padding:12px 14px}.metadata-editor summary svg{width:14px;height:14px;flex-shrink:0}.metadata-editor summary span{margin-left:auto;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:11px}.metadata-editor summary:focus-visible{outline:2px solid var(--green);outline-offset:-2px}.metadata-editor[open]>summary{color:var(--green)}
.metadata-editor .metadata-chevron{width:12px;height:12px;transform:rotate(-90deg)}.metadata-editor[open]>summary .metadata-chevron,.metadata-group[open]>summary .metadata-chevron{transform:none}.metadata-group>summary{padding:8px 0;color:var(--muted);font-size:11px}.metadata-group+.metadata-group{margin-top:8px}.metadata-group .metadata-fields{padding-top:6px}
.metadata-editor form{padding:0 14px 14px}.metadata-editor p{margin:0 0 10px;color:var(--muted);font-size:11px;line-height:1.6}.metadata-fields{display:grid;gap:10px}.metadata-fields label{display:grid;gap:5px;font-size:11px;color:var(--muted)}.metadata-fields input{width:100%;min-width:0;padding:7px 8px;border:1px solid var(--line);border-radius:5px;background:#fff;color:var(--ink);font:inherit;font-size:12px}.metadata-editor .metadata-error{color:#bd3b30;margin-top:10px;overflow-wrap:anywhere}
@media(max-width:900px){.song-workspace{position:relative;height:auto;min-height:0;max-height:380px;border-right:0;border-bottom:1px solid var(--line)}}
</style>
