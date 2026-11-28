<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, ref, shallowReactive, watch } from 'vue';
import { Check, ChevronLeft, ChevronRight, Cloud, Ellipsis, File, FileMusic, FolderOpen, LoaderCircle, LogOut, RefreshCw, Search, Trash2, X } from '@lucide/vue';
import { t, LocalizedError } from './i18n.js';
import { STORAGE_PROVIDERS, missingStorageConfig } from './personal-storage.js';
import { connectPersonalStorage } from './storage-auth.js';
import onedriveIcon from './assets/storage/cloud-storage.svg';
import googleIcon from './assets/storage/google.png';
import dropboxIcon from './assets/storage/dropbox.svg';

const studio = inject('studio'), config = import.meta.env;
const dialog = ref(null), providerId = ref('onedrive');
const choosing = ref(true), chooser = ref(null), searchInput = ref(null);
const providerIcons = { onedrive: onedriveIcon, google: googleIcon, dropbox: dropboxIcon };
const mode = ref('open'), filename = ref(''), entries = ref([]), busy = ref(false), error = ref(null);
const query = ref(''), page = ref(1);
const remotePages = ref([]), appliedQuery = ref(''), listEnd = ref(false);
const deletedName = ref(''), authorizedName = ref('');
const actionEntry = ref(null), actionTrigger = ref(null), actionMenu = ref(null), actionPosition = ref({});
const isChart = value => /\.tja$/i.test(value.name);
const remotePaging = computed(() => Boolean(connection.value?.listPage));
const filteredEntries = computed(() => {
  const search = query.value.trim().toLowerCase();
  return entries.value.filter(item => item.name.toLowerCase().includes(search));
});
const pageCount = computed(() => remotePaging.value ? Math.max(1, remotePages.value.length) : Math.max(1, Math.ceil(filteredEntries.value.length / 10)));
const pageEntries = computed(() => remotePaging.value ? remotePages.value[page.value - 1]?.entries ?? [] : filteredEntries.value.slice((page.value - 1) * 10, page.value * 10));
const canNext = computed(() => remotePaging.value ? Boolean(remotePages.value[page.value - 1]?.nextCursor) : page.value < pageCount.value);
const connections = shallowReactive(new Map());
const provider = computed(() => STORAGE_PROVIDERS.find(item => item.id === providerId.value));
const connection = computed(() => connections.get(providerId.value));
let targetId = null;

