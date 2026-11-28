import { LocalizedError } from './i18n.js';

export const STORAGE_PROVIDERS = [
  { id: 'onedrive', name: 'OneDrive', keys: ['VITE_ONEDRIVE_CLIENT_ID'], help: '使用 OneDrive 应用目录；仅支持个人 Microsoft 账户。' },
  { id: 'google', name: 'Google Drive', keys: ['VITE_GOOGLE_CLIENT_ID', 'VITE_GOOGLE_API_KEY', 'VITE_GOOGLE_APP_ID'], help: '列表仅显示已授权的文件；通过 Google 文件选择器授权已有谱面。新文件存入“我的云端硬盘”。' },
  { id: 'dropbox', name: 'Dropbox', keys: ['VITE_DROPBOX_CLIENT_ID'], help: '使用 Dropbox 应用目录；请将已有谱面放入该目录。' }
];
export const MAX_CLOUD_BYTES = 5 * 1024 * 1024;
const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive';
// Drive v2 exposes the file ETag used for conditional content updates.
const DRIVE = 'https://www.googleapis.com/drive/v2/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v2/files';
const conflict = () => new LocalizedError('云端文件已变化，请刷新列表并重新打开，或另存为新文件。');
const invalid = () => new LocalizedError('个人存储返回了无效数据，操作未完成。');

export function missingStorageConfig(id, config) {
  const provider = STORAGE_PROVIDERS.find(item => item.id === id);
  if (!provider) throw invalid();
  return provider.keys.filter(key => !config[key]?.trim());
}

export function secureStorageURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new LocalizedError('个人存储地址必须使用 HTTPS，且不能包含用户名或密码。');
  return url;
}

export async function storageRequest(url, options = {}, request = globalThis.fetch, allowedStatuses = []) {
  let response;
  try {
    response = await request(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(60000), ...options });
  } catch (error) {
    throw new LocalizedError('个人存储网络请求失败，请检查网络、跨域支持或稍后重试：{p0}', { p0: error });
  }
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    if (response.status === 401) throw new LocalizedError('个人存储授权已失效，请断开后重新连接；本地修改仍保留。');
    if (response.status === 409 || response.status === 412) throw conflict();
    if (response.status === 403) throw new LocalizedError('个人存储拒绝访问，请检查授权范围、应用配置或存储额度。');
    throw new LocalizedError('个人存储请求失败（HTTP {p0}），本地修改仍保留。', { p0: response.status });
  }
  return response;
}

function revision(value) {
  if (typeof value !== 'string' || !value) throw invalid();
  return value;
}

function entry(id, name, version) {
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name) throw invalid();
  return { id, name, revision: revision(version) };
}

export function createStorageHandle(storage, original) {
  let current = { ...original };
  return {
    provider: storage.provider,
    get name() { return current.name; },
    get existing() { return Boolean(current.id); },
    async getFile() {
      const result = await storage.read(current);
      current = result.entry;
      return { name: current.name, arrayBuffer: async () => result.bytes };
    },
    async createWritable() {
      const expected = { ...current };
      let blob = null, closed = false;
      return {
        async write(value) {
          if (closed || !(value instanceof Blob)) throw invalid();
          if (value.size > MAX_CLOUD_BYTES) throw new LocalizedError('云端谱面最大为 5 MiB；请使用本地保存。');
          blob = value;
        },
        async close() {
          if (closed || !blob) throw invalid();
          closed = true;
          current = await storage.write(expected, blob);
          blob = null;
        },
        async abort() { closed = true; blob = null; }
      };
    }
  };
}

