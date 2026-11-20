<script setup>
import { t, message, languages, localePreference, initializeLocale, setLocale } from './i18n.js';
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { Plus, Keyboard, Files, ChevronDown, FileMusic, FilePlus2, X, AudioLines, Save, FilePenLine, SkipBack, SkipForward, Play, Pause, Square, Repeat2, Volume2, Info, Languages, Check, Undo2, Redo2 } from '@lucide/vue';
import { useStudio, formatTime } from './useStudio.js';
import productIcon from './assets/icon.png';
import TimelineEditor from './TimelineEditor.vue';
import MeasureEditor from './MeasureEditor.vue';
import SongWorkspace from './SongWorkspace.vue';
import BranchControls from './BranchControls.vue';
import DifficultyIcon from './DifficultyIcon.vue';
import { COURSE_NAMES, COURSE_LABELS } from './courses.js';

const localeError = initializeLocale();
const studio = useStudio();
provide('studio', studio);
const { state, controls, range, duration } = studio;
const chartFile = ref(null), audioFile = ref(null);
const fileMenu = ref(null), languageMenu = ref(null), shortcutMenu = ref(null), projectMenu = ref(null);
const draftUnavailable = computed(() => state.saveState === '草稿存储不可用 · 请及时保存文件');
const shortcutGroups = [
  { title: '文件', items: [['Ctrl+Alt+N', '新建谱面'], ['Ctrl+O', '打开谱面'], ['Ctrl+S', '保存'], ['Ctrl+Shift+S', '另存为'], ['Ctrl+Alt+W', '关闭谱面']] },
  { title: '编辑与播放', items: [['Ctrl+Z', '撤销'], ['Ctrl+Shift+Z', '重做'], ['Space', '播放 / 暂停'], ['1–9', '设置音符（对应音符按钮）'], ['- / =', '双人咚 / 双人咔'], ['0 / Delete / Backspace', '清空音符'], ['A / D', '前后移动选中位置'], ['W / S', '增加 / 减少吸附等分'], ['F', '按两次设置循环范围（包含首尾小节）'], ['Shift+F', '清除循环范围'], ['Esc', '取消循环标记 / 选择']] },
  { title: '时间轴导航', items: [['Q / E', '播放位置后退 / 前进一小节'], ['← / →', '左右平移可视区域'], ['PageUp / PageDown', '向前 / 向后滚动一页'], ['Home / End', '跳到开头 / 结尾']] }
];
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
function closePopover(menu) {
  menu.open = false;
  menu.querySelector('summary').focus({ preventScroll: true });
}
function runFileAction(action) {
  closePopover(fileMenu.value);
  return action();
}
function changeLanguage(code) {
  const error = setLocale(code);
  if (error) studio.notice(message('语言偏好保存失败：{p0}', { p0: error }), true);
  closePopover(languageMenu.value);
}
function popoverKeydown(event, menu) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePopover(menu); }
  else if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
}
function dismissPopovers(event) {
  for (const menu of [fileMenu.value, languageMenu.value, shortcutMenu.value, projectMenu.value]) {
    if (menu?.open && !menu.contains(event.target)) menu.open = false;
  }
}
function fileKeydown(event) {
  if (event.defaultPrevented || event.isComposing || event.shiftKey || event.getModifierState?.('AltGraph') || document.activeElement?.closest?.('dialog, [role="dialog"]')) return;
  const key = event.key.toLowerCase();
  const create = event.ctrlKey && event.altKey && !event.metaKey && key === 'n';
  const open = (event.ctrlKey || event.metaKey) && !event.altKey && key === 'o';
  if (!create && !open) return;
  event.preventDefault();
  if (!event.repeat) runFileAction(create ? studio.newChart : chooseCharts);
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
  document.addEventListener('pointerdown', dismissPopovers);
  document.addEventListener('focusin', dismissPopovers);
  document.addEventListener('keydown', fileKeydown);
  document.addEventListener('dragover', dragOverFiles);
  document.addEventListener('drop', dropFiles);
});
onUnmounted(() => { tabsObserver.disconnect(); document.removeEventListener('pointerdown', dismissPopovers); document.removeEventListener('focusin', dismissPopovers); document.removeEventListener('keydown', fileKeydown); document.removeEventListener('dragover', dragOverFiles); document.removeEventListener('drop', dropFiles); });
function chooseCharts() {
  if (typeof window.showOpenFilePicker === 'function') void studio.openCharts();
  else chartFile.value.click();
}
async function openFile(event, audio = false) {
  const files = [...event.target.files];
  if (audio) await studio.openAudio(files[0]); else for (const file of files) await studio.openChart(file);
  event.target.value = '';
}
function dragOverFiles(event) {
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
}
async function dropFiles(event) {
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
  event.preventDefault();
  if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) {
    studio.notice(message('请先完成或取消当前对话框，再拖入谱面。'), true); return;
  }
  const files = Array.from(event.dataTransfer.files), charts = files.filter(file => /\.tja$/i.test(file.name));
  if (!charts.length) { studio.notice(message('请拖入 .tja 谱面文件。'), true); return; }
  for (const file of charts) await studio.openChart(file);
  const ignored = files.filter(file => !/\.tja$/i.test(file.name));
  if (ignored.length && !state.error) studio.notice(message('已忽略非 TJA 文件：{p0}', { p0: ignored.map(file => file.name).join(', ') }), true);
}
</script>

