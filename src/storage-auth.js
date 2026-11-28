import { LocalizedError } from './i18n.js';
import { missingStorageConfig, storageRequest, createPersonalStorage } from './personal-storage.js';

export function storageCallbackURL(address = globalThis.location.href) {
  return new URL('storage-callback.html', address).href;
}

export function acceptStorageCallback(event, popup, origin, state) {
  return event.source === popup && event.origin === origin && event.data?.type === 'donkanvas-storage-auth' && event.data.state === state;
}

export async function pkcePair() {
  const base64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const verifier = base64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export function connectPersonalStorage(provider, config) {
  const missing = missingStorageConfig(provider, config);
  if (missing.length) return Promise.reject(new LocalizedError('此存储尚未配置：{p0}。请参阅 README 中的个人存储配置。', { p0: missing.join(', ') }));
  if (provider === 'google') return connectGoogle(config);
  const popup = window.open('about:blank', '_blank', 'popup,width=640,height=720');
  if (!popup) return Promise.reject(new LocalizedError('无法打开授权窗口，请允许本站弹出窗口后重试。'));
  return new Promise((resolve, reject) => {
    const state = crypto.randomUUID(), redirect = storageCallbackURL(), origin = location.origin;
    let done = false, setup, verifier;
    const finish = (error, result) => {
      if (done) return;
      done = true; clearInterval(closed); clearTimeout(timeout); window.removeEventListener('message', receive); popup.close();
      if (error) reject(error); else resolve(result);
    };
    const closed = setInterval(() => {
      if (popup.closed) finish(new LocalizedError('已取消个人存储授权。'));
    }, 500);
    const timeout = setTimeout(() => finish(new LocalizedError('个人存储授权超时，请重试。')), 180000);
    async function receive(event) {
      if (!acceptStorageCallback(event, popup, origin, state) || !setup || done) return;
      window.removeEventListener('message', receive);
      clearInterval(closed);
      if (event.data.error) { finish(new LocalizedError('个人存储授权失败：{p0}', { p0: event.data.error })); return; }
      try {
        if (!event.data.code) throw new LocalizedError('个人存储授权未返回授权码。');
        const body = new URLSearchParams({ grant_type: 'authorization_code', code: event.data.code, client_id: setup.clientId, redirect_uri: redirect, code_verifier: verifier });
        if (provider === 'onedrive') body.set('scope', setup.scope);
        const credentials = await (await storageRequest(setup.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })).json();
        finish(null, createPersonalStorage(provider, credentials));
      } catch (error) { finish(error); }
    }
    window.addEventListener('message', receive);
    void (async () => {
      try {
        setup = provider === 'onedrive' ? {
          authorization: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
          token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
          clientId: config.VITE_ONEDRIVE_CLIENT_ID, scope: 'https://graph.microsoft.com/Files.ReadWrite.AppFolder'
        } : {
          authorization: 'https://www.dropbox.com/oauth2/authorize', token: 'https://api.dropboxapi.com/oauth2/token',
          clientId: config.VITE_DROPBOX_CLIENT_ID, scope: 'files.metadata.read files.content.read files.content.write'
        };
        const pair = await pkcePair(); verifier = pair.verifier;
        if (done) return;
        const url = new URL(setup.authorization);
        const params = { response_type: 'code', client_id: setup.clientId, redirect_uri: redirect, scope: setup.scope, state, code_challenge: pair.challenge, code_challenge_method: 'S256' };
        if (provider === 'dropbox') params.token_access_type = 'online';
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        popup.location.replace(url.href);
      } catch (error) { finish(error); }
    })();
  });
}

let googleLoading;
function prepareGoogleStorage() {
  if (!googleLoading) {
    googleLoading = Promise.all([
      loadScript('https://accounts.google.com/gsi/client'),
      loadScript('https://apis.google.com/js/api.js')
    ]).then(() => new Promise((resolve, reject) => {
      window.gapi.load('picker', { callback: resolve, onerror: () => reject(new LocalizedError('Google 文件选择器载入失败。')), timeout: 20000, ontimeout: () => reject(new LocalizedError('Google 文件选择器载入超时。')) });
    })).catch(error => { googleLoading = null; throw error; });
  }
  return googleLoading;
}

const scripts = new Map();
function loadScript(url) {
  if (!scripts.has(url)) scripts.set(url, new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => fail(), 20000);
    function fail() { clearTimeout(timeout); script.remove(); reject(new LocalizedError('个人存储授权组件载入失败，请检查网络后重试。')); }
    script.src = url; script.async = true;
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = fail;
    document.head.append(script);
  }).catch(error => { scripts.delete(url); throw error; }));
  return scripts.get(url);
}

function connectGoogle(config) {
  if (window.google?.accounts?.oauth2 && window.google?.picker) return requestGoogleToken(config);
  return prepareGoogleStorage().then(() => requestGoogleToken(config));
}

function requestGoogleToken(config) {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2 || !window.google?.picker) { reject(new LocalizedError('个人存储授权组件载入失败，请检查网络后重试。')); return; }
    let done = false;
    const finish = (error, storage) => {
      if (done) return;
      done = true; clearTimeout(timeout);
      if (error) reject(error); else resolve(storage);
    };
    const timeout = setTimeout(() => finish(new LocalizedError('个人存储授权超时，请重试。')), 180000);
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: config.VITE_GOOGLE_CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.file',
        callback: response => {
          if (done) return;
          if (response.error) { finish(new LocalizedError('个人存储授权失败：{p0}', { p0: response.error })); return; }
          try {
            const storage = createPersonalStorage('google', response);
            let pickerToken = response.access_token;
            const disconnect = storage.disconnect;
            storage.disconnect = () => { pickerToken = null; disconnect(); };
            storage.pick = () => {
              if (!storage.connected) throw new LocalizedError('个人存储授权已失效，请断开后重新连接；本地修改仍保留。');
              return pickGoogleFile(config, pickerToken);
            };
            finish(null, storage);
          } catch (error) { finish(error); }
        },
        error_callback: error => finish(error.type === 'popup_failed_to_open'
          ? new LocalizedError('无法打开授权窗口，请允许本站弹出窗口后重试。')
          : new LocalizedError('个人存储授权失败：{p0}', { p0: error.type }))
      });
      client.requestAccessToken({ prompt: 'consent' });
    } catch (error) { finish(error); }
  });
}

function pickGoogleFile(config, token) {
  return new Promise(resolve => {
    const api = window.google.picker;
    const picker = new api.PickerBuilder()
      .addView(new api.DocsView(api.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false))
      .setOAuthToken(token).setDeveloperKey(config.VITE_GOOGLE_API_KEY).setAppId(config.VITE_GOOGLE_APP_ID)
      .setOrigin(location.origin)
      .setCallback(data => {
        if (data.action === api.Action.CANCEL) { picker.dispose(); resolve(null); }
        else if (data.action === api.Action.PICKED) { picker.dispose(); resolve({ id: data.docs[0].id, name: data.docs[0].name }); }
      }).build();
    picker.setVisible(true);
  });
}