async function run(action) {
  if (busy.value) return;
  closeFileActions(false);
  busy.value = true; error.value = null; deletedName.value = ''; authorizedName.value = '';
  try { await action(); } catch (cause) { error.value = cause; studio.notice(cause, true); }
  finally { busy.value = false; }
}
function open(action = 'open') {
  mode.value = action; targetId = studio.state.activeId;
  filename.value = studio.state.filename;
  choosing.value = true; resetList();
  dialog.value.showModal();
  void nextTick(() => chooser.value?.querySelector('button:not(:disabled)')?.focus());
}
function resetList() {
  closeFileActions(false);
  error.value = null; entries.value = []; query.value = ''; page.value = 1;
  deletedName.value = ''; authorizedName.value = '';
  remotePages.value = []; appliedQuery.value = ''; listEnd.value = false;
}
function chooseStorage() {
  if (busy.value) return;
  choosing.value = true; resetList();
  void nextTick(() => chooser.value?.querySelector('button:not(:disabled)')?.focus());
}
function close() {
  if (actionEntry.value) closeFileActions();
  else if (!busy.value) dialog.value.close();
}
function closeFileActions(restoreFocus = true) {
  const trigger = actionTrigger.value;
  actionEntry.value = null; actionTrigger.value = null;
  if (restoreFocus && trigger?.isConnected) trigger.focus();
}
function dismissFileActions(event) {
  if (actionEntry.value && !actionMenu.value?.contains(event.target) && !actionTrigger.value?.contains(event.target)) closeFileActions(false);
}
function positionFileActions() {
  if (!actionEntry.value || !actionTrigger.value || !actionMenu.value) return;
  const trigger = actionTrigger.value.getBoundingClientRect(), menu = actionMenu.value.getBoundingClientRect();
  const left = Math.max(12, Math.min(trigger.right - menu.width, window.innerWidth - menu.width - 12));
  const below = trigger.bottom + 4;
  const top = below + menu.height <= window.innerHeight - 12 ? below : trigger.top - menu.height - 4;
  actionPosition.value = { left: `${left}px`, top: `${Math.max(12, Math.min(top, window.innerHeight - menu.height - 12))}px` };
}
async function openFileActions(value, event) {
  if (busy.value) return;
  if (actionEntry.value?.id === value.id) { closeFileActions(); return; }
  actionEntry.value = value; actionTrigger.value = event.currentTarget;
  await nextTick();
  if (actionEntry.value?.id !== value.id) return;
  positionFileActions();
  await nextTick();
  if (actionEntry.value?.id !== value.id) return;
  actionMenu.value?.querySelector('button')?.focus();
}
async function refresh() {
  await run(() => loadList(connection.value));
}
async function loadList(storage, search = appliedQuery.value) {
  if (storage.listPage) {
    const result = await storage.listPage({ query: search });
    remotePages.value = [result]; entries.value = result.entries;
    appliedQuery.value = search; page.value = 1; listEnd.value = false;
  } else entries.value = await storage.list();
}
async function searchFiles() {
  if (remotePaging.value) await run(() => loadList(connection.value, query.value.trim()));
  else page.value = 1;
}
async function nextPage() {
  if (busy.value || !canNext.value) return;
  if (!remotePaging.value || remotePages.value[page.value]) { page.value++; return; }
  await run(async () => {
    const result = await connection.value.listPage({ cursor: remotePages.value[page.value - 1].nextCursor, query: appliedQuery.value });
    if (!result.entries.length && !result.nextCursor) {
      remotePages.value = remotePages.value.map((item, index) => index === page.value - 1 ? { ...item, nextCursor: null } : item);
      listEnd.value = true;
      return;
    }
    remotePages.value = [...remotePages.value, result];
    entries.value = remotePages.value.flatMap(item => item.entries);
    page.value++; listEnd.value = false;
  });
}
function previousPage() {
  if (!busy.value && page.value > 1) { page.value--; listEnd.value = false; }
}
async function chooseProvider(id) {
  if (busy.value) return;
  if (providerId.value !== id) providerId.value = id;
  else resetList();
  await run(async () => {
    let storage = connection.value;
    if (!storage?.connected) {
      const missing = missingStorageConfig(id, config);
      if (missing.length) throw new LocalizedError('此存储尚未配置：{p0}。请参阅 README 中的个人存储配置。', { p0: missing.join(', ') });
      storage = await connectPersonalStorage(id, config);
      connections.set(id, storage);
    }
    choosing.value = false;
    await loadList(storage, '');
  });
  if (!choosing.value) { await nextTick(); searchInput.value?.focus(); }
}
function disconnect() {
  if (busy.value) return;
  connection.value.disconnect(); connections.delete(providerId.value);
  chooseStorage();
}
function requireTarget() {
  if (studio.state.activeId !== targetId) throw new LocalizedError('当前谱面已切换，请重新打开个人存储对话框。');
}
function chartHandle(value) {
  if (!isChart(value)) throw new LocalizedError('请选择 .tja 谱面文件：{p0}', { p0: value.name });
  return connection.value.handle(value);
}
async function deleteEntry(value) {
  const trigger = actionTrigger.value;
  await run(async () => {
    if (!confirm(t('删除云端文件“{p0}”？能否恢复取决于存储服务。已打开的谱面和本地修改不会被删除。', { p0: value.name }))) return;
    await connection.value.delete(value);
    deletedName.value = value.name;
    entries.value = entries.value.filter(item => item.id !== value.id);
    if (remotePaging.value) {
      remotePages.value = []; page.value = 1; listEnd.value = false;
    }
    await loadList(connection.value);
  });
  await nextTick();
  if (trigger?.isConnected) trigger.focus();
}
async function openEntry(value) {
  await run(async () => {
    const handle = chartHandle(value);
    if (!await studio.openStorageChart(handle)) return;
    dialog.value.close();
  });
}
async function saveEntry(value) {
  await run(async () => {
    requireTarget();
    const handle = chartHandle(value);
    if (!await studio.saveToStorage(handle)) return;
    dialog.value.close();
  });
}
async function saveNew() {
  await run(async () => {
    requireTarget();
    const name = studio.chartFilename(filename.value);
    const storage = connection.value;
    const existing = storage.findByName ? await storage.findByName(name) : null;
    const matches = storage.findByName ? existing ? [existing] : [] : entries.value.filter(item => item.name.toLowerCase() === name.toLowerCase());
    if (matches.length > 1) throw new LocalizedError('存在多个同名云端文件，请从列表选择要覆盖的文件，或使用新文件名。');
    const handle = chartHandle(matches[0] || { id: null, name, revision: null });
    if (!await studio.saveToStorage(handle)) return;
    dialog.value.close();
  });
}
async function pickGoogle() {
  await run(async () => {
    // A native modal would make the Google Picker's external iframe inert.
    dialog.value.close();
    let value;
    try { value = await connection.value.pick(); }
    finally { dialog.value.showModal(); await nextTick(); }
    if (!value) return;
    if (!isChart(value)) {
      authorizedName.value = value.name;
      await loadList(connection.value);
      return;
    }
    const handle = chartHandle(value);
    if (mode.value === 'save') {
      requireTarget();
      if (!await studio.saveToStorage(handle)) return;
    } else if (!await studio.openStorageChart(handle)) return;
    dialog.value.close();
  });
}
watch(providerId, resetList, { flush: 'sync' });
watch(query, () => { if (!remotePaging.value) page.value = 1; }, { flush: 'sync' });
watch(pageCount, count => { page.value = Math.min(page.value, count); }, { flush: 'sync' });
watch(pageEntries, () => closeFileActions(false), { flush: 'sync' });
onMounted(() => window.addEventListener('resize', positionFileActions));
onUnmounted(() => window.removeEventListener('resize', positionFileActions));
defineExpose({ open });