<template>
  <header>
    <div class="brand"><img class="product-icon" :src="productIcon" alt="" width="36" height="36"><div><strong>Web TJA Studio</strong><small>{{ t('谱面编辑器') }}</small></div></div>
    <div class="file-actions">
      <details ref="fileMenu" class="file-popover" @keydown="popoverKeydown($event, fileMenu)">
        <summary id="file-toggle" :title="t('文件')" :aria-label="t('文件')" aria-controls="file-menu"><Files aria-hidden="true" /><span>{{ t('文件') }}</span><ChevronDown class="menu-chevron" aria-hidden="true" /></summary>
        <div id="file-menu" class="file-panel" role="group" :aria-label="t('文件')">
          <button id="new-chart" type="button" :title="t('新建谱面（Ctrl+Alt+N）')" :aria-label="t('新建谱面')" aria-keyshortcuts="Control+Alt+n" @click="runFileAction(studio.newChart)"><FilePlus2 aria-hidden="true" /><span>{{ t('新建') }}</span><kbd aria-hidden="true">Ctrl+Alt+N</kbd></button>
          <button id="open-chart" type="button" :title="t('打开谱面（Ctrl+O）')" :aria-label="t('打开谱面')" aria-keyshortcuts="Control+o Meta+o" @click="runFileAction(chooseCharts)"><FileMusic aria-hidden="true" /><span>{{ t('打开谱面') }}</span><kbd aria-hidden="true">Ctrl+O</kbd></button>
          <hr>
          <button id="save" type="button" :title="t('保存（Ctrl+S）')" :aria-label="t('保存')" :disabled="!state.chart || state.saving" @click="runFileAction(studio.saveChart)"><Save aria-hidden="true" /><span>{{ t('保存') }}</span><kbd aria-hidden="true">Ctrl+S</kbd></button>
          <button id="save-as" type="button" :title="t('另存为（Ctrl+Shift+S）')" :aria-label="t('另存为')" :disabled="!state.chart || state.saving" @click="runFileAction(studio.saveAs)"><FilePenLine aria-hidden="true" /><span>{{ t('另存为') }}</span><kbd aria-hidden="true">Ctrl+Shift+S</kbd></button>
        </div>
      </details>
      <details ref="languageMenu" class="language-popover" @keydown="popoverKeydown($event, languageMenu)">
        <summary id="language-toggle" class="icon" :title="t('界面语言')" :aria-label="t('界面语言')" aria-controls="language-menu"><Languages aria-hidden="true" /></summary>
        <div id="language-menu" class="language-panel" role="group" :aria-label="t('界面语言')">
          <button v-for="language in [{ code: 'auto', name: t('跟随浏览器') }, ...languages]" :key="language.code" type="button" :data-locale="language.code" :aria-pressed="localePreference === language.code" @click="changeLanguage(language.code)"><span>{{ language.name }}</span><Check v-if="localePreference === language.code" aria-hidden="true" /></button>
        </div>
      </details>
      <details ref="shortcutMenu" class="language-popover shortcut-popover" @keydown="popoverKeydown($event, shortcutMenu)">
        <summary id="shortcuts-toggle" class="icon" :title="t('快捷键帮助')" :aria-label="t('快捷键帮助')" aria-controls="shortcuts-panel"><Keyboard aria-hidden="true" /></summary>
        <div id="shortcuts-panel" class="project-panel shortcut-panel" role="region" :aria-label="t('快捷键帮助')" tabindex="0">
          <h2>{{ t('快捷键帮助') }}</h2>
          <section v-for="group in shortcutGroups" :key="group.title">
            <h3>{{ t(group.title) }}</h3>
            <dl><div v-for="[keys, label] in group.items" :key="keys"><dt>{{ t(label) }}</dt><dd><kbd>{{ keys }}</kbd></dd></div></dl>
          </section>
          <p>{{ t('音符操作需先选中位置；输入框保留原生操作。PageUp/PageDown、Home/End 需先聚焦时间轴。') }}</p>
          <p>{{ t('macOS：打开、保存、另存为、撤销和重做也支持 Command 代替 Ctrl。Esc 可关闭菜单并返回入口。') }}</p>
        </div>
      </details>
      <details ref="projectMenu" class="project-popover" @keydown="popoverKeydown($event, projectMenu)">
        <summary id="project-toggle" class="icon" :title="draftUnavailable ? `${t('项目信息')} · ${t(state.saveState)}` : t('项目信息')" :aria-label="draftUnavailable ? `${t('项目信息')} · ${t(state.saveState)}` : t('项目信息')" aria-controls="project-menu"><Info aria-hidden="true" /><span v-if="draftUnavailable" class="status-dot session-dot error" aria-hidden="true"></span></summary>
        <div id="project-menu" class="project-panel">
          <p v-if="draftUnavailable" id="save-state" role="alert" class="error">{{ t(state.saveState) }}</p>
          <nav class="project-links" :aria-label="t('项目信息')"><a href="https://github.com/OurTaiko/web-tja-studio" target="_blank" rel="noopener noreferrer" :title="t('GitHub 仓库')">GitHub</a><a href="https://github.com/OurTaiko" target="_blank" rel="noopener noreferrer" :title="t('开源组织')">OurTaiko</a><a href="https://github.com/OurTaiko/web-tja-studio/blob/HEAD/LICENSE" target="_blank" rel="noopener noreferrer">{{ t('MIT 开源协议') }}</a></nav>
          <small>© 2026 Dafrok</small>
        </div>
      </details>
    </div>
  </header>
  <input id="chart-file" ref="chartFile" type="file" accept=".tja" multiple hidden @change="openFile($event)"><input id="audio-file" ref="audioFile" type="file" accept="audio/*,.mp3,.ogg,.wav" hidden @change="openFile($event, true)">
  <main>
    <section class="studio-panel" :aria-label="t('谱面编辑器')">
    <nav class="chart-tabs" :class="{ dragging: scrollbarDrag }" :aria-label="t('已打开谱面')" @wheel="wheelTabs">
      <div id="chart-tabs-viewport" ref="tabsViewport" class="chart-tabs-viewport" @scroll="measureTabs">
        <div ref="tabsContent" class="chart-tabs-content">
          <div v-for="document in state.documents" :key="document.id" class="chart-tab" :class="{ active: document.id === state.activeId }">
            <button class="chart-tab-select" :title="document.id === state.activeId ? state.filename : document.filename" :aria-current="document.id === state.activeId ? 'page' : undefined" @click="studio.switchChart(document.id)"><span class="chart-tab-name">{{ document.id === state.activeId ? state.filename : document.filename }}</span><span v-if="document.id === state.activeId ? state.dirty || state.invalid : document.dirty || document.invalid" class="chart-tab-dirty" :aria-label="t('未保存')">*</span></button>
            <button class="icon" :aria-label="t('关闭 {p0}', { p0: document.id === state.activeId ? state.filename : document.filename })" :title="document.id === state.activeId ? t('关闭谱面（Ctrl+Alt+W）') : t('关闭谱面')" :aria-keyshortcuts="document.id === state.activeId ? 'Control+Alt+W' : undefined" :disabled="document.saving" @click="studio.closeChart(document.id)"><X /></button>
          </div>
          <button id="new-chart-tab" type="button" class="icon new-chart-tab" :title="t('新建谱面（Ctrl+Alt+N）')" :aria-label="t('新建谱面')" @click="studio.newChart"><Plus aria-hidden="true" /></button>
        </div>
      </div>
      <div v-if="tabsScrollMax > 0" class="chart-tabs-scrollbar" role="scrollbar" tabindex="0" :aria-label="t('谱面标签横向滚动')" aria-orientation="horizontal" aria-controls="chart-tabs-viewport" :aria-valuemin="0" :aria-valuemax="tabsScrollMax" :aria-valuenow="Math.round(tabsScrollLeft)" @pointerdown="startScrollbar" @pointermove="moveScrollbar" @pointerup="stopScrollbar" @pointercancel="stopScrollbar" @lostpointercapture="stopScrollbar" @keydown="keydownScrollbar"><span class="chart-tabs-thumb" :style="scrollbarThumb"></span></div>
    </nav>
    <div class="studio-panel-body">
    <SongWorkspace v-if="state.chart" />
    <div class="editor-core">
    <section v-if="studio.bar.value" class="document-toolbar">
      <div class="document-title"><h1 id="song-title" :title="state.chart.title">{{ state.chart.title }}</h1><span v-if="state.encoding" id="encoding">{{ state.encoding }}</span></div>
      <div class="document-history"><button id="undo" class="icon" :aria-label="t('撤销')" :title="t('撤销（Ctrl+Z）')" :disabled="!state.undo.length" @click="studio.history()"><Undo2 /></button><button id="redo" class="icon" :aria-label="t('重做')" :title="t('重做（Ctrl+Shift+Z）')" :disabled="!state.redo.length" @click="studio.history(true)"><Redo2 /></button></div>
    </section>
    <div class="editor-scroll">
    <BranchControls v-if="state.chart?.branches.length" />
    <div v-if="studio.bar.value || state.error" id="notice" role="status" aria-live="polite" :class="{ error: state.error }">{{ state.notice }}</div>
    <TimelineEditor v-if="studio.bar.value" />
    <section v-else class="empty-editor" @keydown.space.stop>
      <FileMusic />
      <h2>{{ state.chart ? t('尚未创建谱面') : t('新建或打开一首歌曲') }}</h2>
      <p>{{ state.chart ? t('选择难度，创建对应的单人空谱面。') : t('新建歌曲，或将 TJA 文件拖入窗口打开。') }}</p>
      <div v-if="state.chart" class="empty-difficulty-actions"><button v-for="course in COURSE_NAMES" :key="course" type="button" :data-create-course="course" :aria-label="t('创建 {p0} 单人谱面', { p0: t(COURSE_LABELS[course]) })" :disabled="state.invalid" @click="studio.createCourse({ course, player: 'single', style: 'Single', level: 1 })"><DifficultyIcon :course="course" />{{ t(COURSE_LABELS[course]) }}</button></div>
      <button v-else id="empty-new-chart" type="button" class="primary" @click="studio.newChart"><Plus aria-hidden="true" />{{ t('新建谱面') }}</button>
    </section>
    </div>
    <section v-if="studio.bar.value" class="transport"><div class="transport-left">
      <button id="previous" class="icon" :title="t('上一小节')" :aria-label="t('上一小节')" :disabled="!state.chart" @click="studio.select(state.selected - 1)"><SkipBack /></button>
      <button id="play" class="play icon" :title="t('播放 / 暂停（空格）')" aria-keyshortcuts="Space" :aria-label="state.playing ? t('暂停') : t('播放')" :disabled="!state.chart" @click="state.playing ? studio.pause() : studio.play()"><Pause v-if="state.playing" /><Play v-else /></button>
      <button id="stop" class="icon" :title="t('停止')" :aria-label="t('停止')" :disabled="!state.chart" @click="studio.stop"><Square /></button>
      <button id="next" class="icon" :title="t('下一小节')" :aria-label="t('下一小节')" :disabled="!state.chart" @click="studio.select(state.selected + 1)"><SkipForward /></button>
      <div class="time"><b id="time">{{ formatTime(state.position) }}</b><span id="duration">/ {{ formatTime(duration) }}</span></div>
    </div><div class="transport-right">
      <label>{{ t('速度') }}<select id="rate" v-model.number="controls.rate"><option :value="0.5">0.5×</option><option :value="0.75">0.75×</option><option :value="1">1.0×</option><option :value="1.25">1.25×</option></select></label>
      <details class="volume-popover">
        <summary :title="state.buffer ? state.audioName : t('无伴奏 · 可直接播放谱面')"><Volume2 />{{ t('音量') }}</summary>
        <div class="volume-panel">
          <label for="volume">{{ t('音乐音量') }}<input id="volume" v-model.number="controls.volume" :aria-label="t('音乐音量')" type="range" min="0" max="100"><output for="volume">{{ controls.volume }}%</output></label>
          <label for="hit-volume">{{ t('咚咔音量') }}<input id="hit-volume" v-model.number="controls.hitVolume" :aria-label="t('咚咔音量')" type="range" min="0" max="300"><output id="hit-level" for="hit-volume">{{ controls.hitVolume }}%</output></label>
          <label class="check"><input id="hits" v-model="controls.hits" type="checkbox">{{ t('播放音符音') }}</label>
          <p id="audio-name">{{ state.buffer ? state.audioName : t('无伴奏 · 可直接播放谱面') }}<span v-if="state.chart?.wave"> · WAVE: {{ state.chart.wave }}</span></p>
        </div>
      </details>
      <button id="open-audio" class="primary" :title="t('载入音频')" :aria-label="t('载入音频')" :disabled="!state.chart" @click="audioFile.click()"><AudioLines /><span>{{ t('载入音频') }}</span></button>
    </div><div class="loop-controls">
      <label class="check"><input id="loop" v-model="controls.loop" type="checkbox"><Repeat2 />{{ t('循环') }}</label>
      <div class="loop-range-inputs" @focusin="loopEditing = true" @input="loopEditing = true; loopDirty = true" @focusout="finishLoopEdit" @keydown.enter.prevent="applyLoopDraft" @keydown.esc.prevent.stop="resetLoopDraft">
        <label>{{ t('小节') }}<input id="loop-first" v-model="loopDraft[0]" :aria-label="t('循环起始小节')" inputmode="numeric" :disabled="!state.chart"></label><span>–</span>
        <input id="loop-last" v-model="loopDraft[1]" :aria-label="t('结束小节')" inputmode="numeric" :disabled="!state.chart">
      </div>
    </div></section>
    </div>
    <MeasureEditor v-if="studio.bar.value" />
    </div>
    </section>
  </main>
