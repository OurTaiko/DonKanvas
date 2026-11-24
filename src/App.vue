<script setup>
import { t, message, formatMessage, LocalizedError, languages, localePreference, initializeLocale, setLocale } from './i18n.js';
import { computed, nextTick, onMounted, onUnmounted, provide, ref, shallowRef, watch } from 'vue';
import { Plus, Keyboard, ChevronDown, FileMusic, FilePlus2, X, AudioLines, Save, FilePenLine, SkipBack, SkipForward, Play, Pause, Square, Volume2, Info, Languages, Check, Undo2, Redo2, Settings2, RefreshCw, Trash2, Copy, ClipboardPaste, BetweenHorizontalStart, BetweenHorizontalEnd, Eraser } from '@lucide/vue';
import { useStudio, formatTime } from './useStudio.js';
import productIcon from './assets/icon.png';
import TimelineEditor from './TimelineEditor.vue';
import MeasureEditor from './MeasureEditor.vue';
import SongWorkspace from './SongWorkspace.vue';
import DifficultyIcon from './DifficultyIcon.vue';
import { COURSE_NAMES, COURSE_LABELS, courseLabel, variantLabel } from './courses.js';
import { NOTE_TYPES } from './note-model.js';
import { checkPwaUpdate, activatePwaUpdate, waitForPwaRegistration } from './pwa.js';