function fileType(value) {
  const dot = value.name.lastIndexOf('.');
  return dot > 0 && dot < value.name.length - 1 ? value.name.slice(dot + 1).toUpperCase() : t('文件');
}
</script>

<template>
  <dialog ref="dialog" class="personal-storage-dialog" aria-labelledby="personal-storage-title" :aria-describedby="choosing ? 'personal-storage-description' : undefined" :aria-busy="busy" @cancel.prevent="close" @keydown.ctrl.s.prevent.stop @keydown.meta.s.prevent.stop @keydown.stop @pointerdown.capture="dismissFileActions" @focusin.capture="dismissFileActions" @scroll.capture="closeFileActions(false)">
    <div class="storage-heading">
      <div class="storage-heading-text">
        <h2 id="personal-storage-title"><Cloud aria-hidden="true" />{{ t(mode === 'save' ? '保存到个人存储' : '从个人存储打开') }}</h2>
        <p v-if="choosing" id="personal-storage-description" class="desc">{{ t('文件由浏览器直接传输到你授权的个人存储，不经过 DonKanvas 服务器。仅传输谱面，不上传音频；不会自动同步。') }}</p>
      </div>
      <button type="button" class="icon" :disabled="busy" :aria-label="t('关闭')" :title="t('关闭')" @click="close"><X aria-hidden="true" /></button>
    </div>
    <template v-if="choosing">
      <div ref="chooser" class="storage-providers" :aria-label="t('存储服务')">
        <button v-for="item in STORAGE_PROVIDERS" :key="item.id" type="button" class="provider-button" :class="{ 'is-authorizing': busy && providerId === item.id }"
          :disabled="busy"
          :aria-label="item.name" :title="t(mode === 'save' ? '保存谱面到 {p0}' : '从 {p0} 打开谱面', { p0: item.name })" :aria-busy="busy && providerId === item.id" @click="chooseProvider(item.id)">
          <span class="provider-art"><img :src="providerIcons[item.id]" alt="" width="32" height="32" aria-hidden="true"><LoaderCircle v-if="busy && providerId === item.id" class="storage-spinner" aria-hidden="true" /></span>
          <span class="provider-name">{{ item.name }}</span>
          <span v-if="connections.get(item.id)?.connected" class="provider-connected"><Check aria-hidden="true" />{{ t('已连接') }}</span>
        </button>
      </div>
    </template>
    <template v-else>
      <div class="storage-identity">
        <button type="button" class="icon" :disabled="busy" :aria-label="t('选择其他存储')" :title="t('选择其他存储')" @click="chooseStorage"><ChevronLeft aria-hidden="true" /></button>
        <span class="provider-art"><img :src="providerIcons[providerId]" alt="" width="24" height="24" aria-hidden="true"><LoaderCircle v-if="busy" class="storage-spinner" aria-hidden="true" /></span>
        <strong>{{ provider.name }}</strong><span class="storage-connected"><Check aria-hidden="true" />{{ t('已连接') }}</span>
      </div>
      <div class="storage-toolbar">
        <form class="storage-search" @submit.prevent="searchFiles">
          <input ref="searchInput" v-model="query" type="search" autocomplete="off" :placeholder="t('搜索文件名')" :aria-label="t('搜索文件名')" :disabled="busy">
          <button type="submit" class="icon" :disabled="busy" :aria-label="t('搜索')" :title="t('搜索')"><Search aria-hidden="true" /></button>
        </form>
        <button type="button" class="icon" :disabled="busy" :aria-label="t('刷新列表')" :title="t('刷新列表')" @click="refresh"><RefreshCw aria-hidden="true" /></button>
        <button v-if="providerId === 'google'" type="button" class="icon" :disabled="busy" :aria-label="t('选择 Google Drive 文件')" :title="t('选择 Google Drive 文件')" @click="pickGoogle"><FolderOpen aria-hidden="true" /></button>
        <button type="button" class="icon" :disabled="busy" :aria-label="t('断开连接')" :title="t('断开连接')" @click="disconnect"><LogOut aria-hidden="true" /></button>
      </div>
      <div class="storage-browser">
        <div v-if="!pageEntries.length && !error && !busy" class="storage-empty">
          <File aria-hidden="true" />
          <p>{{ t((remotePaging ? appliedQuery : query.trim()) || entries.length ? '没有匹配的文件。' : '没有可访问的文件。') }}</p>
        </div>
        <ul v-if="pageEntries.length" class="storage-files">
          <li v-for="item in pageEntries" :key="item.id">
            <button type="button" class="storage-file" :disabled="busy || !isChart(item)" :title="item.name" @click="mode === 'save' ? saveEntry(item) : openEntry(item)">
              <FileMusic v-if="isChart(item)" aria-hidden="true" /><File v-else aria-hidden="true" /><span>{{ item.name }}</span>
            </button>
            <span class="file-type" :title="fileType(item)">{{ fileType(item) }}</span>
            <button type="button" class="icon storage-delete" :disabled="busy" :aria-label="t('删除文件：{p0}', { p0: item.name })" :title="t('删除文件：{p0}', { p0: item.name })" @click="deleteEntry(item)"><Trash2 aria-hidden="true" /></button>
            <button type="button" class="icon storage-more" :disabled="busy" :aria-label="t('更多操作：{p0}', { p0: item.name })" :title="t('更多操作：{p0}', { p0: item.name })" aria-haspopup="menu" aria-controls="storage-file-actions" :aria-expanded="actionEntry?.id === item.id" @click="openFileActions(item, $event)"><Ellipsis aria-hidden="true" /></button>
          </li>
        </ul>
        <nav v-if="remotePaging ? remotePages.length && pageEntries.length : filteredEntries.length" class="storage-pagination" :aria-label="t('文件列表分页')">
          <button type="button" class="icon" :disabled="busy || page === 1" :aria-label="t('上一页')" :title="t('上一页')" @click="previousPage"><ChevronLeft aria-hidden="true" /></button>
          <p role="status">{{ remotePaging ? t('第 {p0} 页 · 当前 {p1} 个文件', { p0: page, p1: pageEntries.length }) : t('第 {p0} / {p1} 页 · 共 {p2} 个文件', { p0: page, p1: pageCount, p2: filteredEntries.length }) }}</p>
          <button type="button" class="icon" :disabled="busy || !canNext" :aria-label="t('下一页')" :title="t('下一页')" @click="nextPage"><ChevronRight aria-hidden="true" /></button>
        </nav>
      </div>
      <div v-if="actionEntry" id="storage-file-actions" ref="actionMenu" class="storage-file-actions" role="menu" :aria-label="t('文件操作：{p0}', { p0: actionEntry.name })" :style="actionPosition"
        @keydown.esc.prevent.stop="closeFileActions()" @keydown.tab="closeFileActions()" @keydown.up.prevent @keydown.down.prevent @keydown.home.prevent @keydown.end.prevent>
        <p class="storage-menu-name" :title="actionEntry.name">{{ actionEntry.name }}</p>
        <button type="button" role="menuitem" class="storage-menu-delete" :disabled="busy" @click="deleteEntry(actionEntry)"><Trash2 aria-hidden="true" />{{ t('删除文件') }}</button>
      </div>
      <p v-if="listEnd" class="storage-notice" role="status">{{ t('没有更多匹配的文件。') }}</p>
      <p v-if="deletedName" class="storage-notice" role="status">{{ t('已删除云端文件：{p0}。', { p0: deletedName }) }}</p>
      <p v-if="authorizedName" class="storage-notice" role="status">{{ t('已授权文件：{p0}。非 TJA 文件仅供查看和删除。', { p0: authorizedName }) }}</p>
      <form v-if="mode === 'save'" class="storage-save" @submit.prevent="saveNew">
        <label>{{ t('文件名') }}<input v-model="filename" type="text" required :disabled="busy"></label>
        <button type="submit" class="primary" :disabled="busy || !filename.trim()"><Cloud aria-hidden="true" />{{ t('保存') }}</button>
      </form>
    </template>
  </dialog>
