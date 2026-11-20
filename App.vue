<script setup>
import { t, message, languages, localePreference, initializeLocale, setLocale } from './i18n.js';
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { FileMusic, FilePlus2, FolderOpen, X, AudioLines, Save, FilePenLine, SkipBack, SkipForward, Play, Pause, Square, Repeat2, Volume2, Info, LocateFixed, Languages, Check } from '@lucide/vue';
import { useStudio, formatTime } from './useStudio.js';
import { SONG_FIELDS } from './metadata.js';
import productIcon from './assets/icon.png';
import TimelineEditor from './TimelineEditor.vue';
import MeasureEditor from './MeasureEditor.vue';

const localeError = initializeLocale();
const studio = useStudio();
provide('studio', studio);
const { state, controls, range, duration } = studio;
const chartFile = ref(null), audioFile = ref(null), mediaFolder = ref(null);
const languageMenu = ref(null);
const metadataDialog = ref(null), metadataDraft = ref({}), metadataError = ref(false);
const loopDraft = ref(['1', '1']), loopEditing = ref(false), loopDirty = ref(false);
function resetLoopDraft() {
  loopEditing.value = false; loopDirty.value = false; loopDraft.value = range.value.map(String);
}
watch(() => [state.activeId, ...range.value], (value, previous) => {
  if (!loopEditing.value || value[0] !== previous?.[0]) resetLoopDraft();
}, { immediate: true });
function applyLoopDraft() {
  studio.setLoop(...loopDraft.value.map(Number)); resetLoopDraft();
}
function finishLoopEdit(event) {
  if (loopEditing.value && !event.currentTarget.contains(event.relatedTarget)) {
    if (loopDirty.value) applyLoopDraft(); else resetLoopDraft();
  }
}
function openMetadata() {
  metadataDraft.value = { ...studio.metadata.value }; metadataError.value = false;
  metadataDialog.value.showModal();
}
function applyMetadata() {
  if (!studio.setMetadata(metadataDraft.value)) { metadataError.value = true; return false; }
  metadataDialog.value.close(); return true;
}
function metadataKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat && applyMetadata()) void studio.saveChart(event.shiftKey);
  }
}
function closeLanguageMenu() {
  languageMenu.value.open = false;
  languageMenu.value.querySelector('summary').focus({ preventScroll: true });
}
function changeLanguage(code) {
  const error = setLocale(code);
  if (error) studio.notice(message('语言偏好保存失败：{p0}', { p0: error }), true);
  closeLanguageMenu();
}
function languageKeydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeLanguageMenu(); }
  else if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
}
function dismissLanguageMenu(event) {
  const target = event.type === 'focusout' ? event.relatedTarget : event.target;
  if (languageMenu.value?.open && !languageMenu.value.contains(target)) languageMenu.value.open = false;
}
const tabsViewport = ref(null), tabsContent = ref(null), tabsWidth = ref(0), tabsScrollWidth = ref(0), tabsScrollLeft = ref(0), scrollbarDrag = ref(null);
const tabsScrollMax = computed(() => Math.max(0, tabsScrollWidth.value - tabsWidth.value));
const scrollbarThumb = computed(() => {
  const width = Math.min(tabsWidth.value, Math.max(24, tabsWidth.value * tabsWidth.value / (tabsScrollWidth.value || 1)));
  return { width: `${width}px`, transform: `translateX(${tabsScrollMax.value ? tabsScrollLeft.value / tabsScrollMax.value * (tabsWidth.value - width) : 0}px)` };
});
let tabsObserver;
function measureTabs() {
  const viewport = tabsViewport.value;
  tabsWidth.value = viewport.clientWidth; tabsScrollWidth.value = viewport.scrollWidth; tabsScrollLeft.value = viewport.scrollLeft;
}
function scrollTabsBy(distance) {
  tabsViewport.value.scrollLeft = Math.max(0, Math.min(tabsScrollMax.value, tabsViewport.value.scrollLeft + distance));
  measureTabs();
}
function wheelTabs(event) {
  if (event.ctrlKey || !tabsScrollMax.value) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!delta) return;
  event.preventDefault();
  scrollTabsBy(delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? tabsWidth.value : 1));
}
function moveScrollbar(event) {
  if (scrollbarDrag.value?.pointerId !== event.pointerId) return;
  const track = event.currentTarget, thumbWidth = Number.parseFloat(scrollbarThumb.value.width), travel = track.clientWidth - thumbWidth;
  if (travel <= 0) return;
  const left = event.clientX - track.getBoundingClientRect().left - scrollbarDrag.value.offset;
  tabsViewport.value.scrollLeft = Math.max(0, Math.min(1, left / travel)) * tabsScrollMax.value;
  measureTabs();
}
function startScrollbar(event) {
  if (event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  const track = event.currentTarget, thumbWidth = Number.parseFloat(scrollbarThumb.value.width);
  const thumbLeft = tabsScrollMax.value ? tabsScrollLeft.value / tabsScrollMax.value * (track.clientWidth - thumbWidth) : 0;
  scrollbarDrag.value = { pointerId: event.pointerId, offset: event.target === track ? thumbWidth / 2 : event.clientX - track.getBoundingClientRect().left - thumbLeft };
  track.setPointerCapture(event.pointerId); moveScrollbar(event);
}
function stopScrollbar(event) {
  if (scrollbarDrag.value?.pointerId === event.pointerId) scrollbarDrag.value = null;
}
function keydownScrollbar(event) {
  const distances = { ArrowLeft: -40, ArrowRight: 40, PageUp: -tabsWidth.value, PageDown: tabsWidth.value, Home: -tabsScrollMax.value, End: tabsScrollMax.value };
  if (!(event.key in distances)) return;
  event.preventDefault(); event.stopPropagation(); scrollTabsBy(distances[event.key]);
}
onMounted(() => {
  if (localeError) studio.notice(message('语言偏好读取失败：{p0}', { p0: localeError }), true);
  tabsObserver = new ResizeObserver(measureTabs);
  tabsObserver.observe(tabsViewport.value); tabsObserver.observe(tabsContent.value); measureTabs();
  document.addEventListener('pointerdown', dismissLanguageMenu);
});
onUnmounted(() => { tabsObserver.disconnect(); document.removeEventListener('pointerdown', dismissLanguageMenu); });
function chooseCharts() {
  if (typeof window.showOpenFilePicker === 'function') void studio.openCharts();
  else chartFile.value.click();
}
function chooseMediaFolder() {
  if (typeof window.showDirectoryPicker === 'function') void studio.chooseMediaDirectory();
  else mediaFolder.value.click();
}
async function openMediaFolder(event) {
  await studio.setMediaFiles([...event.target.files]);
  event.target.value = '';
}
async function openFile(event, audio = false) {
  const files = [...event.target.files];
  if (audio) await studio.openAudio(files[0]); else for (const file of files) await studio.openChart(file);
  event.target.value = '';
}
</script>

<template>
  <header>
    <div class="brand"><img class="product-icon" :src="productIcon" alt="" width="36" height="36"><div><strong>Web TJA Studio</strong><small>{{ t('谱面编辑器') }}</small></div></div>
    <div class="file-actions"><button id="new-chart" :title="t('新建谱面')" :aria-label="t('新建谱面')" @click="studio.newChart"><FilePlus2 /><span>{{ t('新建') }}</span></button><button id="open-chart" :title="t('打开谱面')" :aria-label="t('打开谱面')" @click="chooseCharts"><FileMusic /><span>{{ t('打开谱面') }}</span></button><button id="media-directory" :title="state.mediaDirectoryName ? t('已关联：{p0}', { p0: state.mediaDirectoryName }) : t('授权谱面所在文件夹，自动匹配 WAVE 音频')" :aria-label="t('关联音频文件夹')" @click="chooseMediaFolder"><FolderOpen /><span>{{ t('关联音频文件夹') }}</span></button><button id="save" class="primary" :title="t('保存（Ctrl+S）')" :aria-label="t('保存')" :disabled="!state.chart || state.saving" @click="studio.saveChart()"><Save /><span>{{ t('保存') }}</span></button><button id="save-as" :title="t('另存为（Ctrl+Shift+S）')" :aria-label="t('另存为')" :disabled="!state.chart || state.saving" @click="studio.saveAs"><FilePenLine /><span>{{ t('另存为') }}</span></button>
      <details ref="languageMenu" class="language-popover" @keydown="languageKeydown" @focusout="dismissLanguageMenu">
        <summary id="language-toggle" class="icon" :title="t('界面语言')" :aria-label="t('界面语言')" aria-controls="language-menu"><Languages aria-hidden="true" /></summary>
        <div id="language-menu" class="language-panel" role="group" :aria-label="t('界面语言')">
          <button v-for="language in [{ code: 'auto', name: t('跟随浏览器') }, ...languages]" :key="language.code" type="button" :data-locale="language.code" :aria-pressed="localePreference === language.code" @click="changeLanguage(language.code)"><span>{{ language.name }}</span><Check v-if="localePreference === language.code" aria-hidden="true" /></button>
        </div>
      </details>
    </div>
  </header>
  <input id="chart-file" ref="chartFile" type="file" accept=".tja" multiple hidden @change="openFile($event)"><input id="audio-file" ref="audioFile" type="file" accept="audio/*,.mp3,.ogg,.wav" hidden @change="openFile($event, true)">
  <input id="media-folder" ref="mediaFolder" type="file" webkitdirectory hidden @change="openMediaFolder">
  <dialog ref="metadataDialog" class="metadata-dialog" aria-labelledby="metadata-heading" @keydown="metadataKeydown">
    <form novalidate @submit.prevent="applyMetadata">
      <div class="metadata-heading"><h2 id="metadata-heading">{{ t('歌曲信息') }}</h2><button type="button" class="icon" :aria-label="t('关闭歌曲信息')" @click="metadataDialog.close()"><X /></button></div>
      <p>{{ t('修改歌曲的 TJA 元数据，应用后支持撤销。更改 WAVE 会重新匹配音频。') }}</p>
      <div class="metadata-grid">
        <label v-for="field in SONG_FIELDS" :key="field.key" :class="{ wide: field.key === 'WAVE' }">{{ t(field.label) }}<input :id="`metadata-${field.key.toLowerCase()}`" v-model="metadataDraft[field.key]" :type="field.numeric ? 'number' : 'text'" :step="field.numeric ? 'any' : undefined" :aria-label="t(field.label)" autocomplete="off"></label>
      </div>
      <p v-if="metadataError" class="metadata-error" role="alert">{{ state.notice }}</p>
      <div class="metadata-actions"><button type="button" @click="metadataDialog.close()">{{ t('取消') }}</button><button type="submit" class="primary">{{ t('应用歌曲信息') }}</button></div>
    </form>
  </dialog>
  <main>
    <section class="studio-panel" :aria-label="t('谱面编辑器')">
    <nav class="chart-tabs" :class="{ dragging: scrollbarDrag }" :aria-label="t('已打开谱面')" @wheel="wheelTabs">
      <div id="chart-tabs-viewport" ref="tabsViewport" class="chart-tabs-viewport" @scroll="measureTabs">
        <div ref="tabsContent" class="chart-tabs-content">
          <div v-for="document in state.documents" :key="document.id" class="chart-tab" :class="{ active: document.id === state.activeId }">
            <button :aria-current="document.id === state.activeId ? 'page' : undefined" @click="studio.switchChart(document.id)">{{ document.id === state.activeId ? state.filename : document.filename }}<span v-if="document.id === state.activeId ? state.dirty || state.invalid : document.dirty || document.invalid" :aria-label="t('未保存')">*</span></button>
            <button class="icon" :aria-label="t('关闭 {p0}', { p0: document.id === state.activeId ? state.filename : document.filename })" :title="document.id === state.activeId ? t('关闭谱面（Ctrl+Alt+W）') : t('关闭谱面')" :aria-keyshortcuts="document.id === state.activeId ? 'Control+Alt+W' : undefined" :disabled="document.saving" @click="studio.closeChart(document.id)"><X /></button>
          </div>
          <span v-if="!state.documents.length" class="empty-session">{{ t('尚未打开谱面，选择“新建”或“打开谱面”开始。') }}</span>
        </div>
      </div>
      <div v-if="tabsScrollMax > 0" class="chart-tabs-scrollbar" role="scrollbar" tabindex="0" :aria-label="t('谱面标签横向滚动')" aria-orientation="horizontal" aria-controls="chart-tabs-viewport" :aria-valuemin="0" :aria-valuemax="tabsScrollMax" :aria-valuenow="Math.round(tabsScrollLeft)" @pointerdown="startScrollbar" @pointermove="moveScrollbar" @pointerup="stopScrollbar" @pointercancel="stopScrollbar" @lostpointercapture="stopScrollbar" @keydown="keydownScrollbar"><span class="chart-tabs-thumb" :style="scrollbarThumb"></span></div>
    </nav>
    <div class="studio-panel-body">
    <section class="document-toolbar">
      <h1 id="song-title" :title="state.chart?.title">{{ state.chart?.title || 'Web TJA Studio' }}</h1>
      <button id="song-metadata" :disabled="!state.chart || state.invalid" @click="openMetadata"><Info />{{ t('歌曲信息') }}</button>
      <label class="course-control">{{ t('难度') }}<select id="course" :value="state.course" :disabled="!state.chart || state.invalid" @change="studio.changeCourse(Number($event.target.value))"><option v-for="(course, index) in state.chart?.courses || []" :key="index" :value="index">{{ course }}</option></select></label>
      <span class="bar-count"><b id="bar-count">{{ state.chart?.bars.length || '—' }}</b> {{ t('小节') }}</span>
      <label v-if="state.chart" class="filename-control">{{ t('文件名') }}<input id="chart-name" :aria-label="t('谱面文件名')" :value="state.filename" :disabled="state.saving" @change="studio.renameChart($event.target.value); $event.target.value = state.filename"></label>
      <span id="encoding">{{ state.encoding }}</span><span class="document-status">{{ state.saving ? t('保存中…') : state.fileHandle ? t('已关联文件') : t('未关联文件') }} · {{ t('撤销 {p0}/50 · 重做 {p1}', { p0: state.undo.length, p1: state.redo.length }) }}</span>
    </section>
    <div id="notice" role="status" aria-live="polite" :class="{ error: state.error }">{{ state.notice }}</div>
    <p v-if="state.chart?.unsimulatedCommands.length" class="command-warning" role="status">{{ t('以下指令仅保留与标注，不模拟游戏效果：{p0}', { p0: state.chart.unsimulatedCommands.map(name => `#${name}`).join(', ') }) }}</p>
    <section class="transport"><div class="transport-left">
      <button id="previous" class="icon" :title="t('上一小节')" :aria-label="t('上一小节')" :disabled="!state.chart" @click="studio.select(state.selected - 1)"><SkipBack /></button>
      <button id="play" class="play icon" :title="t('播放 / 暂停（空格）')" aria-keyshortcuts="Space" :aria-label="state.playing ? t('暂停') : t('播放')" :disabled="!state.chart" @click="state.playing ? studio.pause() : studio.play()"><Pause v-if="state.playing" /><Play v-else /></button>
      <button id="stop" class="icon" :title="t('停止')" :aria-label="t('停止')" :disabled="!state.chart" @click="studio.stop"><Square /></button>
      <button id="next" class="icon" :title="t('下一小节')" :aria-label="t('下一小节')" :disabled="!state.chart" @click="studio.select(state.selected + 1)"><SkipForward /></button>
      <div class="time"><b id="time">{{ formatTime(state.position) }}</b><span id="duration">/ {{ formatTime(duration) }}</span></div>
    </div><div class="transport-right">
      <button id="open-audio" class="primary" :title="t('载入音频')" :aria-label="t('载入音频')" :disabled="!state.chart" @click="audioFile.click()"><AudioLines /><span>{{ t('载入音频') }}</span></button>
      <label>{{ t('速度') }}<select id="rate" v-model.number="controls.rate"><option :value="0.5">0.5×</option><option :value="0.75">0.75×</option><option :value="1">1.0×</option><option :value="1.25">1.25×</option></select></label>
      <details class="volume-popover">
        <summary :title="state.buffer ? state.audioName : t('无伴奏 · 可直接播放谱面')"><Volume2 />{{ t('音量') }}</summary>
        <div class="volume-panel">
          <label for="volume">{{ t('音乐音量') }}<input id="volume" v-model.number="controls.volume" :aria-label="t('音乐音量')" type="range" min="0" max="100"><output for="volume">{{ controls.volume }}%</output></label>
          <label for="hit-volume">{{ t('咚咔音量') }}<input id="hit-volume" v-model.number="controls.hitVolume" :aria-label="t('咚咔音量')" type="range" min="0" max="300"><output id="hit-level" for="hit-volume">{{ controls.hitVolume }}%</output></label>
          <label class="check"><input id="hits" v-model="controls.hits" type="checkbox">{{ t('播放音符音') }}</label>
          <p id="audio-name">{{ state.buffer ? state.audioName : t('无伴奏 · 可直接播放谱面') }}<span v-if="state.chart?.wave"> · WAVE: {{ state.chart.wave }}</span></p><p v-if="state.mediaDirectoryName">{{ t('音频文件夹：{p0}', { p0: state.mediaDirectoryName }) }}</p>
        </div>
      </details>
    </div><div class="loop-controls">
      <label class="check"><input id="loop" v-model="controls.loop" type="checkbox"><Repeat2 />{{ t('循环') }}</label>
      <div class="loop-range-inputs" @focusin="loopEditing = true" @input="loopEditing = true; loopDirty = true" @focusout="finishLoopEdit" @keydown.enter.prevent="applyLoopDraft" @keydown.esc.prevent.stop="resetLoopDraft">
        <label>{{ t('小节') }}<input id="loop-first" v-model="loopDraft[0]" :aria-label="t('循环起始小节')" inputmode="numeric" :disabled="!state.chart"></label><span>–</span>
        <input id="loop-last" v-model="loopDraft[1]" :aria-label="t('结束小节')" inputmode="numeric" :disabled="!state.chart">
        <button id="apply-loop" :disabled="!state.chart" :title="t('应用循环范围（Enter 或离开输入区域）')" @click="applyLoopDraft">{{ t('应用') }}</button>
      </div>
      <button id="loop-current" class="icon" :title="t('循环范围设为当前小节')" :aria-label="t('循环范围设为当前小节')" :disabled="!state.chart" @click="studio.loopCurrent()"><LocateFixed /></button><button id="preview-range" :disabled="!state.chart" @click="studio.previewRange"><Repeat2 />{{ t('试听范围') }}</button>
      <output id="loop-summary">{{ t('第 {p0}–{p1} 小节', { p0: range[0], p1: range[1] }) }}</output>
    </div></section>
    <TimelineEditor><MeasureEditor /></TimelineEditor>
    </div>
    </section>
  </main>
  <footer><span><span class="status-dot"></span>{{ t('本地会话') }}</span><span id="save-state">{{ t(state.saveState) }}</span><nav class="project-links" :aria-label="t('项目信息')"><a href="https://github.com/OurTaiko/web-tja-studio" target="_blank" rel="noopener noreferrer" :title="t('GitHub 仓库')">GitHub</a><a href="https://github.com/OurTaiko" target="_blank" rel="noopener noreferrer" :title="t('开源组织')">OurTaiko</a><a href="https://github.com/OurTaiko/web-tja-studio/blob/HEAD/LICENSE" target="_blank" rel="noopener noreferrer">{{ t('MIT 开源协议') }}</a><span>© 2026 Dafrok</span></nav></footer>
</template>

<style>
.file-actions{flex-wrap:wrap;justify-content:flex-end}
.language-popover{position:relative;flex-shrink:0}.language-popover summary{display:flex;align-items:center;justify-content:center;min-height:36px;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer;list-style:none}.language-popover summary::-webkit-details-marker{display:none}.language-popover summary:hover{border-color:var(--green);color:var(--green)}.language-popover summary:focus-visible{outline:2px solid var(--green);outline-offset:3px}
.language-panel{position:absolute;right:0;top:calc(100% + 6px);z-index:30;width:200px;max-width:calc(100vw - 24px);padding:5px;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 6px 24px #202a2820}.language-panel button{display:flex;justify-content:space-between;width:100%;border:0;background:transparent;text-align:left}.language-panel button[aria-pressed=true]{color:var(--green);background:#edf5ef}.language-panel button:hover{background:#edf5ef}.language-panel svg{width:16px;height:16px}
.project-links{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px 14px}.project-links a{color:inherit;text-decoration:none}.project-links a:hover{color:var(--green);text-decoration:underline}.project-links a:focus-visible{outline:2px solid var(--green);outline-offset:3px;border-radius:2px}
header{min-height:64px;padding:10px 12px;gap:16px}
.brand{font-size:17px;gap:10px;white-space:nowrap}.brand strong{font-weight:600}.brand small{margin-top:2px}.product-icon{border-radius:8px;display:block}
main{max-width:none;margin:0;padding:0}
.document-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:4px;padding:8px 12px 0;font-size:11px;color:var(--muted)}
.document-toolbar h1{font-size:16px;line-height:1.4;margin:0;min-width:80px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.document-toolbar button{min-height:30px;padding:4px 8px;font-size:12px}.course-control,.filename-control{display:flex;align-items:center;gap:6px}
.filename-control{margin-left:auto}.filename-control input{width:180px;min-width:0;padding:5px 7px;border:1px solid var(--line);border-radius:4px;font-size:11px}
.document-toolbar #encoding{margin-left:0;font-size:10px}.bar-count{white-space:nowrap}.document-status{font-size:10px}
#notice{min-height:22px;padding:3px 12px 5px;font-size:11px;overflow-wrap:anywhere}
.command-warning{margin:0;padding:3px 12px 5px;font-size:11px;color:#926b14;overflow-wrap:anywhere}
.transport{padding:7px 12px;gap:8px 18px;justify-content:flex-start}.transport-left{gap:6px}.transport-right{margin-left:auto;order:2}.transport button{min-height:30px;padding:4px 8px}.transport .play{width:36px;height:34px}.time{margin-left:4px}.time b{font-size:17px}
.transport .loop-controls{padding:0;border:0;gap:7px;order:1}.loop-range-inputs{display:flex;align-items:center;gap:6px}.loop-range-inputs input{width:48px;min-width:0;padding:5px;border:1px solid var(--line);border-radius:4px;font-size:12px}.loop-range-inputs label{gap:5px}
.volume-popover{position:relative;font-size:12px}.volume-popover summary{display:flex;align-items:center;gap:6px;padding:7px 9px;border:1px solid var(--line);border-radius:4px;cursor:pointer;list-style:none;background:#fff}.volume-popover summary::-webkit-details-marker{display:none}.volume-popover summary:focus-visible{outline:2px solid var(--green);outline-offset:3px}
.volume-panel{position:absolute;right:0;top:calc(100% + 6px);z-index:20;width:310px;max-width:85vw;padding:15px;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 6px 24px #202a2820;display:grid;gap:14px}.volume-panel>label:not(.check){display:grid;grid-template-columns:minmax(58px,max-content) minmax(0,1fr) 36px;gap:8px}.volume-panel input[type=range]{width:100%;margin:0}.volume-panel output{text-align:right;font-size:11px;color:var(--muted)}.volume-panel p{overflow-wrap:anywhere;line-height:1.5}
.overview{padding:10px 12px}.overview canvas{height:40px;margin-top:5px}.measure-section{padding-inline:12px}
.metadata-dialog{width:540px;max-width:calc(100vw - 32px);max-height:85vh;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:22px;color:var(--ink);box-shadow:0 18px 70px #202a2840}.metadata-dialog::backdrop{background:#202a2866}.metadata-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.metadata-dialog p{line-height:1.6}.metadata-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;margin:20px 0}.metadata-grid label{display:grid;gap:7px;font-size:12px;color:var(--muted);min-width:0}.metadata-grid .wide{grid-column:1/-1}.metadata-grid input{width:100%;min-width:0;border:1px solid var(--line);border-radius:4px;padding:8px;background:#fff}.metadata-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.metadata-dialog .metadata-error{color:#bd352b}
.studio-panel{background:#fff;overflow:hidden}
.studio-panel-body{padding:0}
.chart-tabs{position:relative;margin:0;border-bottom:1px solid var(--line);background:#edf1ee}
.chart-tabs-viewport{overflow-x:auto;scrollbar-width:none;overscroll-behavior-x:contain}
.chart-tabs-viewport::-webkit-scrollbar{display:none}
.chart-tabs-content{display:flex;width:max-content;min-width:100%}
.chart-tabs-scrollbar{position:absolute;left:0;right:0;bottom:0;height:7px;opacity:0;pointer-events:none;transition:opacity .15s;touch-action:none;user-select:none;outline-offset:1px}
.chart-tabs:hover .chart-tabs-scrollbar,.chart-tabs-scrollbar:focus-visible,.chart-tabs.dragging .chart-tabs-scrollbar{opacity:1;pointer-events:auto}
.chart-tabs-thumb{display:block;height:100%;border-radius:4px;background:rgba(80,90,85,.35);cursor:default}
.chart-tabs-scrollbar:hover .chart-tabs-thumb,.chart-tabs.dragging .chart-tabs-thumb{background:rgba(80,90,85,.6)}
@media(prefers-reduced-motion:reduce){.chart-tabs-scrollbar{transition:none}}
.chart-tab{display:flex;flex-shrink:0;max-width:320px;min-height:43px;border-right:1px solid var(--line);border-top:2px solid transparent}
.chart-tab.active{border-top-color:var(--green);background:#fff}
.chart-tab:not(.active):hover{background:#dfe8e2}
.chart-tab.active:hover{background:#f0f6f2}
.chart-tab button{border:0;background:transparent;min-width:0;overflow-wrap:anywhere}
.chart-tab.active button{color:var(--green)}
.chart-tab .icon{flex-shrink:0;opacity:0;pointer-events:none}
.chart-tab.active .icon,.chart-tab:hover .icon,.chart-tab:focus-within .icon{opacity:1;pointer-events:auto}
.chart-tab .icon:hover{background:#cfddd4}
.empty-session{color:var(--muted);padding:13px 20px}
@media(max-width:1000px){.document-status{display:none}.transport-right{order:2}.transport .loop-controls{flex-wrap:wrap}}
@media(max-width:720px){header{padding:8px 12px;gap:8px}.brand{font-size:15px}.document-toolbar{gap:7px}.document-toolbar h1{max-width:180px}.filename-control{margin-left:0}.filename-control input{width:150px}.transport .loop-controls{order:3;flex-basis:100%}.transport-right{margin-left:auto}.metadata-grid{grid-template-columns:minmax(0,1fr)}}
</style>