const localeError = initializeLocale();
const studio = useStudio();
provide('studio', studio);
const { state, controls, range, duration } = studio;
const chartFile = ref(null), audioFile = ref(null);
const transportHost = ref(null), transportHeight = ref(0);
const fileMenu = ref(null), editMenu = ref(null), selectionMenu = ref(null), settingsMenu = ref(null), languageMenu = ref(null), shortcutMenu = ref(null), projectMenu = ref(null);
const mobileWorkspace = ref(matchMedia('(max-width:900px)').matches), workspaceOpen = ref(!mobileWorkspace.value), workspaceSidebar = ref(null), workspaceTop = ref(0);
let desktopWorkspaceOpen = true;
function toggleWorkspace() {
  workspaceOpen.value = !workspaceOpen.value;
  if (!mobileWorkspace.value) desktopWorkspaceOpen = workspaceOpen.value;
}
function closeWorkspace() { workspaceOpen.value = false; }
async function showWorkspaceSection(section) {
  if (!workspaceOpen.value) toggleWorkspace();
  await nextTick();
  workspaceSidebar.value.focusSection(section);
}
function workspaceKeydown(event) {
  if (!mobileWorkspace.value || !workspaceOpen.value || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key !== 'Escape' || event.target.closest('dialog')) return;
  event.preventDefault(); event.stopPropagation(); closeWorkspace(); workspaceSidebar.value.focusToggle();
}
function closeDialogOnEscape(event, dialog) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key !== 'Escape' || event.target.closest('dialog') !== dialog) return;
  event.preventDefault(); event.stopPropagation();
  dialog.close();
}
function positionPopover(menu) {
  if (!menu?.open) return;
  const panel = menu.querySelector(':scope > .file-panel, :scope > .settings-panel');
  if (!panel) return;
  const trigger = menu.querySelector('summary').getBoundingClientRect(), width = document.documentElement.clientWidth;
  panel.style.maxWidth = `${Math.max(0, width - 16)}px`;
  panel.style.left = `${Math.max(8, Math.min(trigger.left, width - panel.offsetWidth - 8))}px`;
  panel.style.top = `${trigger.bottom}px`;
  panel.style.maxHeight = `${Math.max(0, window.innerHeight - trigger.bottom - 8)}px`;
}
function positionMenus() {
  for (const menu of [fileMenu.value, editMenu.value, selectionMenu.value, settingsMenu.value]) positionPopover(menu);
  measureWorkspaceTop();
}
function measureWorkspaceTop() {
  workspaceTop.value = Math.max(0, tabsViewport.value.closest('.chart-tabs').getBoundingClientRect().bottom);
}
function resizeLayout() {
  const mobile = matchMedia('(max-width:900px)').matches;
  if (mobile !== mobileWorkspace.value) {
    mobileWorkspace.value = mobile;
    workspaceOpen.value = mobile ? false : desktopWorkspaceOpen;
  }
  positionMenus();
}
watch(() => state.chart, chart => { if (!chart && mobileWorkspace.value && workspaceOpen.value) closeWorkspace(); });
watch([mobileWorkspace, workspaceOpen], ([mobile, expanded]) => { state.editorBlocked = mobile && expanded; }, { immediate: true, flush: 'sync' });
const pasteDialog = ref(null), pasteMode = ref('overwrite'), pasteError = ref(null);
watch(() => state.pasteRequest, () => { pasteError.value = null; pasteDialog.value.showModal(); });
function applyPaste() {
  if (studio.pasteMeasures(pasteMode.value)) pasteDialog.value.close();
  else pasteError.value = state.noticeMessage;
}
const draftUnavailable = computed(() => state.saveState === '草稿存储不可用 · 请及时保存文件');
const checkingUpdate = ref(false), installingUpdate = ref(false), updateNotice = ref(null), updateError = ref(false), updateVisible = ref(false), pendingUpdate = shallowRef(null);
let appDisposed = false;
const fileErrorDialog = ref(null), fileError = computed(() => state.fileErrors[0]);
watch(fileError, async error => {
  if (!error) return;
  await nextTick();
  if (!appDisposed && !fileErrorDialog.value.open) fileErrorDialog.value.showModal();
}, { flush: 'post' });
const measureActions = computed(() => [
  { label: '前插小节', icon: BetweenHorizontalStart, action: () => studio.insertBar('before'), disabled: !studio.bar.value || state.invalid },
  { label: '后插小节', icon: BetweenHorizontalEnd, action: () => studio.insertBar('after'), disabled: !studio.bar.value || state.invalid },
  { label: '删除小节', icon: Trash2, action: studio.deleteBar, disabled: !studio.bar.value || state.invalid || state.chart.bars.length < 2 },
  { label: '清空本小节', icon: Eraser, action: studio.clearBar, disabled: !studio.bar.value || state.invalid }
]);
const shortcutGroups = [
  { title: '文件', items: [['Ctrl+Alt+N', '新建谱面'], ['Ctrl+O', '打开谱面'], ['Ctrl+S', '保存'], ['Ctrl+Shift+S', '另存为'], ['Ctrl+Alt+W', '关闭谱面']] },
  { title: '编辑与播放', items: [['Ctrl+Z', '撤销'], ['Ctrl+Shift+Z', '重做'], ['Ctrl+C', '复制小节'], ['Ctrl+V', '粘贴小节'], ['Ctrl+A', '选择全部小节'], ['Ctrl+Shift+A', '选择正在查看的小节'], ['Space', '播放 / 暂停'], ['1–9', '设置音符（对应音符按钮）'], ['- / =', '双人咚 / 双人咔'], ['0 / Delete / Backspace', '清空音符'], ['A / D', '前后移动选中位置'], ['W / S', '增加 / 减少吸附等分'], ['F', '按两次选择小节区间（包含首尾小节）'], ['Shift+F', '取消小节选择'], ['Esc', '取消区间标记 / 音符选择']] },
  { title: '时间轴导航', items: [['Q / E', '播放位置后退 / 前进一小节'], ['← / →', '左右平移可视区域'], ['PageUp / PageDown', '向前 / 向后滚动一页'], ['Home / End', '跳到开头 / 结尾']] }
];
const selectionDialog = ref(null), selectionKind = ref('measures'), selectionDraft = ref([1, 1]), selectionError = ref(null);
function closePopover(menu) {
  menu.open = false;
  menu.querySelector('summary').focus({ preventScroll: true });
}
function runFileAction(action) {
  closePopover(fileMenu.value);
  return action();
}
function runEditAction(action) {
  closePopover(editMenu.value);
  return action();
}
function runSelectionAction(action) {
  closePopover(selectionMenu.value);
  return action();
}
function openSelectionDialog(kind) {
  selectionKind.value = kind; selectionError.value = null;
  selectionDraft.value = kind === 'measures' ? [...(range.value ?? [state.selected + 1, state.selected + 1])] : [state.selected + 1, 1];
  selectionDialog.value.showModal();
}
function applySelection() {
  const [first, last] = selectionDraft.value.map(Number);
  const applied = selectionKind.value === 'measures' ? studio.setLoop(first, last) : studio.selectNote(first - 1, last);
  if (applied) selectionDialog.value.close();
  else selectionError.value = state.noticeMessage;
}
function selectionKeydown(event) {
  if (event.isComposing) return;
  if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    event.preventDefault(); event.stopPropagation(); selectionDialog.value.close();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); event.stopPropagation();
  }
}
async function installUpdate() {
  if (installingUpdate.value || !pendingUpdate.value) return;
  installingUpdate.value = true; updateError.value = false; updateVisible.value = true;
  try {
    if (state.saving || state.documents.some(item => item.saving)) throw new LocalizedError('请等待所有谱面保存完成后再更新。');
    if (!confirm(t('发现新版本，是否更新并重启？谱面草稿将保留，音频和文件写回授权需重新载入。'))) {
      updateNotice.value = message('更新已下载，可稍后重启。'); return;
    }
    updateNotice.value = message('正在安装更新并重启…');
    await activatePwaUpdate(pendingUpdate.value);
    if (appDisposed) return;
    if (!studio.reloadForUpdate()) { updateNotice.value = state.noticeMessage; updateError.value = true; }
  } catch (error) {
    updateNotice.value = message('检测或安装更新失败：{p0}', { p0: error }); updateError.value = true;
  } finally { installingUpdate.value = false; }
}
async function checkUpdate(passive = false) {
  if (checkingUpdate.value || installingUpdate.value) return;
  checkingUpdate.value = true; updateError.value = false;
  if (!passive) { updateNotice.value = message('正在检测更新…'); updateVisible.value = true; }
  try {
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) throw new LocalizedError('此环境不支持 PWA 更新，请使用 HTTPS 部署的生产版本。');
    const scope = new URL(import.meta.env.BASE_URL, location.href).href;
    const registration = await waitForPwaRegistration(navigator.serviceWorker, scope);
    const worker = pendingUpdate.value ?? await checkPwaUpdate(registration);
    if (appDisposed) return;
    if (!worker) {
      if (!passive) updateNotice.value = message('已经是最新版本。');
      return;
    }
    pendingUpdate.value = worker; updateNotice.value = message('发现新版本，可更新并重启。'); updateVisible.value = true;
    if (!passive) await installUpdate();
  } catch (error) {
    if (!appDisposed) { updateNotice.value = message('检测或安装更新失败：{p0}', { p0: error }); updateError.value = true; updateVisible.value = true; }
  } finally { checkingUpdate.value = false; }
}
function changeLanguage(code) {
  const error = setLocale(code);
  if (error) studio.notice(message('语言偏好保存失败：{p0}', { p0: error }), true);
  closePopover(languageMenu.value);
}
const topMenus = () => [fileMenu.value, editMenu.value, selectionMenu.value, settingsMenu.value];
let altMenuPending = false, menuReturnFocus = null;
function cancelAltMenu() { altMenuPending = false; }
function altMenuKeydown(event) {
  if (event.key !== 'Alt') { cancelAltMenu(); return; }
  if (event.repeat || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.keyCode === 229 || event.getModifierState?.('AltGraph') || document.activeElement?.closest?.('dialog, [role="dialog"]')) return;
  altMenuPending = true;
  event.preventDefault();
}
function leaveMenuBar() {
  for (const menu of topMenus()) menu.open = false;
  if (menuReturnFocus?.isConnected) menuReturnFocus.focus({ preventScroll: true });
  else document.activeElement?.blur();
  menuReturnFocus = null;
}
function altMenuKeyup(event) {
  if (event.key !== 'Alt' || !altMenuPending) return;
  cancelAltMenu();
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.getModifierState?.('AltGraph') || document.activeElement?.closest?.('dialog, [role="dialog"]')) return;
  event.preventDefault();
  if (topMenus().some(menu => menu.contains(document.activeElement))) leaveMenuBar();
  else {
    menuReturnFocus = document.activeElement;
    for (const menu of topMenus()) menu.open = false;
    fileMenu.value.querySelector('summary').focus({ preventScroll: true });
  }
}
function menuItems(menu) {
  const panel = menu.querySelector('summary').nextElementSibling;
  return [...panel.querySelectorAll('button:not(:disabled), a[href], summary, [tabindex="0"]')]
    .filter(item => item.getClientRects().length && !item.closest('[inert]') &&
      (item.tagName === 'SUMMARY' ? item.parentElement.parentElement.closest('details') : item.closest('details')) === menu);
}
function openKeyboardMenu(menu, last = false) {
  menu.open = true;
  positionPopover(menu);
  const items = menuItems(menu);
  (last ? items.at(-1) : items[0])?.focus();
  if (!items.length) menu.querySelector('summary').nextElementSibling.focus();
}
function switchKeyboardMenu(menu, direction) {
  const menus = topMenus(), opened = menu.open;
  const next = menus[(menus.indexOf(menu) + direction + menus.length) % menus.length];
  menu.open = false;
  next.querySelector('summary').focus({ preventScroll: true });
  if (opened) openKeyboardMenu(next);
}
function popoverKeydown(event, menu) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.keyCode === 229) return;
  event.stopPropagation();
  const root = topMenus().find(item => item.contains(menu));
  if (event.key === 'Escape') {
    event.preventDefault();
    if (menu.open) closePopover(menu);
    else if (menu !== root) closePopover(root);
    else leaveMenuBar();
  } else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    if (event.key === 'ArrowLeft' && menu !== root && menu.open) closePopover(menu);
    else if (event.key === 'ArrowRight' && event.target.tagName === 'SUMMARY' && menu !== root) openKeyboardMenu(menu);
    else switchKeyboardMenu(root, event.key === 'ArrowLeft' ? -1 : 1);
  } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const level = menu !== root && event.target === menu.querySelector('summary') ? root : menu;
    const items = menuItems(level), index = items.indexOf(document.activeElement);
    if (!level.open || index < 0) openKeyboardMenu(level, event.key === 'ArrowUp' || event.key === 'End');
    else {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }
  } else if (event.key === 'Enter' && event.target.tagName === 'SUMMARY') {
    event.preventDefault();
    if (menu.open) closePopover(menu); else openKeyboardMenu(menu);
  }
}
function dismissPopovers(event) {
  for (const menu of [fileMenu.value, editMenu.value, selectionMenu.value, settingsMenu.value, languageMenu.value, shortcutMenu.value, projectMenu.value]) {
    if ([languageMenu.value, shortcutMenu.value, projectMenu.value].includes(menu) && settingsMenu.value?.contains(event.target)) continue;
    if (menu?.open && !menu.contains(event.target)) menu.open = false;
  }
}
function toggleSettingsSection(event) {
  if (!event.target.open) return;
  for (const menu of [languageMenu.value, shortcutMenu.value, projectMenu.value]) {
    if (menu !== event.target) menu.open = false;
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
let tabsObserver, transportObserver;
function measureTabs() {
  const viewport = tabsViewport.value;
  tabsWidth.value = viewport.clientWidth; tabsScrollWidth.value = viewport.scrollWidth; tabsScrollLeft.value = viewport.scrollLeft;
  measureWorkspaceTop();
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
  transportObserver = new ResizeObserver(entries => { transportHeight.value = entries[0].target.getBoundingClientRect().height; });
  transportObserver.observe(transportHost.value); transportHeight.value = transportHost.value.getBoundingClientRect().height;
  document.addEventListener('pointerdown', dismissPopovers);
  document.addEventListener('focusin', dismissPopovers);
  document.addEventListener('keydown', fileKeydown);
  document.addEventListener('keydown', altMenuKeydown, true);
  document.addEventListener('keyup', altMenuKeyup, true);
  window.addEventListener('blur', cancelAltMenu);
  document.addEventListener('dragover', dragOverFiles);
  document.addEventListener('drop', dropFiles);
  window.addEventListener('resize', resizeLayout);
  window.addEventListener('scroll', positionMenus, true);
  if (!import.meta.env.DEV && 'serviceWorker' in navigator) void checkUpdate(true);
});
onUnmounted(() => { appDisposed = true; tabsObserver.disconnect(); transportObserver.disconnect(); document.removeEventListener('pointerdown', dismissPopovers); document.removeEventListener('focusin', dismissPopovers); document.removeEventListener('keydown', fileKeydown); document.removeEventListener('keydown', altMenuKeydown, true); document.removeEventListener('keyup', altMenuKeyup, true); window.removeEventListener('blur', cancelAltMenu); document.removeEventListener('dragover', dragOverFiles); document.removeEventListener('drop', dropFiles); window.removeEventListener('resize', resizeLayout); window.removeEventListener('scroll', positionMenus, true); });
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
  const audio = files.filter(file => /^audio\//i.test(file.type ?? '') || /\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i.test(file.name));
  if (!charts.length && !audio.length) { studio.reportFileError(message('请拖入 .tja 谱面或音频文件。')); return; }
  const errorsBefore = state.fileErrors.length;
  for (const file of charts) await studio.openChart(file);
  if (audio.length > 1) { studio.reportFileError(message('一次只能拖入一个音频文件，未载入音频。')); return; }
  if (audio.length) await studio.openAudio(audio[0]);
  const ignored = files.filter(file => !charts.includes(file) && !audio.includes(file));
  if (ignored.length && !state.error && state.fileErrors.length === errorsBefore) studio.reportFileError(message('已忽略不支持的文件：{p0}', { p0: ignored.map(file => file.name).join(', ') }));
}
</script>

<template>
  <header>
    <div class="brand"><img class="product-icon" :src="productIcon" alt="Web TJA Studio" width="24" height="24"></div>
    <div class="file-actions">
      <details ref="fileMenu" class="file-popover" @toggle="positionPopover($event.target)" @keydown="popoverKeydown($event, fileMenu)">
        <summary id="file-toggle" :title="t('文件')" :aria-label="t('文件')" aria-controls="file-menu"><span>{{ t('文件') }}</span></summary>
        <div id="file-menu" class="file-panel" role="group" :aria-label="t('文件')">
          <button id="new-chart" type="button" :title="t('新建谱面（Ctrl+Alt+N）')" :aria-label="t('新建谱面')" aria-keyshortcuts="Control+Alt+n" @click="runFileAction(studio.newChart)"><FilePlus2 aria-hidden="true" /><span>{{ t('新建') }}</span><kbd aria-hidden="true">Ctrl+Alt+N</kbd></button>
          <button id="open-chart" type="button" :title="t('打开谱面（Ctrl+O）')" :aria-label="t('打开谱面')" aria-keyshortcuts="Control+o Meta+o" @click="runFileAction(chooseCharts)"><FileMusic aria-hidden="true" /><span>{{ t('打开谱面') }}</span><kbd aria-hidden="true">Ctrl+O</kbd></button>
          <button id="menu-open-audio" type="button" :disabled="!state.chart" @click="runFileAction(() => audioFile.click())"><AudioLines aria-hidden="true" /><span>{{ t('载入音频') }}</span></button>
          <hr>
          <button id="save" type="button" :title="t('保存（Ctrl+S）')" :aria-label="t('保存')" :disabled="!state.chart || state.saving" @click="runFileAction(studio.saveChart)"><Save aria-hidden="true" /><span>{{ t('保存') }}</span><kbd aria-hidden="true">Ctrl+S</kbd></button>
          <button id="save-as" type="button" :title="t('另存为（Ctrl+Shift+S）')" :aria-label="t('另存为')" :disabled="!state.chart || state.saving" @click="runFileAction(studio.saveAs)"><FilePenLine aria-hidden="true" /><span>{{ t('另存为') }}</span><kbd aria-hidden="true">Ctrl+Shift+S</kbd></button>
          <hr>
          <button id="close-chart" type="button" :disabled="!state.chart || state.saving" @click="runFileAction(() => studio.closeChart(state.activeId))"><X aria-hidden="true" /><span>{{ t('关闭谱面') }}</span><kbd aria-hidden="true">Ctrl+Alt+W</kbd></button>
        </div>
      </details>
      <details ref="editMenu" class="file-popover" @toggle="positionPopover($event.target)" @keydown="popoverKeydown($event, editMenu)">
        <summary id="edit-toggle" :title="t('编辑')" :aria-label="t('编辑')" aria-controls="edit-menu">{{ t('编辑') }}</summary>
        <div id="edit-menu" class="file-panel" role="group" :aria-label="t('编辑')">
          <button id="menu-undo" type="button" :disabled="!state.undo.length" @click="runEditAction(() => studio.history())"><Undo2 aria-hidden="true" /><span>{{ t('撤销') }}</span><kbd aria-hidden="true">Ctrl+Z</kbd></button>
          <button id="menu-redo" type="button" :disabled="!state.redo.length" @click="runEditAction(() => studio.history(true))"><Redo2 aria-hidden="true" /><span>{{ t('重做') }}</span><kbd aria-hidden="true">Ctrl+Shift+Z</kbd></button>
          <button id="copy-measures" type="button" :disabled="!studio.bar.value || state.invalid" @click="runEditAction(studio.copyMeasures)"><Copy aria-hidden="true" /><span>{{ t('复制小节') }}</span><kbd aria-hidden="true">Ctrl+C</kbd></button>
          <button id="paste-measures" type="button" :disabled="!studio.bar.value || state.invalid || !state.copiedMeasures?.length" @click="runEditAction(studio.requestPaste)"><ClipboardPaste aria-hidden="true" /><span>{{ t('粘贴小节') }}</span><kbd aria-hidden="true">Ctrl+V</kbd></button>
          <hr><h3>{{ t('音符编辑') }}</h3>
          <button v-for="type in NOTE_TYPES" :key="type.value" type="button" :data-menu-note="type.value" :disabled="!studio.cell.value || state.invalid" @click="runEditAction(() => studio.chooseNote(type.value))"><span class="choice-icon" aria-hidden="true"><span class="choice-symbol" :class="type.shape"></span></span><span>{{ type.value === '0' ? t('清空音符') : t(type.name) }}</span><kbd aria-hidden="true">{{ type.value === '0' ? '0 / Delete' : type.shortcut ?? type.value }}</kbd></button>
          <hr><h3>{{ t('小节操作') }}</h3>
          <button v-for="item in measureActions" :key="item.label" type="button" :disabled="item.disabled" @click="runEditAction(item.action)"><component :is="item.icon" aria-hidden="true" /><span>{{ t(item.label) }}</span></button>
        </div>
      </details>
      <details ref="selectionMenu" class="file-popover" @toggle="positionPopover($event.target)" @keydown="popoverKeydown($event, selectionMenu)">
        <summary id="selection-toggle" :title="t('选择')" :aria-label="t('选择')" aria-controls="selection-menu">{{ t('选择') }}</summary>
        <div id="selection-menu" class="file-panel" role="group" :aria-label="t('选择')">
          <h3>{{ t('选择小节') }}</h3>
          <button id="select-viewed" type="button" :disabled="!studio.bar.value || state.invalid" @click="runSelectionAction(() => studio.setLoop(state.selected + 1, state.selected + 1))"><Check aria-hidden="true" /><span>{{ t('选择正在查看的小节') }}</span><kbd aria-hidden="true">Ctrl+Shift+A</kbd></button>
          <button id="select-all-measures" type="button" :disabled="!studio.bar.value || state.invalid" @click="runSelectionAction(() => studio.setLoop(1, state.chart.bars.length))"><Check aria-hidden="true" /><span>{{ t('选择全部小节') }}</span><kbd aria-hidden="true">Ctrl+A</kbd></button>
          <button id="select-measure-range" type="button" :disabled="!studio.bar.value || state.invalid" @click="runSelectionAction(() => openSelectionDialog('measures'))"><Plus aria-hidden="true" /><span>{{ t('输入小节区间…') }}</span></button>
          <button type="button" :disabled="!studio.bar.value || state.invalid" @click="runSelectionAction(studio.markLoop)"><Check aria-hidden="true" /><span>{{ t('标记区间端点') }}</span><kbd aria-hidden="true">F</kbd></button>
          <button id="clear-measure-selection" type="button" :disabled="!range && state.loopAnchor === null" @click="runSelectionAction(studio.clearLoop)"><X aria-hidden="true" /><span>{{ t('取消小节选择') }}</span><kbd aria-hidden="true">Shift+F</kbd></button>
          <hr><h3>{{ t('选择音符') }}</h3>
          <button id="select-first-note" type="button" :disabled="!studio.bar.value || state.invalid" @click="runSelectionAction(() => studio.selectNote(state.selected, 1))"><Check aria-hidden="true" /><span>{{ t('当前小节的第一个音符') }}</span></button>
          <button id="select-previous-note" type="button" :disabled="!studio.cell.value || state.invalid" @click="runSelectionAction(() => studio.selectAdjacentNote(-1))"><SkipBack aria-hidden="true" /><span>{{ t('上一个音符') }}</span></button>
          <button id="select-next-note" type="button" :disabled="!studio.cell.value || state.invalid" @click="runSelectionAction(() => studio.selectAdjacentNote(1))"><SkipForward aria-hidden="true" /><span>{{ t('下一个音符') }}</span></button>
          <button id="select-note-position" type="button" :disabled="!studio.bar.value || state.invalid" @click="runSelectionAction(() => openSelectionDialog('note'))"><Plus aria-hidden="true" /><span>{{ t('按小节和序号选择…') }}</span></button>
          <button id="clear-note-selection" type="button" :disabled="!studio.cell.value" @click="runSelectionAction(studio.clearNoteSelection)"><X aria-hidden="true" /><span>{{ t('取消音符选择') }}</span><kbd aria-hidden="true">Esc</kbd></button>
          <p class="selection-help">{{ t('单击小节只查看；Shift+单击或拖动选择区间。选中区间会重复播放，音符选择不会改变区间。') }}</p>
        </div>
      </details>
    </div>
    <details ref="settingsMenu" class="settings-popover" @toggle="positionPopover($event.target)" @keydown="popoverKeydown($event, settingsMenu)">
      <summary id="settings-toggle" class="icon" :title="t('设置')" :aria-label="t('设置')" aria-controls="settings-panel"><Settings2 aria-hidden="true" /><span v-if="draftUnavailable" class="status-dot session-dot error" aria-hidden="true"></span></summary>
      <div id="settings-panel" class="settings-panel" role="group" :aria-label="t('设置')" tabindex="0">
      <button id="check-update" type="button" :disabled="checkingUpdate || installingUpdate" @click="closePopover(settingsMenu); checkUpdate()"><RefreshCw aria-hidden="true" /><span>{{ t('检测更新') }}</span></button>
      <details ref="languageMenu" class="language-popover" @toggle="toggleSettingsSection" @keydown="popoverKeydown($event, languageMenu)">
        <summary id="language-toggle" :title="t('界面语言')" :aria-label="t('界面语言')" aria-controls="language-menu"><Languages aria-hidden="true" /><span>{{ t('界面语言') }}</span><ChevronDown aria-hidden="true" /></summary>
        <div id="language-menu" class="language-panel" role="group" :aria-label="t('界面语言')">
          <button v-for="language in [{ code: 'auto', name: t('跟随浏览器') }, ...languages]" :key="language.code" type="button" :data-locale="language.code" :aria-pressed="localePreference === language.code" @click="changeLanguage(language.code)"><span>{{ language.name }}</span><Check v-if="localePreference === language.code" aria-hidden="true" /></button>
        </div>
      </details>
      <details ref="shortcutMenu" class="language-popover shortcut-popover" @toggle="toggleSettingsSection" @keydown="popoverKeydown($event, shortcutMenu)">
        <summary id="shortcuts-toggle" :title="t('快捷键帮助')" :aria-label="t('快捷键帮助')" aria-controls="shortcuts-panel"><Keyboard aria-hidden="true" /><span>{{ t('快捷键帮助') }}</span><ChevronDown aria-hidden="true" /></summary>
        <div id="shortcuts-panel" class="project-panel shortcut-panel" role="region" :aria-label="t('快捷键帮助')" tabindex="0">
          <h2>{{ t('快捷键帮助') }}</h2>
          <section v-for="group in shortcutGroups" :key="group.title">
            <h3>{{ t(group.title) }}</h3>
            <dl><div v-for="[keys, label] in group.items" :key="keys"><dt>{{ t(label) }}</dt><dd><kbd>{{ keys }}</kbd></dd></div></dl>
          </section>
          <p>{{ t('音符操作需先选中位置；输入框保留原生操作。PageUp/PageDown、Home/End 需先聚焦时间轴。') }}</p>
          <p>{{ t('macOS：文件、撤销重做、复制粘贴和选择快捷键也支持 Command 代替 Ctrl。Esc 可关闭菜单并返回入口。') }}</p>
        </div>
      </details>
      <details ref="projectMenu" class="project-popover" @toggle="toggleSettingsSection" @keydown="popoverKeydown($event, projectMenu)">
        <summary id="project-toggle" :title="t('关于')" :aria-label="t('关于')" aria-controls="project-menu"><Info aria-hidden="true" /><span>{{ t('关于') }}</span><ChevronDown aria-hidden="true" /></summary>
        <div id="project-menu" class="project-panel">
          <p v-if="draftUnavailable" id="save-state" role="alert" class="error">{{ t(state.saveState) }}</p>
          <nav class="project-links" :aria-label="t('项目信息')"><a href="https://github.com/OurTaiko/web-tja-studio" target="_blank" rel="noopener noreferrer" :title="t('GitHub 仓库')">GitHub</a><a href="https://github.com/OurTaiko" target="_blank" rel="noopener noreferrer" :title="t('开源组织')">OurTaiko</a><a href="https://github.com/OurTaiko/web-tja-studio/blob/HEAD/LICENSE" target="_blank" rel="noopener noreferrer">{{ t('MIT 开源协议') }}</a></nav>
          <small>© 2026 Dafrok</small>
        </div>
      </details>
      </div>
    </details>
  </header>
  <section v-if="updateVisible" class="update-toast" :aria-label="t('检测更新')">
    <p id="update-notice" :role="updateError ? 'alert' : 'status'" aria-live="polite" :class="{ error: updateError }">{{ formatMessage(updateNotice) }}</p>
    <div class="update-actions"><button v-if="pendingUpdate" id="install-update" type="button" class="primary" :disabled="checkingUpdate || installingUpdate" @click="installUpdate">{{ t('更新并重启') }}</button><button id="dismiss-update" type="button" :disabled="installingUpdate" @click="updateVisible = false">{{ pendingUpdate ? t('稍后') : t('关闭提示') }}</button></div>
  </section>
  <dialog ref="selectionDialog" class="selection-dialog" aria-labelledby="selection-dialog-title" @keydown="selectionKeydown">
    <form @submit.prevent="applySelection">
      <h2 id="selection-dialog-title">{{ selectionKind === 'measures' ? t('选择小节') : t('选择音符') }}</h2>
      <div class="selection-fields">
        <label for="selection-first">{{ selectionKind === 'measures' ? t('起始小节') : t('小节编号') }}<input id="selection-first" v-model.number="selectionDraft[0]" type="number" min="1" :max="state.chart?.bars.length" step="1" required></label>
        <label for="selection-last">{{ selectionKind === 'measures' ? t('结束小节') : t('音符序号') }}<input id="selection-last" v-model.number="selectionDraft[1]" type="number" min="1" :max="selectionKind === 'measures' ? state.chart?.bars.length : undefined" step="1" required></label>
      </div>
      <p>{{ selectionKind === 'measures' ? t('区间包含首尾小节，播放时自动重复；取消选择后播放到结束。') : t('音符序号从 1 开始，只统计非空音符。选择音符不改变小节区间。') }}</p>
      <p v-if="selectionError" class="error" role="alert">{{ formatMessage(selectionError) }}</p>
      <div class="selection-dialog-actions"><button type="button" @click="selectionDialog.close()">{{ t('取消') }}</button><button type="submit" class="primary">{{ t('选择') }}</button></div>
    </form>
  </dialog>
  <dialog ref="pasteDialog" class="selection-dialog paste-dialog" aria-labelledby="paste-dialog-title" @keydown.ctrl.s.prevent.stop @keydown.meta.s.prevent.stop @keydown.stop="closeDialogOnEscape($event, pasteDialog)">
    <form @submit.prevent="applyPaste">
      <h2 id="paste-dialog-title">{{ t('粘贴小节') }}</h2>
      <p>{{ t('从正在查看的第 {p0} 小节开始粘贴 {p1} 个小节。', { p0: state.selected + 1, p1: state.copiedMeasures?.length ?? 0 }) }}</p>
      <label class="paste-option"><input v-model="pasteMode" type="radio" name="paste-mode" value="overwrite">{{ t('覆盖现有小节（不足时在末尾续接）') }}</label>
      <label class="paste-option"><input v-model="pasteMode" type="radio" name="paste-mode" value="insert">{{ t('在查看小节之前插入新小节') }}</label>
      <p>{{ t('复制音符、指令和气球次数，仅限当前显示路线，不复制分歧结构。剪贴板可在当前页面的文件标签间共用。') }}</p>
      <p v-if="pasteError" class="error" role="alert">{{ formatMessage(pasteError) }}</p>
      <div class="selection-dialog-actions"><button type="button" @click="pasteDialog.close()">{{ t('取消') }}</button><button type="submit" class="primary">{{ t('粘贴') }}</button></div>
    </form>
  </dialog>
  <dialog ref="fileErrorDialog" class="selection-dialog file-error-dialog" role="alertdialog" aria-labelledby="file-error-title" aria-describedby="file-error-message" @close="state.fileErrors = state.fileErrors.slice(1)" @keydown.ctrl.s.prevent.stop @keydown.meta.s.prevent.stop @keydown.stop="closeDialogOnEscape($event, fileErrorDialog)">
    <h2 id="file-error-title">{{ t('文件载入失败') }}</h2>
    <template v-if="fileError">
      <p v-if="fileError.filename">{{ fileError.filename }}</p>
      <p id="file-error-message" class="error">{{ formatMessage(fileError.error) }}</p>
    </template>
    <div class="selection-dialog-actions"><button type="button" @click="fileErrorDialog.close()">{{ t('关闭') }}</button></div>
  </dialog>
  <input id="chart-file" ref="chartFile" type="file" multiple hidden @change="openFile($event)"><input id="audio-file" ref="audioFile" type="file" accept="audio/*,.mp3,.ogg,.wav,.flac,.m4a,.aac,.opus,.webm" hidden @change="openFile($event, true)">
  <main :style="{ '--transport-height': `${transportHeight}px` }">
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
    <div class="studio-panel-body" :class="{ 'workspace-collapsed': !workspaceOpen || mobileWorkspace }" :style="{ '--workspace-top': `${workspaceTop}px` }">
    <SongWorkspace v-if="state.chart" ref="workspaceSidebar" :collapsed="!workspaceOpen" :class="{ 'workspace-overlay': mobileWorkspace && workspaceOpen }" @toggle="toggleWorkspace" @navigate="showWorkspaceSection" @keydown="workspaceKeydown" />
    <div class="editor-core" :inert="state.editorBlocked">
    <section v-if="studio.bar.value" class="document-toolbar">
      <div class="document-title"><span class="document-difficulty" role="img" :title="courseLabel(state.chart.variant.course)" :aria-label="courseLabel(state.chart.variant.course)"><DifficultyIcon :course="state.chart.variant.course" /></span><h1 id="song-title" :title="state.chart.title">{{ state.chart.title }}</h1><span id="document-mode" :title="variantLabel(state.chart.variant)">{{ variantLabel(state.chart.variant) }}</span><span v-if="state.encoding" id="encoding">{{ state.encoding }}</span></div>
    </section>
    <div class="editor-scroll">
    <TimelineEditor v-if="studio.bar.value" />
    <section v-else class="empty-editor" @keydown.space.stop>
      <FileMusic />
      <h2>{{ state.chart ? t('尚未创建谱面') : t('新建或打开一首歌曲') }}</h2>
      <p>{{ state.chart ? t('选择难度，创建对应的单人空谱面。') : t('新建歌曲，或将 TJA 文件拖入窗口打开。') }}</p>
      <div v-if="state.chart" class="empty-difficulty-actions"><button v-for="course in COURSE_NAMES" :key="course" type="button" :data-create-course="course" :aria-label="t('创建 {p0} 单人谱面', { p0: t(COURSE_LABELS[course]) })" :disabled="state.invalid" @click="studio.createCourse({ course, player: 'single', style: 'Single', level: 1 })"><DifficultyIcon :course="course" />{{ t(COURSE_LABELS[course]) }}</button></div>
      <button v-else id="empty-new-chart" type="button" class="primary" @click="studio.newChart"><Plus aria-hidden="true" />{{ t('新建谱面') }}</button>
    </section>
    </div>
    <Teleport to="body" :disabled="!mobileWorkspace"><div ref="transportHost" class="transport-host">
    <section v-if="studio.bar.value" class="transport"><div class="transport-left">
      <button id="previous" class="icon" :title="t('播放位置后退 / 前进一小节')" :aria-label="t('上一小节')" :disabled="!state.chart || state.invalid" @click="studio.seekMeasure(-1)"><SkipBack /></button>
      <button id="play" class="play icon primary" :class="{ playing: state.playing }" :title="t('播放 / 暂停（空格）')" aria-keyshortcuts="Space" :aria-label="state.playing ? t('暂停') : t('播放')" :disabled="!state.chart" @click="state.playing ? studio.pause() : studio.play()"><Pause v-if="state.playing" /><Play v-else /></button>
      <button id="stop" class="icon" :title="t('停止')" :aria-label="t('停止')" :disabled="!state.chart" @click="studio.stop"><Square /></button>
      <button id="next" class="icon" :title="t('播放位置后退 / 前进一小节')" :aria-label="t('下一小节')" :disabled="!state.chart || state.invalid" @click="studio.seekMeasure(1)"><SkipForward /></button>
      <div class="time"><b id="time">{{ formatTime(state.position) }}</b><span id="duration">/ {{ formatTime(duration) }}</span></div>
    </div><div class="transport-right">
      <label>{{ t('速度') }}<select id="rate" v-model.number="controls.rate"><option v-for="rate in [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]" :key="rate" :value="rate">{{ rate }}×</option></select></label>
      <details class="volume-popover">
        <summary :aria-label="t('音量')" :title="`${t('音量')} · ${state.buffer ? state.audioName : t('无伴奏 · 可直接播放谱面')}`"><Volume2 /><span>{{ t('音量') }}</span></summary>
        <div class="volume-panel">
          <label for="volume">{{ t('音乐音量') }}<input id="volume" v-model.number="controls.volume" :aria-label="t('音乐音量')" type="range" min="0" max="100"><output for="volume">{{ controls.volume }}%</output></label>
          <label for="hit-volume">{{ t('咚咔音量') }}<input id="hit-volume" v-model.number="controls.hitVolume" :aria-label="t('咚咔音量')" type="range" min="0" max="300"><output id="hit-level" for="hit-volume">{{ controls.hitVolume }}%</output></label>
          <label class="check"><input id="hits" v-model="controls.hits" type="checkbox">{{ t('播放音符音') }}</label>
          <p id="audio-name">{{ state.buffer ? state.audioName : t('无伴奏 · 可直接播放谱面') }}<span v-if="state.chart?.wave"> · WAVE: {{ state.chart.wave }}</span></p>
        </div>
      </details>
      <button id="open-audio" class="primary" :title="t('载入音频')" :aria-label="t('载入音频')" :disabled="!state.chart" @click="audioFile.click()"><AudioLines /><span>{{ t('载入音频') }}</span></button>
    </div></section>
    <div v-if="state.notice && (studio.bar.value || state.error)" id="notice" role="status" aria-live="polite" :class="{ error: state.error }">{{ state.notice }}</div>
    </div></Teleport>
    </div>
    <MeasureEditor v-if="studio.bar.value" :inert="state.editorBlocked" />
    </div>
    </section>
  </main>
</template>

<style>
.file-actions{display:flex;gap:2px;flex-wrap:nowrap;justify-content:flex-start;min-width:0}
.file-popover,.language-popover,.project-popover{position:relative;flex-shrink:0}.file-popover summary,.language-popover summary,.project-popover summary{display:flex;align-items:center;justify-content:center;min-height:36px;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer;list-style:none}.file-popover summary::-webkit-details-marker,.language-popover summary::-webkit-details-marker,.project-popover summary::-webkit-details-marker{display:none}.file-popover summary:hover,.language-popover summary:hover,.project-popover summary:hover{border-color:var(--green);color:var(--green)}.file-popover summary:focus-visible,.language-popover summary:focus-visible,.project-popover summary:focus-visible{outline:2px solid var(--green);outline-offset:3px}
.file-popover summary{gap:6px;padding:7px 10px;font-size:12px}.file-popover .menu-chevron{width:12px;height:12px}
.file-panel{position:fixed;z-index:30;width:300px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 54px);overflow:auto;overscroll-behavior:contain;padding:5px;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 6px 24px #202a2820}
.file-panel button{width:100%;border:0;background:transparent;text-align:left;white-space:normal;gap:8px}.file-actions .file-panel button span{display:inline;flex:1;min-width:0;overflow-wrap:anywhere}.file-panel button:not(:disabled):hover{background:#edf5ef}.file-panel kbd{font:11px ui-monospace,monospace;color:var(--muted);flex-shrink:0;max-width:48%;overflow-wrap:anywhere}.file-panel hr{margin:5px 0;border:0;border-top:1px solid var(--line)}.file-panel h3{margin:8px 10px 3px;font-size:11px}.file-actions .file-panel .choice-icon{display:grid;flex:0 0 17px;width:17px;height:17px}.file-actions .file-panel .choice-symbol{display:block;flex:none;transform:scale(.75)}.file-actions .file-panel .choice-symbol.large{transform:scale(.65)}.file-actions .file-panel .choice-symbol.roll{transform:scale(.45)}.file-actions .file-panel .choice-symbol.balloon{transform:scale(.55)}.file-actions .file-panel .choice-symbol.end{transform:rotate(45deg) scale(.75)}
.file-actions>.file-popover>summary:focus-visible,.settings-popover>summary:focus-visible{background:#e1ece5}
.selection-help{padding:8px;font-size:11px;line-height:1.6}.selection-dialog{width:min(420px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;padding:20px;border:1px solid var(--line);border-radius:8px}.selection-dialog::backdrop{background:#202a2870}.selection-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0}.selection-fields label{display:grid;gap:6px;font-size:12px}.selection-fields input{width:100%;min-width:0}.selection-dialog p{line-height:1.6;overflow-wrap:anywhere}.selection-dialog .error{color:#bd352b;margin-top:10px}.selection-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.update-toast{position:fixed;right:12px;top:46px;z-index:50;width:360px;max-width:calc(100% - 24px);max-height:calc(100dvh - 58px);overflow:auto;padding:14px;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 6px 24px #202a2820}.update-toast p{line-height:1.6;overflow-wrap:anywhere}.update-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.language-panel{position:absolute;right:0;top:calc(100% + 6px);z-index:30;width:200px;max-width:calc(100vw - 24px);padding:5px;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 6px 24px #202a2820}.language-panel button{display:flex;justify-content:space-between;width:100%;border:0;background:transparent;text-align:left}.language-panel button[aria-pressed=true]{color:var(--green);background:#edf5ef}.language-panel button:hover{background:#edf5ef}.language-panel svg{width:16px;height:16px}
.project-panel{position:absolute;right:0;top:calc(100% + 6px);z-index:30;width:260px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 120px);overflow:auto;padding:14px;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 6px 24px #202a2820;font-size:12px}.project-panel>p{margin:8px 0;overflow-wrap:anywhere;line-height:1.6}.project-panel>small{display:block;color:var(--muted);font-size:10px;margin-top:10px}.project-links{display:grid;border-block:1px solid var(--line);padding:5px 0}.project-links a{padding:7px 0;color:inherit;text-decoration:none}.project-links a:hover{color:var(--green);text-decoration:underline}.project-links a:focus-visible{outline:2px solid var(--green);outline-offset:3px;border-radius:2px}
.shortcut-panel{width:440px;max-height:calc(100dvh - 100px);overscroll-behavior:contain}.shortcut-panel h2{margin:0 0 12px;font-size:14px}.shortcut-panel h3{margin:12px 0 6px;font-size:12px;color:var(--green)}.shortcut-panel dl{margin:0}.shortcut-panel dl>div{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:5px 0}.shortcut-panel dt{min-width:0;overflow-wrap:anywhere}.shortcut-panel dd{margin:0;flex-shrink:0}.shortcut-panel kbd{font:11px ui-monospace,monospace}.shortcut-panel>p{font-size:11px;color:var(--muted)}.shortcut-panel:focus-visible{outline:2px solid var(--green)}
@media(max-width:720px){.shortcut-popover{position:static}.shortcut-panel{left:12px;right:12px;width:auto;max-height:calc(100dvh - 150px)}.shortcut-panel dl>div{flex-wrap:wrap}}
.session-dot{position:absolute;right:4px;top:4px;box-shadow:0 0 0 2px #fff}.session-dot.error{background:var(--red)}#save-state.error{color:#bd352b}
#app{display:flex;flex-direction:column;height:100dvh;overflow:hidden}
header{position:relative;z-index:40;height:38px;min-height:38px;padding:3px 8px;gap:6px;flex-shrink:0;flex-wrap:nowrap;justify-content:flex-start}
.brand{flex-shrink:0}.product-icon{border-radius:5px;display:block}
.workspace-section-summary{display:flex;align-items:center;gap:7px;padding:12px 14px;cursor:pointer;font-size:12px;list-style:none}.workspace-section-summary::-webkit-details-marker{display:none}.workspace-section-summary>svg{width:14px;height:14px;flex-shrink:0}.workspace-section-summary>svg:first-child{color:var(--green)}.workspace-section-summary>.workspace-section-chevron{width:12px;height:12px;margin-left:auto;transform:rotate(-90deg)}details[open]>.workspace-section-summary{color:var(--green)}details[open]>.workspace-section-summary>.workspace-section-chevron{transform:none}.workspace-section-summary:focus-visible{outline:2px solid var(--green);outline-offset:-2px}
.paste-option{display:flex;align-items:center;gap:8px;margin:14px 0;font-size:12px}
.file-popover>summary{min-height:30px;padding:5px 9px;border:0;border-radius:4px;background:transparent}
.file-popover[open]>summary,.settings-popover[open]>summary,.settings-popover[open]>summary:hover{background:#e1ece5}
.settings-popover{position:relative;margin-left:auto;flex-shrink:0}.settings-popover>summary{position:relative;display:flex;align-items:center;justify-content:center;min-height:30px;width:30px;min-width:30px;padding:5px;border:0;border-radius:4px;cursor:pointer;list-style:none;background:transparent}.settings-popover>summary::-webkit-details-marker{display:none}.settings-popover>summary:hover{background:#edf3ee}.settings-popover>summary:focus-visible{outline:2px solid var(--green);outline-offset:1px}
.settings-panel{position:fixed;z-index:30;width:420px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 54px);overflow:auto;overscroll-behavior:contain;padding:5px;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 6px 24px #202a2820}
.settings-panel>details>summary{justify-content:flex-start;gap:8px;min-height:34px;padding:6px 8px;border:0;border-radius:4px;font-size:12px}.settings-panel>details>summary>svg:last-child{margin-left:auto;width:12px;height:12px}.settings-panel>details[open]>summary{background:#edf5ef;color:var(--green)}
.settings-panel .language-panel,.settings-panel .project-panel{position:static;left:auto;right:auto;top:auto;width:100%;max-width:none;max-height:none;overflow:visible;overscroll-behavior:auto;border:0;border-radius:0;box-shadow:none;padding:8px;background:#f8faf7}.settings-panel .shortcut-panel dl>div{flex-wrap:wrap}.settings-panel .shortcut-panel dd{max-width:100%;overflow-wrap:anywhere}
#check-update{width:100%;justify-content:flex-start;min-height:34px;border:0;padding:6px 8px;font-size:12px}.settings-panel:focus-visible{outline:2px solid var(--green)}#update-notice.error{color:#bd352b}
main{display:flex;flex:1;min-height:0;max-width:none;margin:0;padding:0}
.document-toolbar{display:flex;align-items:center;gap:8px 12px;flex-wrap:nowrap;flex-shrink:0;padding:8px 12px;border-bottom:1px solid var(--line);font-size:11px;color:var(--muted)}
.document-toolbar h1{font-size:16px;line-height:1.4;margin:0;min-width:80px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.document-title{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;flex:1}.document-title h1{min-width:0}.document-difficulty{display:flex;flex-shrink:0}#document-mode{flex-shrink:0;max-width:35%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.document-toolbar #encoding{margin-left:0;font-size:10px;white-space:nowrap;flex-shrink:0}
#notice{min-height:0;max-height:20dvh;overflow:auto;padding:4px 12px;border-top:1px solid var(--line);background:var(--paper);color:var(--muted);font-size:11px;line-height:16px;overflow-wrap:anywhere}
#notice.error{color:#bd352b}
.transport-host:has(>#notice) .transport{box-shadow:none}
@media(max-width:900px){.transport:has(+#notice){padding-bottom:7px}.transport-host>#notice{padding-bottom:calc(4px + env(safe-area-inset-bottom,0px))}}
.transport{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;z-index:5;flex-shrink:0;padding:7px 12px;gap:6px 12px;background:#fff;border-bottom:0;box-shadow:0 -4px 12px #202a2808}.transport-left{min-width:0;gap:4px;flex-wrap:nowrap}.transport-right{width:auto;margin-left:0;gap:8px;flex-wrap:nowrap;justify-content:flex-end}.transport button{min-height:30px;padding:4px 8px}.transport-left>.icon{width:30px;min-width:30px}.transport .play{width:36px;height:34px}.time{margin-left:4px;gap:4px;white-space:nowrap}.time b{font-size:16px}
.transport-host{flex-shrink:0;min-width:0;container-type:inline-size}
.volume-popover{position:relative;font-size:12px}.volume-popover summary{display:flex;align-items:center;gap:6px;padding:7px 9px;border:1px solid var(--line);border-radius:4px;cursor:pointer;list-style:none;background:#fff}.volume-popover summary::-webkit-details-marker{display:none}.volume-popover summary:focus-visible{outline:2px solid var(--green);outline-offset:3px}
.volume-panel{position:absolute;right:0;bottom:calc(100% + 6px);z-index:20;width:310px;max-width:85vw;padding:15px;border:1px solid var(--line);border-radius:6px;background:#fff;box-shadow:0 6px 24px #202a2820;display:grid;gap:14px}.volume-panel>label:not(.check){display:grid;grid-template-columns:minmax(58px,max-content) minmax(0,1fr) 36px;gap:8px}.volume-panel input[type=range]{width:100%;margin:0}.volume-panel output{text-align:right;font-size:11px;color:var(--muted)}.volume-panel p{overflow-wrap:anywhere;line-height:1.5}
.overview{position:relative;padding:0;border-top:1px solid var(--line)}.overview-wave>#overview-hover{position:absolute;z-index:2;pointer-events:none;max-width:100%;padding:6px 9px;border:1px solid var(--line);border-radius:5px;background:#fff;font-size:11px;font-variant-numeric:tabular-nums;color:var(--ink);box-shadow:0 3px 12px #202a2826;overflow-wrap:anywhere}.overview canvas{height:40px;margin-top:0;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 1px),#c5d3c9 10%) #e5ece7;border-radius:0;touch-action:none;cursor:grab}.overview canvas:active{cursor:grabbing}.measure-section{padding-inline:12px}
.studio-panel{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:#fff;overflow:hidden}
.studio-panel-body{flex:1;min-height:0;padding:0;display:grid;grid-template-columns:260px minmax(0,1fr);align-items:stretch}.studio-panel-body:has(.measure-editor){grid-template-columns:260px minmax(0,1fr) 300px}.studio-panel-body:not(:has(.song-workspace)){grid-template-columns:minmax(0,1fr)}.editor-core{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;container-type:inline-size}.editor-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}.editor-core .workspace{grid-template-columns:minmax(0,1fr);border-top:0}
.studio-panel-body.workspace-collapsed:has(>.song-workspace){grid-template-columns:44px minmax(0,1fr)}.studio-panel-body.workspace-collapsed:has(.measure-editor){grid-template-columns:44px minmax(0,1fr) 300px}
.empty-editor{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:480px;padding:40px 24px;text-align:center;background:radial-gradient(ellipse at center,#f0f6f1,transparent 70%)}.empty-editor>svg{width:48px;height:48px;color:#8da896;stroke-width:1.3}.empty-editor h2{margin:20px 0 8px;font-size:20px;font-weight:600}.empty-editor p{max-width:380px;color:var(--muted);font-size:13px;line-height:1.8}.empty-editor>.primary{margin-top:8px}
.empty-difficulty-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;max-width:100%;margin-top:8px}
@media(min-width:901px) and (max-width:1100px){.studio-panel-body{grid-template-columns:220px minmax(0,1fr)}.studio-panel-body:has(.measure-editor){grid-template-columns:220px minmax(0,1fr) 280px}}
@media(max-width:900px){#app{height:auto;min-height:100dvh;overflow:visible}header{position:sticky;top:0}main{display:block;padding-bottom:var(--transport-height)}.studio-panel{overflow:visible}.studio-panel-body,.studio-panel-body:has(.measure-editor),.studio-panel-body.workspace-collapsed:has(>.song-workspace),.studio-panel-body.workspace-collapsed:has(.measure-editor){grid-template-columns:minmax(0,1fr)}.studio-panel-body>.song-workspace{height:auto}.studio-panel-body>.song-workspace.workspace-overlay{position:fixed;top:var(--workspace-top);left:0;right:0;z-index:20;width:100%;height:calc(100dvh - var(--workspace-top) - var(--transport-height));max-height:none}body:has(.workspace-overlay){overflow:hidden}.editor-core{min-height:60dvh;overflow:visible}.editor-scroll{flex:auto;overflow:visible}.transport-host{position:fixed;left:0;right:0;bottom:0;z-index:25}.transport{padding-bottom:calc(7px + env(safe-area-inset-bottom,0px))}.empty-editor{min-height:300px}}
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
@media(max-width:900px){.chart-tabs{position:sticky;top:38px;z-index:15}}
@container(max-width:640px){.transport{grid-template-columns:minmax(0,1fr)}.transport-left .time{margin-left:auto}.transport-right{justify-content:flex-start}.transport #open-audio{margin-left:auto}.volume-popover{position:static}.volume-panel{left:8px;right:8px;width:auto;max-width:none;max-height:calc(100dvh - 140px);overflow:auto;overscroll-behavior:contain}}
@container(max-width:400px){.document-toolbar #encoding{display:none}.document-title{gap:6px}.transport #open-audio>span,.volume-popover>summary>span{display:none}.transport #open-audio{width:34px;min-width:34px;padding:7px}}
@media(max-width:720px){header{padding:3px 8px;gap:6px}.document-toolbar{gap:7px}.document-toolbar h1{max-width:180px}.filename-control{margin-left:0}.filename-control input{width:150px}}

:is(.studio-panel,.transport-host) :is(.document-toolbar,.editor-bar,.transport,.inspector-heading,.aside-actions) button:not(.primary),
.studio-panel .branch-context>.manage-branches,
:is(.file-actions>.file-popover,.settings-popover,.volume-popover)>summary{
  border-color:transparent;background:transparent;color:var(--ink);box-shadow:none;border-radius:4px;
}
:is(.studio-panel,.transport-host) :is(.document-toolbar,.editor-bar,.transport,.inspector-heading,.aside-actions) button:not(.primary):not(:disabled):hover,
.studio-panel .branch-context>.manage-branches:not(:disabled):hover,
:is(.file-actions>.file-popover,.settings-popover,.volume-popover)>summary:hover{background:#202a280d}
:is(.studio-panel,.transport-host) :is(.document-toolbar,.editor-bar,.transport,.inspector-heading,.aside-actions) button:not(.primary):not(:disabled):active,
.studio-panel .branch-context>.manage-branches:not(:disabled):active,
:is(.file-actions>.file-popover,.settings-popover,.volume-popover)>summary:active{background:#202a281a}
:is(.studio-panel,.transport-host) :is(.document-toolbar,.editor-bar,.transport,.inspector-heading,.aside-actions) button:not(.primary):focus-visible,
.studio-panel .branch-context>.manage-branches:focus-visible,
:is(.file-actions>.file-popover,.settings-popover,.volume-popover)>summary:focus-visible{outline:2px solid var(--green);outline-offset:-2px}
:is(.studio-panel,.transport-host) .transport .play{width:30px;height:30px}
:is(.studio-panel,.transport-host) .transport #open-audio,.studio-panel .branch-context>.manage-branches{min-height:30px;padding:4px 8px;font-size:12px}
.volume-popover>summary{min-height:30px;padding:4px 8px}
.studio-panel .editor-bar .delete-measure:not(:disabled):hover,.studio-panel .aside-actions #clear:not(:disabled):hover{color:#bd352b;background:#bd352b12}
:is(.file-actions>.file-popover,.settings-popover,.volume-popover)[open]>summary{background:#16745b18;color:var(--green)}
</style>