</template>

<style scoped>
.personal-storage-dialog{--dialog-width:520px;--dialog-padding:16px}
.storage-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:12px}
.storage-heading-text{min-width:0}
.storage-heading h2{display:flex;align-items:center;gap:8px;margin:0}
.storage-heading h2 svg{width:20px;height:20px}
.storage-heading .desc{margin:6px 0 0;font-size:12px;color:var(--muted)}
.storage-heading>.icon{width:28px;min-width:28px;min-height:28px;padding:5px;border:0}
.storage-providers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0}
.provider-button{flex-direction:column;justify-content:flex-start;gap:6px;min-width:0;min-height:92px;padding:10px 8px;font-size:12px}
.provider-art{position:relative;display:grid;place-items:center;width:40px;height:40px;border-radius:8px;background:var(--paper);flex:none}
.provider-art img{display:block;object-fit:contain}
.provider-name{max-width:100%;overflow-wrap:anywhere;line-height:1.4}
.provider-connected,.storage-connected{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--green)}
.provider-connected svg,.storage-connected svg{width:12px;height:12px}
.provider-button.is-authorizing{opacity:1;border-color:var(--green);background:#edf7f0}
.provider-art .storage-spinner{position:absolute;width:28px;height:28px;color:var(--green)}
.storage-spinner{animation:storage-spin 1s linear infinite}
label{display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--muted)}
input{width:100%;min-width:0;min-height:34px;border:1px solid var(--line);border-radius:5px;padding:6px 8px;background:#fff}
.storage-identity{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.storage-identity strong{min-width:0;font-size:13px;overflow-wrap:anywhere}
.storage-identity .provider-art{width:32px;height:32px;border-radius:6px}
.storage-identity .storage-spinner{width:22px;height:22px}
.storage-connected{margin-left:auto;flex:none}
.storage-toolbar{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.storage-identity>.icon,.storage-toolbar>.icon,.storage-search>.icon{width:32px;min-width:32px;min-height:32px;padding:6px}
.storage-search{display:flex;flex:1;min-width:0;border:1px solid var(--line);border-radius:5px;overflow:hidden}
.storage-search:focus-within{outline:2px solid var(--green);outline-offset:2px}
.storage-search input{border:0;outline:0;min-height:32px;font-size:12px}
.storage-search input:focus-visible{outline:0}
.storage-search>.icon{flex:none;border:0}
.storage-browser{display:grid;grid-template-rows:minmax(0,1fr) auto;height:min(360px,40dvh);border:1px solid var(--line);border-radius:7px;overflow:hidden}
.storage-empty{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;min-height:0;padding:20px;color:var(--muted)}
.storage-empty>svg{width:28px;height:28px}
.storage-files{min-height:0;overflow:auto;overscroll-behavior:contain;list-style:none;padding:0;margin:0}
.storage-files li{display:flex;align-items:center;gap:8px;padding:2px 8px;border-bottom:1px solid var(--line)}
.storage-files li:last-child{border-bottom:0}
.storage-files li:hover{background:var(--paper)}
.storage-files .storage-file{flex:1;min-width:0;justify-content:flex-start;text-align:left;border:0;background:transparent;padding:7px 4px;font-size:12px}
.storage-file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.storage-file svg{color:var(--green)}
.storage-file:disabled{opacity:1;color:var(--muted)}
.storage-file:disabled svg{color:var(--muted)}
.file-type{max-width:48px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;letter-spacing:.04em;color:var(--muted);background:var(--paper);border-radius:3px;padding:3px 5px;flex:none}
.storage-files .storage-delete{flex:none;border:0;background:transparent;color:var(--muted);opacity:0;pointer-events:none}
.storage-files li:hover .storage-delete,.storage-files li:focus-within .storage-delete{opacity:1;pointer-events:auto}
.storage-delete:hover:not(:disabled){background:#fff0ee;color:#b42318}
.storage-more{display:none;flex:none;border:0;background:transparent;color:var(--muted)}
.storage-file-actions{position:fixed;z-index:1;width:200px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;padding:6px;border:1px solid var(--line);border-radius:7px;background:#fff;box-shadow:0 8px 24px #202a2826}
.storage-file-actions .storage-menu-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;padding:4px 8px 8px;border-bottom:1px solid var(--line)}
.storage-menu-delete{width:100%;min-height:44px;justify-content:flex-start;border:0;background:transparent;color:#b42318;font-size:12px}
.storage-menu-delete:hover:not(:disabled){background:#fff0ee}
.storage-pagination{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-top:1px solid var(--line);background:var(--paper)}
.storage-pagination p{flex:1;text-align:center;font-size:11px!important;font-variant-numeric:tabular-nums}
.storage-pagination .icon{width:28px;min-width:28px;min-height:28px;padding:4px;border:0;background:transparent}
.storage-save{display:flex;align-items:center;gap:8px;margin-top:8px}
.storage-save label{flex:1;min-width:0;flex-direction:row;align-items:center;gap:8px;white-space:nowrap}
.storage-save input{flex:1;width:0}
.storage-save .primary{flex:none;min-height:34px;padding:6px 10px;font-size:12px}
.storage-notice{margin-top:10px!important}
.storage-notice[role=status]{color:var(--green)}
@keyframes storage-spin{to{transform:rotate(360deg)}}
@media(max-width:480px){.personal-storage-dialog{--dialog-padding:12px}.provider-button{min-height:88px;padding:8px 6px}.storage-toolbar{gap:4px}.storage-connected{font-size:9px}}
@media(hover:none),(pointer:coarse){.storage-files .storage-delete{display:none}.storage-more{display:inline-flex;width:44px;min-width:44px;min-height:44px;padding:10px}}
@media(prefers-reduced-motion:reduce){.storage-spinner{animation:none}}
</style>
