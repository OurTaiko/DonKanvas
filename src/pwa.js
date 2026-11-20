import { LocalizedError } from './i18n.js';

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
