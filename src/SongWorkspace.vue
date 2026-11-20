<script setup>
import { inject, ref, watch } from 'vue';
import { ChevronDown, ChevronUp, Info, Menu, Layers } from '@lucide/vue';
import { t } from './i18n.js';
import { SONG_FIELDS } from './metadata.js';
import CourseControls from './CourseControls.vue';

const studio = inject('studio'), { state } = studio;
defineProps({ collapsed: Boolean });
const emit = defineEmits(['toggle', 'navigate']);
const courses = ref(null), metadata = ref(null), toggleButton = ref(null), error = ref(false);
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
function focusSection(section) {
  if (section === 'metadata') { metadata.value.open = true; metadata.value.querySelector('summary').focus({ preventScroll: true }); }
  else courses.value.focusTree();
}
defineExpose({ focusTree: () => courses.value.focusTree(), focusSection, focusToggle: () => toggleButton.value.focus({ preventScroll: true }) });
</script>

<template>
  <aside class="song-workspace" :class="{ collapsed }" :aria-label="t('歌曲工作区')" @keydown.space.stop @keydown.left.stop @keydown.right.stop>
    <button ref="toggleButton" type="button" class="workspace-heading workspace-hamburger" :aria-expanded="!collapsed" :title="collapsed ? t('展开歌曲工作区') : t('收起歌曲工作区')" :aria-label="collapsed ? t('展开歌曲工作区') : t('收起歌曲工作区')" @click="emit('toggle')"><Menu aria-hidden="true" /><b v-if="!collapsed">{{ t('歌曲工作区') }}</b><ChevronUp v-if="!collapsed" class="workspace-collapse" aria-hidden="true" /></button>
    <nav v-if="collapsed" class="workspace-icons" :aria-label="t('歌曲工作区')"><button type="button" class="icon" :title="t('歌曲信息')" :aria-label="t('歌曲信息')" @click="emit('navigate', 'metadata')"><Info aria-hidden="true" /></button><button type="button" class="icon" :title="t('难度与模式')" :aria-label="t('难度与模式')" @click="emit('navigate', 'courses')"><Layers aria-hidden="true" /></button></nav>
    <template v-else>
    <details ref="metadata" class="metadata-editor">
      <summary class="workspace-section-summary"><Info class="metadata-icon" aria-hidden="true" /><b>{{ t('歌曲信息') }}</b><ChevronDown class="workspace-section-chevron" aria-hidden="true" /></summary>
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
    </template>
  </aside>
</template>

<style scoped>
.song-workspace{display:block;padding:0;border-left:0;position:relative;height:100%;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;border-right:1px solid var(--line);background:#f5f7f5}
.workspace-heading{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:0 14px;border:0;border-bottom:1px solid var(--line);border-radius:0;background:#f5f7f5;text-align:left}.workspace-heading b{font-size:12px}.workspace-collapse{margin-left:auto}.workspace-icons button{width:32px;min-width:32px;min-height:32px;padding:7px;border:0;background:transparent}.workspace-icons{display:grid;justify-items:center;gap:4px;padding:6px 0}.workspace-icons button:hover,.workspace-heading:hover{background:#e1ece5;color:var(--green)}.collapsed{width:44px;overflow:hidden}.collapsed .workspace-heading{justify-content:center;padding:0}
.metadata-icon{color:var(--green)}
.metadata-editor{border-bottom:1px solid var(--line)}.metadata-group>summary{display:flex;align-items:center;gap:7px;cursor:pointer;padding:8px 0;color:var(--muted);font-size:11px}.metadata-group>summary svg{width:14px;height:14px;flex-shrink:0}.metadata-group>summary:focus-visible{outline:2px solid var(--green);outline-offset:-2px}
.metadata-group .metadata-chevron{width:12px;height:12px;transform:rotate(-90deg)}.metadata-group[open]>summary .metadata-chevron{transform:none}.metadata-group+.metadata-group{margin-top:8px}.metadata-group .metadata-fields{padding-top:6px}
.metadata-editor form{padding:0 14px 14px}.metadata-editor p{margin:0 0 10px;color:var(--muted);font-size:11px;line-height:1.6}.metadata-fields{display:grid;gap:10px}.metadata-fields label{display:grid;gap:5px;font-size:11px;color:var(--muted)}.metadata-fields input{width:100%;min-width:0;padding:7px 8px;border:1px solid var(--line);border-radius:5px;background:#fff;color:var(--ink);font:inherit;font-size:12px}.metadata-editor .metadata-error{color:#bd3b30;margin-top:10px;overflow-wrap:anywhere}
@media(max-width:900px){.song-workspace{position:relative;flex:1;height:auto;min-height:0;border-right:0}.song-workspace.collapsed{width:100%;overflow:visible}.collapsed .workspace-heading{justify-content:flex-start;padding:0 14px}.workspace-icons{display:none}}
</style>
