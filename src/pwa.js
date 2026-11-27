import { LocalizedError, t, message } from './i18n.js';
import { onUnmounted, ref, shallowRef } from 'vue';

export function usePwaUpdates(studio) {
  const { state } = studio;
  const checkingUpdate = ref(false), installingUpdate = ref(false), updateNotice = ref(null), updateError = ref(false), updateVisible = ref(false), pendingUpdate = shallowRef(null);
  let appDisposed = false;
  onUnmounted(() => { appDisposed = true; });

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
  return { checkingUpdate, installingUpdate, updateNotice, updateError, updateVisible, pendingUpdate, installUpdate, checkUpdate };
}

function waitForState(worker, state, start) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new LocalizedError('更新超时，请检查网络后重试。')), 20000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer); worker.removeEventListener('statechange', changed);
      if (error) reject(error); else resolve(worker);
    }
    function changed() {
      if (worker.state === state) finish();
      else if (worker.state === 'redundant') finish(new LocalizedError('更新安装失败，请重试。'));
    }
    worker.addEventListener('statechange', changed); changed();
    if (!settled && start) {
      try { start(); } catch (error) { finish(error); }
    }
  });
}

async function withUpdateTimeout(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new LocalizedError('更新超时，请检查网络后重试。')), 20000); })
    ]);
  } finally { clearTimeout(timer); }
}

export async function waitForPwaRegistration(container, scope) {
  await withUpdateTimeout(container.ready);
  const registration = await container.getRegistration(scope);
  if (!registration?.active || registration.scope !== scope) throw new LocalizedError('应用尚未完成离线注册，请稍后重试。');
  return registration;
}

export async function checkPwaUpdate(registration) {
  if (registration.waiting) return registration.waiting;
  await withUpdateTimeout(registration.update());
  if (registration.waiting) return registration.waiting;
  const worker = registration.installing;
  if (!worker) return null;
  await waitForState(worker, 'installed');
  return registration.waiting;
}

export async function activatePwaUpdate(worker) {
  await waitForState(worker, 'activated', () => worker.postMessage({ type: 'SKIP_WAITING' }));
}