export function createPersonalStorage(provider, credentials, request = globalThis.fetch) {
  if (!STORAGE_PROVIDERS.some(item => item.id === provider)) throw invalid();
  let token = credentials.access_token;
  const seconds = Number(credentials.expires_in);
  const hasExpiry = credentials.expires_in !== undefined && credentials.expires_in !== null;
  if (typeof token !== 'string' || !token || !hasExpiry || !Number.isFinite(seconds) || seconds <= 0) throw invalid();
  const expires = Date.now() + seconds * 1000;
  let root;
  const authorization = () => {
    if (!token || Date.now() >= expires - 30000) throw new LocalizedError('个人存储授权已失效，请断开后重新连接；本地修改仍保留。');
    return { Authorization: `Bearer ${token}` };
  };
  const call = (url, options = {}, allowedStatuses = []) => storageRequest(url, { ...options, headers: { ...authorization(), ...options.headers } }, request, allowedStatuses);
  const json = async (url, options) => (await call(url, options)).json();
  const dropbox = (method, body) => json(`https://api.dropboxapi.com/2/files/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const microsoftEntry = value => entry(value.id, value.name, value.eTag);
  const googleEntry = value => entry(value.id, value.title, value.etag);
  const dropboxEntry = value => {
    if (typeof value.path_lower !== 'string' || !value.path_lower.startsWith('/')) throw invalid();
    return { ...entry(value.id, value.name, value.rev), path: value.path_lower };
  };
  const microsoftMetadata = id => json(`${GRAPH}/items/${encodeURIComponent(id)}`);
  const microsoftRoot = async () => {
    if (!root) {
      const folder = await json(`${GRAPH}/special/approot`);
      if (typeof folder.id !== 'string' || !folder.id) throw invalid();
      root = folder.id;
    }
    return root;
  };
  const microsoftPageURL = value => {
    const url = secureStorageURL(value);
    if (url.origin !== 'https://graph.microsoft.com') throw invalid();
    return value;
  };
  const googleMetadata = id => json(`${DRIVE}/${encodeURIComponent(id)}?fields=id,title,etag,downloadUrl,fileSize`);
  const ensureSize = size => {
    if (Number(size) > MAX_CLOUD_BYTES) throw new LocalizedError('云端谱面最大为 5 MiB；请使用本地保存。');
  };
  const bytes = async response => {
    ensureSize(response.headers.get('Content-Length'));
    const result = await response.arrayBuffer();
    ensureSize(result.byteLength);
    return result;
  };
  const storage = {
    provider,
    get connected() { return Boolean(token) && Date.now() < expires - 30000; },
    disconnect() { token = null; },
    handle: value => createStorageHandle(storage, value),
    async list() {
      const entries = [];
      if (provider === 'onedrive') {
        return (await storage.listPage()).entries;
      } else if (provider === 'google') {
        let pageToken = '';
        do {
          const query = new URLSearchParams({ q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'", maxResults: '1000', fields: 'items(id,title,etag),nextPageToken', pageToken });
          const page = await json(`${DRIVE}?${query}`);
          if (!Array.isArray(page.items)) throw invalid();
          entries.push(...page.items.map(googleEntry));
          pageToken = page.nextPageToken;
        } while (pageToken);
      } else {
        let page = await dropbox('list_folder', { path: '', recursive: false });
        while (true) {
          if (!Array.isArray(page.entries)) throw invalid();
          entries.push(...page.entries.filter(value => value['.tag'] === 'file').map(dropboxEntry));
          if (!page.has_more) break;
          page = await dropbox('list_folder/continue', { cursor: page.cursor });
        }
      }
      return entries.sort((a, b) => a.name.localeCompare(b.name));
    },
    async delete(value) {
      authorization();
      if (typeof value.id !== 'string' || !value.id) throw invalid();
      const version = revision(value.revision);
      if (provider === 'onedrive') {
        await call(`${GRAPH}/items/${encodeURIComponent(value.id)}`, { method: 'DELETE', headers: { 'If-Match': version } });
      } else if (provider === 'google') {
        await call(`${DRIVE}/${encodeURIComponent(value.id)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': version },
          body: JSON.stringify({ labels: { trashed: true } })
        });
      } else {
        await dropbox('delete_v2', { path: value.id, parent_rev: version });
      }
    },
    async read(value) {
      authorization();
      if (provider === 'onedrive') {
        const before = await microsoftMetadata(value.id);
        ensureSize(before.size);
        const downloadURL = secureStorageURL(before['@microsoft.graph.downloadUrl']);
        const content = await bytes(await storageRequest(downloadURL, {}, request));
        const after = await microsoftMetadata(value.id);
        if (before.eTag !== after.eTag) throw conflict();
        return { entry: microsoftEntry(after), bytes: content };
      }
      if (provider === 'google') {
        const before = await googleMetadata(value.id);
        ensureSize(before.fileSize);
        const url = secureStorageURL(before.downloadUrl);
        if (url.origin !== 'https://www.googleapis.com') throw invalid();
        const content = await bytes(await call(url));
        const after = await googleMetadata(value.id);
        if (before.etag !== after.etag) throw conflict();
        return { entry: googleEntry(after), bytes: content };
      }
      const response = await call('https://content.dropboxapi.com/2/files/download', {
        method: 'POST', headers: { 'Dropbox-API-Arg': asciiJSON({ path: value.id }) }
      });
      const metadata = JSON.parse(response.headers.get('Dropbox-API-Result'));
      if (!metadata) throw invalid();
      return { entry: dropboxEntry(metadata), bytes: await bytes(response) };
    },
    async write(value, blob) {
      ensureSize(blob.size);
      authorization();
      if (provider === 'onedrive') {
        if (!root) throw invalid();
        const path = value.id ? `/items/${encodeURIComponent(value.id)}` : `/items/${encodeURIComponent(root)}:/${encodeURIComponent(value.name)}:`;
        const session = await json(`${GRAPH}${path}/createUploadSession`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(value.id ? { 'If-Match': revision(value.revision) } : {}) },
          body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': value.id ? 'replace' : 'fail', name: value.name } })
        });
        const uploadURL = secureStorageURL(session.uploadUrl);
        try {
          const result = await storageRequest(uploadURL, {
            method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes 0-${blob.size - 1}/${blob.size}` }, body: blob
          }, request);
          return microsoftEntry(await result.json());
        } catch (error) {
          try { await storageRequest(uploadURL, { method: 'DELETE' }, request); }
          catch (cleanupError) { throw new LocalizedError('{p0}；中止上传失败：{p1}', { p0: error, p1: cleanupError }); }
          throw error;
        }
      }
      if (provider === 'google') {
        if (value.id) {
          return googleEntry(await json(`${UPLOAD}/${encodeURIComponent(value.id)}?uploadType=media&fields=id,title,etag`, {
            method: 'PUT', headers: { 'Content-Type': blob.type, 'If-Match': revision(value.revision) }, body: blob
          }));
        }
        const boundary = `donkanvas_${crypto.randomUUID()}`;
        const body = new Blob([
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
          JSON.stringify({ title: value.name, mimeType: 'text/plain' }),
          `\r\n--${boundary}\r\nContent-Type: ${blob.type}\r\n\r\n`, blob, `\r\n--${boundary}--\r\n`
        ]);
        return googleEntry(await json(`${UPLOAD}?uploadType=multipart&fields=id,title,etag`, {
          method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
        }));
      }
      const response = await call('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST', headers: {
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': asciiJSON({ path: value.id ? value.path : `/${value.name}`, mode: value.id ? { '.tag': 'update', update: revision(value.revision) } : { '.tag': 'add' }, autorename: false, strict_conflict: true, mute: true })
        }, body: blob
      });
      return dropboxEntry(await response.json());
    }
  };
  if (provider === 'onedrive') {
    storage.listPage = async ({ cursor = null, query = '' } = {}) => {
      const folderId = await microsoftRoot();
      let url = cursor ? cursor.url : `${GRAPH}/items/${encodeURIComponent(folderId)}/children?$top=10&$orderby=name`;
      const matches = [...(cursor?.pending ?? [])], search = query.trim().toLowerCase();
      while (matches.length < 10 && url) {
        const page = await json(microsoftPageURL(url));
        if (!Array.isArray(page.value)) throw invalid();
        matches.push(...page.value.filter(value => value.file).map(microsoftEntry).filter(value => value.name.toLowerCase().includes(search)));
        url = page['@odata.nextLink'] ? microsoftPageURL(page['@odata.nextLink']) : null;
      }
      const pending = matches.slice(10);
      return { entries: matches.slice(0, 10), nextCursor: url || pending.length ? { url, pending } : null };
    };
    storage.findByName = async name => {
      const folderId = await microsoftRoot();
      const response = await call(`${GRAPH}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}`, {}, [404]);
      if (response.status === 404) return null;
      const value = await response.json();
      if (!value.file) throw new LocalizedError('云端同名项目不是谱面文件，请使用新文件名。');
      return microsoftEntry(value);
    };
  }
  return storage;
}

function asciiJSON(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