</template>

<style>
.file-actions{flex-wrap:wrap;justify-content:flex-end}
.file-popover,.language-popover,.project-popover{position:relative;flex-shrink:0}.file-popover summary,.language-popover summary,.project-popover summary{display:flex;align-items:center;justify-content:center;min-height:36px;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer;list-style:none}.file-popover summary::-webkit-details-marker,.language-popover summary::-webkit-details-marker,.project-popover summary::-webkit-details-marker{display:none}.file-popover summary:hover,.language-popover summary:hover,.project-popover summary:hover{border-color:var(--green);color:var(--green)}.file-popover summary:focus-visible,.language-popover summary:focus-visible,.project-popover summary:focus-visible{outline:2px solid var(--green);outline-offset:3px}
.file-popover summary{gap:6px;padding:7px 10px;font-size:12px}.file-popover .menu-chevron{width:12px;height:12px}
.file-panel{position:absolute;right:0;top:calc(100% + 6px);z-index:30;width:280px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 84px);overflow:auto;padding:5px;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 6px 24px #202a2820}
.file-panel button{width:100%;border:0;background:transparent;text-align:left;white-space:nowrap}.file-actions .file-panel button span{display:inline;flex:1}.file-panel button:not(:disabled):hover{background:#edf5ef}.file-panel kbd{font:11px ui-monospace,monospace;color:var(--muted)}.file-panel hr{margin:5px 0;border:0;border-top:1px solid var(--line)}
@media(max-width:720px){header{position:relative}.file-popover{position:static}.file-panel{left:12px;right:12px;width:auto}}
.language-panel{position:absolute;right:0;top:calc(100% + 6px);z-index:30;width:200px;max-width:calc(100vw - 24px);padding:5px;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 6px 24px #202a2820}.language-panel button{display:flex;justify-content:space-between;width:100%;border:0;background:transparent;text-align:left}.language-panel button[aria-pressed=true]{color:var(--green);background:#edf5ef}.language-panel button:hover{background:#edf5ef}.language-panel svg{width:16px;height:16px}
.project-panel{position:absolute;right:0;top:calc(100% + 6px);z-index:30;width:260px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 120px);overflow:auto;padding:14px;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 6px 24px #202a2820;font-size:12px}.project-panel>p{margin:8px 0;overflow-wrap:anywhere;line-height:1.6}.project-panel>small{display:block;color:var(--muted);font-size:10px;margin-top:10px}.project-links{display:grid;border-block:1px solid var(--line);padding:5px 0}.project-links a{padding:7px 0;color:inherit;text-decoration:none}.project-links a:hover{color:var(--green);text-decoration:underline}.project-links a:focus-visible{outline:2px solid var(--green);outline-offset:3px;border-radius:2px}
.shortcut-panel{width:440px;max-height:calc(100dvh - 100px);overscroll-behavior:contain}.shortcut-panel h2{margin:0 0 12px;font-size:14px}.shortcut-panel h3{margin:12px 0 6px;font-size:12px;color:var(--green)}.shortcut-panel dl{margin:0}.shortcut-panel dl>div{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:5px 0}.shortcut-panel dt{min-width:0;overflow-wrap:anywhere}.shortcut-panel dd{margin:0;flex-shrink:0}.shortcut-panel kbd{font:11px ui-monospace,monospace}.shortcut-panel>p{font-size:11px;color:var(--muted)}.shortcut-panel:focus-visible{outline:2px solid var(--green)}
@media(max-width:720px){.shortcut-popover{position:static}.shortcut-panel{left:12px;right:12px;width:auto;max-height:calc(100dvh - 150px)}.shortcut-panel dl>div{flex-wrap:wrap}}
.session-dot{position:absolute;right:4px;top:4px;box-shadow:0 0 0 2px #fff}.session-dot.error{background:var(--red)}#save-state.error{color:#bd352b}
#app{display:flex;flex-direction:column;height:100dvh;overflow:hidden}
header{min-height:64px;padding:10px 12px;gap:16px;flex-shrink:0}
.brand{font-size:17px;gap:10px;white-space:nowrap}.brand strong{font-weight:600}.brand small{margin-top:2px}.product-icon{border-radius:8px;display:block}
main{display:flex;flex:1;min-height:0;max-width:none;margin:0;padding:0}
.document-toolbar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;flex-shrink:0;padding:8px 12px;border-bottom:1px solid var(--line);font-size:11px;color:var(--muted)}
.document-toolbar h1{font-size:16px;line-height:1.4;margin:0;min-width:80px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.document-title{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%}.document-title h1{min-width:0}
.document-toolbar button{min-height:30px;padding:4px 8px;font-size:12px}.document-history{display:flex;gap:4px;margin-left:auto}
.document-toolbar #encoding{margin-left:0;font-size:10px;white-space:nowrap;flex-shrink:0}
#notice{min-height:22px;padding:3px 12px 5px;font-size:11px;overflow-wrap:anywhere}
.transport{position:relative;z-index:5;flex-shrink:0;padding:7px 12px;gap:8px 18px;justify-content:flex-start;background:#fff;border-bottom:0;box-shadow:0 -4px 12px #202a2808}.transport-left{gap:6px}.transport-right{margin-left:auto;order:2}.transport button{min-height:30px;padding:4px 8px}.transport .play{width:36px;height:34px}.time{margin-left:4px}.time b{font-size:17px}
.transport .loop-controls{padding:0;border:0;gap:7px;order:1}.loop-range-inputs{display:flex;align-items:center;gap:6px}.loop-range-inputs input{width:48px;min-width:0;padding:5px;border:1px solid var(--line);border-radius:4px;font-size:12px}.loop-range-inputs label{gap:5px}
.volume-popover{position:relative;font-size:12px}.volume-popover summary{display:flex;align-items:center;gap:6px;padding:7px 9px;border:1px solid var(--line);border-radius:4px;cursor:pointer;list-style:none;background:#fff}.volume-popover summary::-webkit-details-marker{display:none}.volume-popover summary:focus-visible{outline:2px solid var(--green);outline-offset:3px}
.volume-panel{position:absolute;right:0;bottom:calc(100% + 6px);z-index:20;width:310px;max-width:85vw;padding:15px;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 6px 24px #202a2820;display:grid;gap:14px}.volume-panel>label:not(.check){display:grid;grid-template-columns:minmax(58px,max-content) minmax(0,1fr) 36px;gap:8px}.volume-panel input[type=range]{width:100%;margin:0}.volume-panel output{text-align:right;font-size:11px;color:var(--muted)}.volume-panel p{overflow-wrap:anywhere;line-height:1.5}
.overview{padding:10px 12px}.overview canvas{height:40px;margin-top:5px}.measure-section{padding-inline:12px}
.studio-panel{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:#fff;overflow:hidden}
.studio-panel-body{flex:1;min-height:0;padding:0;display:grid;grid-template-columns:260px minmax(0,1fr);align-items:stretch}.studio-panel-body:has(.measure-editor){grid-template-columns:260px minmax(0,1fr) 300px}.studio-panel-body:not(:has(.song-workspace)){grid-template-columns:minmax(0,1fr)}.editor-core{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}.editor-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}.editor-core .workspace{grid-template-columns:minmax(0,1fr)}
.empty-editor{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:480px;padding:40px 24px;text-align:center;background:radial-gradient(ellipse at center,#f0f6f1,transparent 70%)}.empty-editor>svg{width:48px;height:48px;color:#8da896;stroke-width:1.3}.empty-editor h2{margin:20px 0 8px;font-size:20px;font-weight:600}.empty-editor p{max-width:380px;color:var(--muted);font-size:13px;line-height:1.8}.empty-editor>.primary{margin-top:8px}
.empty-difficulty-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;max-width:100%;margin-top:8px}
@media(min-width:901px) and (max-width:1100px){.studio-panel-body{grid-template-columns:220px minmax(0,1fr)}.studio-panel-body:has(.measure-editor){grid-template-columns:220px minmax(0,1fr) 280px}}
@media(max-width:900px){#app{height:auto;min-height:100dvh;overflow:visible}main{display:block}.studio-panel{overflow:visible}.studio-panel-body,.studio-panel-body:has(.measure-editor){grid-template-columns:minmax(0,1fr)}.editor-core{min-height:60dvh;overflow:visible}.editor-scroll{flex:auto;overflow:visible}.transport{position:sticky;bottom:0}.empty-editor{min-height:300px}}
.chart-tabs{position:relative;flex-shrink:0;min-width:0;margin:0;border-bottom:1px solid var(--line);background:#edf1ee}
.chart-tabs .new-chart-tab{width:43px;min-width:43px;min-height:43px;flex-shrink:0;align-self:stretch;border:0;border-right:1px solid var(--line);border-radius:0;background:transparent;color:var(--muted)}.chart-tabs .new-chart-tab:hover{background:#dfe8e2;color:var(--green)}
.chart-tabs-viewport{overflow-x:auto;scrollbar-width:none;overscroll-behavior-x:contain}
.chart-tabs-viewport::-webkit-scrollbar{display:none}
.chart-tabs-content{display:flex;width:max-content;min-width:100%;min-height:43px}
.chart-tabs-scrollbar{position:absolute;left:0;right:0;bottom:0;height:7px;opacity:0;pointer-events:none;transition:opacity .15s;touch-action:none;user-select:none;outline-offset:1px}
.chart-tabs:hover .chart-tabs-scrollbar,.chart-tabs-scrollbar:focus-visible,.chart-tabs.dragging .chart-tabs-scrollbar{opacity:1;pointer-events:auto}
.chart-tabs-thumb{display:block;height:100%;border-radius:4px;background:rgba(80,90,85,.35);cursor:default}
.chart-tabs-scrollbar:hover .chart-tabs-thumb,.chart-tabs.dragging .chart-tabs-thumb{background:rgba(80,90,85,.6)}
@media(prefers-reduced-motion:reduce){.chart-tabs-scrollbar{transition:none}}
.chart-tab{display:flex;flex-shrink:0;max-width:320px;min-height:43px;border-right:1px solid var(--line);border-top:2px solid transparent}
.chart-tab.active{border-top-color:var(--green);background:#fff}
.chart-tab:not(.active):hover{background:#dfe8e2}
.chart-tab.active:hover{background:#f0f6f2}
.chart-tab button{border:0;background:transparent;min-width:0;white-space:nowrap;overflow-wrap:normal}
.chart-tab-select{flex:1}.chart-tab-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chart-tab-dirty{flex-shrink:0}
.chart-tab.active button{color:var(--green)}
.chart-tab .icon{flex-shrink:0;opacity:0;pointer-events:none}
.chart-tab.active .icon,.chart-tab:hover .icon,.chart-tab:focus-within .icon{opacity:1;pointer-events:auto}
.chart-tab .icon:hover{background:#cfddd4}
@media(max-width:1000px){.document-status{display:none}.transport-right{order:2}.transport .loop-controls{flex-wrap:wrap}}
@media(max-width:720px){header{padding:8px 12px;gap:8px}.brand{font-size:15px}.document-toolbar{gap:7px}.document-toolbar h1{max-width:180px}.filename-control{margin-left:0}.filename-control input{width:150px}.transport .loop-controls{order:3;flex-basis:100%}.transport-right{margin-left:auto}}
</style>