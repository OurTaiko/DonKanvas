import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse, compileScript } from 'vue/compiler-sfc';
import { computed, nextTick, ref, shallowReactive, watch } from 'vue';
import { t, LocalizedError } from './i18n.js';
import { translations } from './locales.js';
import { STORAGE_PROVIDERS, createPersonalStorage, createStorageHandle, missingStorageConfig, secureStorageURL, storageRequest, MAX_CLOUD_BYTES } from './personal-storage.js';
import { acceptStorageCallback, pkcePair, storageCallbackURL, connectPersonalStorage } from './storage-auth.js';

const credentials = { access_token: 'test-token', expires_in: 3600 };
const response = (value, status = 200, headers = {}) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers });
const blob = () => new Blob(['\ufeffTITLE:Cloud\nBPM:120\n'], { type: 'text/plain;charset=utf-8' });

function storageDialogModel(storage, studio = { state: { activeId: 1, filename: 'new.tja' } }, confirm = () => true, auth = {}) {
  const notices = [];
  const { descriptor } = parse(readFileSync(new URL('PersonalStorage.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content.replace(/^import .*;\r?\n/gm, '').replace('import.meta.env', '{}');
  const model = runInNewContext(`${script}; ({ dialog, choosing, mode, entries, query, page, pageCount, pageEntries, filteredEntries, remotePages, appliedQuery, canNext, listEnd, error, busy, deletedName, authorizedName, actionEntry, actionTrigger, actionMenu, actionPosition, openFileActions, closeFileActions, dismissFileActions, providerId, connections, filename, open, close, chooseProvider, chooseStorage, refresh, disconnect, saveNew, openEntry, saveEntry, deleteEntry, pickGoogle, nextPage, previousPage, searchFiles })`, {
    computed, nextTick, ref, shallowReactive, watch, inject: () => ({
      ...studio, notice(message, error) { notices.push({ message, error }); studio.notice?.(message, error); }
    }),
    STORAGE_PROVIDERS, missingStorageConfig: () => [],
    connectPersonalStorage: async () => storage, defineExpose() {},
    onMounted() {}, onUnmounted() {},
    onedriveIcon: 'cloud-storage.svg', googleIcon: 'google.png', dropboxIcon: 'dropbox.svg',
    t, LocalizedError, confirm, ...auth
  });
  model.dialog.value = { showModal() {}, close() {} };
  model.connections.set('onedrive', storage);
  model.notices = notices;
  return model;
}

test('personal storage displays exactly ten files per page and searches every page case-insensitively before paginating', () => {
  const model = storageDialogModel({});
  model.entries.value = Array.from({ length: 21 }, (_, index) => ({ id: `${index}`, name: `song-${String(index + 1).padStart(2, '0')}.tja` }));
  assert.equal(model.pageCount.value, 3);
  assert.deepEqual(model.pageEntries.value.map(item => item.id), model.entries.value.slice(0, 10).map(item => item.id));
  model.page.value = 2;
  assert.equal(model.pageEntries.value.length, 10);
  assert.equal(model.pageEntries.value[0].id, '10');
  model.page.value = 3;
  assert.deepEqual(model.pageEntries.value.map(item => item.id), ['20']);
  model.query.value = ' SONG-21 ';
  assert.equal(model.page.value, 1);
  assert.equal(model.pageCount.value, 1);
  assert.deepEqual(model.pageEntries.value.map(item => item.id), ['20']);
  model.query.value = 'song-';
  assert.equal(model.pageEntries.value.length, 10);
  model.page.value = 2;
  model.query.value = 'SONG-';
  assert.equal(model.page.value, 1);
  model.query.value = '不存在';
  assert.equal(model.filteredEntries.value.length, 0);
  assert.equal(model.pageEntries.value.length, 0);
  assert.equal(model.pageCount.value, 1);
  model.query.value = '';
  assert.equal(model.pageCount.value, 3);
});

test('touch file menus toggle one file at a time, fit the viewport, dismiss outside and restore trigger focus on Escape', async () => {
  const model = storageDialogModel({}, undefined, undefined, { window: { innerWidth: 320, innerHeight: 600 } });
  const inside = {}, outside = {};
  let menuFocus = 0, triggerFocus = 0, dialogCloses = 0;
  const trigger = { isConnected: true, getBoundingClientRect: () => ({ right: 315, top: 560, bottom: 590 }), contains: target => target === trigger, focus() { triggerFocus++; } };
  model.dialog.value.close = () => { dialogCloses++; };
  model.actionMenu.value = { getBoundingClientRect: () => ({ width: 200, height: 90 }), querySelector: () => ({ focus() { menuFocus++; } }), contains: target => target === inside };
  await model.openFileActions({ id: 'first', name: 'first.mp3' }, { currentTarget: trigger });
  assert.equal(model.actionEntry.value.id, 'first');
  assert.equal(menuFocus, 1);
  const left = Number.parseFloat(model.actionPosition.value.left), top = Number.parseFloat(model.actionPosition.value.top);
  assert.ok(left >= 12 && left + 200 <= 308);
  assert.ok(top >= 12 && top + 90 < 560);
  model.dismissFileActions({ target: inside });
  assert.equal(model.actionEntry.value.id, 'first');
  await model.openFileActions({ id: 'second', name: 'second.mp3' }, { currentTarget: trigger });
  assert.equal(model.actionEntry.value.id, 'second');
  model.dismissFileActions({ target: outside });
  assert.equal(model.actionEntry.value, null);
  assert.equal(triggerFocus, 0);
  await model.openFileActions({ id: 'first', name: 'first.mp3' }, { currentTarget: trigger });
  model.close();
  assert.equal(model.actionEntry.value, null);
  assert.equal(triggerFocus, 1);
  assert.equal(dialogCloses, 0);
  await model.openFileActions({ id: 'first', name: 'first.mp3' }, { currentTarget: trigger });
  await model.openFileActions({ id: 'first', name: 'first.mp3' }, { currentTarget: trigger });
  assert.equal(model.actionEntry.value, null);
  assert.equal(triggerFocus, 2);
});

test('touch menus close when file pages or searches change and cannot open while storage is busy', async () => {
  const model = storageDialogModel({});
  model.entries.value = Array.from({ length: 11 }, (_, index) => ({ id: `${index}`, name: `${index}.tja` }));
  await model.openFileActions(model.entries.value[0], { currentTarget: {} });
  assert.equal(model.actionEntry.value.id, '0');
  model.page.value = 2;
  assert.equal(model.actionEntry.value, null);
  await model.openFileActions(model.entries.value[10], { currentTarget: {} });
  model.query.value = 'missing';
  assert.equal(model.actionEntry.value, null);
  model.busy.value = true;
  await model.openFileActions({ id: 'x', name: 'x.mp3' }, { currentTarget: {} });
  assert.equal(model.actionEntry.value, null);
});

test('opening a touch menu never deletes; menu deletion still requires confirmation and does not focus a removed file row', async () => {
  const file = { id: 'audio', name: 'audio.mp3' };
  let files = [file], confirmed = false, deletes = 0, focused = 0;
  const trigger = { isConnected: true, focus() { focused++; } };
  const storage = {
    list: async () => files,
    delete: async () => { deletes++; files = []; trigger.isConnected = false; }
  };
  const model = storageDialogModel(storage, undefined, () => confirmed);
  await model.refresh();
  await model.openFileActions(file, { currentTarget: trigger });
  assert.equal(deletes, 0);
  await model.deleteEntry(model.actionEntry.value);
  assert.equal(deletes, 0);
  assert.equal(model.actionEntry.value, null);
  assert.equal(focused, 1);
  confirmed = true;
  await model.openFileActions(file, { currentTarget: trigger });
  await model.deleteEntry(model.actionEntry.value);
  assert.equal(deletes, 1);
  assert.equal(model.actionEntry.value, null);
  assert.equal(model.entries.value.length, 0);
  assert.equal(focused, 1);
});

test('provider buttons authorize immediately, lock selection during authorization and reuse a live connection only after an explicit provider choice', async () => {
  let finishAuth, authCalls = 0, lists = 0, closes = 0;
  const storage = { connected: true, list: async () => { lists++; return [{ id: 'chart', name: 'chart.tja' }]; } };
  const model = storageDialogModel(storage, undefined, undefined, {
    connectPersonalStorage: id => {
      authCalls++; assert.equal(id, 'dropbox'); assert.equal(model.busy.value, true);
      return new Promise(resolve => { finishAuth = resolve; });
    }
  });
  model.connections.clear();
  model.dialog.value.close = () => { closes++; };
  model.open('save');
  assert.equal(model.choosing.value, true);
  assert.equal(lists, 0);
  const authorization = model.chooseProvider('dropbox');
  assert.equal(authCalls, 1);
  assert.equal(model.providerId.value, 'dropbox');
  assert.equal(model.busy.value, true);
  assert.equal(model.choosing.value, true);
  await model.chooseProvider('onedrive');
  model.chooseStorage(); model.close();
  assert.equal(model.providerId.value, 'dropbox');
  assert.equal(authCalls, 1);
  assert.equal(closes, 0);
  finishAuth(storage);
  await authorization;
  assert.equal(model.busy.value, false);
  assert.equal(model.choosing.value, false);
  assert.equal(model.mode.value, 'save');
  assert.equal(model.pageEntries.value[0].id, 'chart');
  model.chooseStorage();
  assert.equal(model.choosing.value, true);
  assert.equal(model.entries.value.length, 0);
  await model.chooseProvider('dropbox');
  assert.equal(authCalls, 1);
  assert.equal(lists, 2);
  model.open();
  assert.equal(model.choosing.value, true);
  assert.equal(lists, 2);
});

test('configuration and authorization failures retain the provider chooser, surface the error and unlock retry', async () => {
  let authCalls = 0, fail = true;
  const storage = { connected: true, list: async () => [] };
  const model = storageDialogModel(storage, undefined, undefined, {
    missingStorageConfig: id => id === 'google' ? ['VITE_GOOGLE_CLIENT_ID'] : [],
    connectPersonalStorage: async () => { authCalls++; if (fail) throw new Error('Authorization cancelled'); return storage; }
  });
  model.connections.clear();
  await model.chooseProvider('google');
  assert.equal(authCalls, 0);
  assert.match(model.error.value.message, /VITE_GOOGLE_CLIENT_ID/);
  assert.equal(model.choosing.value, true);
  assert.equal(model.busy.value, false);
  await model.chooseProvider('onedrive');
  assert.equal(model.error.value.message, 'Authorization cancelled');
  assert.equal(model.choosing.value, true);
  assert.equal(model.busy.value, false);
  assert.equal(model.connections.size, 0);
  assert.equal(model.notices.length, 2);
  assert.match(model.notices[0].message.message, /VITE_GOOGLE_CLIENT_ID/);
  assert.equal(model.notices[1].message, model.error.value);
  assert.ok(model.notices.every(item => item.error === true));
  fail = false;
  await model.chooseProvider('onedrive');
  assert.equal(authCalls, 2);
  assert.equal(model.error.value, null);
  assert.equal(model.choosing.value, false);
  assert.equal(model.notices.length, 2);
});

test('Google clicks run loading and authorization as one busy flow and retry failures through the same provider button', async () => {
  let finish, authCalls = 0;
  const storage = { connected: true, list: async () => [] };
  const model = storageDialogModel(storage, undefined, undefined, {
    connectPersonalStorage: id => {
      assert.equal(id, 'google'); authCalls++;
      return new Promise((resolve, reject) => { finish = { resolve, reject }; });
    }
  });
  model.connections.clear();
  model.open();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(authCalls, 0);
  assert.equal(model.error.value, null);
  assert.equal(model.busy.value, false);
  const first = model.chooseProvider('google');
  assert.equal(authCalls, 1);
  assert.equal(model.busy.value, true);
  assert.equal(model.providerId.value, 'google');
  await model.chooseProvider('onedrive');
  assert.equal(authCalls, 1);
  finish.reject(new Error('Component load failed'));
  await first;
  assert.equal(model.error.value.message, 'Component load failed');
  assert.equal(model.notices.length, 1);
  assert.equal(model.notices[0].message, model.error.value);
  assert.equal(model.notices[0].error, true);
  assert.equal(model.choosing.value, true);
  assert.equal(model.busy.value, false);
  const retry = model.chooseProvider('google');
  assert.equal(authCalls, 2);
  assert.equal(model.error.value, null);
  assert.equal(model.busy.value, true);
  finish.resolve(storage);
  await retry;
  assert.equal(model.choosing.value, false);
  assert.equal(model.busy.value, false);
  model.chooseStorage();
  await model.chooseProvider('google');
  assert.equal(authCalls, 2);
  assert.equal(model.notices.length, 1);
});

test('personal storage list, deletion and picker failures report global errors once and leave retry available', async () => {
  const cause = new Error('Storage request failed');
  let fail = true;
  const request = async () => { if (fail) throw cause; return []; };
  const storage = { list: request, delete: request, pick: request };
  const model = storageDialogModel(storage);
  for (const action of [() => model.refresh(), () => model.deleteEntry({ id: 'file', name: 'file.tja' }), () => model.pickGoogle()]) {
    const count = model.notices.length;
    await action();
    assert.equal(model.notices.length, count + 1);
    assert.equal(model.notices.at(-1).message, cause);
    assert.equal(model.notices.at(-1).error, true);
    assert.equal(model.busy.value, false);
  }
  fail = false;
  await model.refresh();
  assert.equal(model.error.value, null);
  assert.equal(model.notices.length, 3);
});

test('personal storage does not duplicate editor-reported transfer errors or turn overwrite cancellations into errors', async () => {
  const file = { id: 'chart', name: 'chart.tja' }, messages = [];
  let fail = true, isOpen = false;
  const studio = {
    state: { activeId: 1, filename: 'chart.tja' },
    chartFilename: value => value,
    notice(message, error = false) { if (error) messages.push(message); },
    openStorageChart: async () => { studio.notice(new Error('Open failed'), true); return false; },
    saveToStorage: async () => { studio.notice(fail ? new Error('Save failed') : 'Overwrite cancelled', fail); return false; }
  };
  const storage = { handle: value => value, pick: async () => file };
  const model = storageDialogModel(storage, studio);
  model.dialog.value = { showModal() { isOpen = true; }, close() { isOpen = false; } };
  model.open();
  const actions = [() => model.openEntry(file), () => model.saveEntry(file), () => model.saveNew(), () => model.pickGoogle()];
  for (const action of actions) {
    const count = messages.length;
    await action();
    assert.equal(messages.length, count + 1);
    assert.equal(isOpen, true);
    assert.equal(model.busy.value, false);
  }
  model.mode.value = 'save';
  await model.pickGoogle();
  assert.equal(messages.length, 5);
  fail = false;
  for (const action of [() => model.saveEntry(file), () => model.saveNew(), () => model.pickGoogle()]) await action();
  assert.equal(messages.length, 5);
  assert.equal(model.notices.length, 0);
  assert.equal(isOpen, true);
  assert.equal(model.busy.value, false);
});

test('refresh clamps shrinking pages and preserves searches; switching storage resets search and saving still detects files outside the visible page', async () => {
  let entries = Array.from({ length: 21 }, (_, index) => ({ id: `${index}`, name: `song-${index + 1}.tja` }));
  let saved;
  const storage = { list: async () => entries, handle: value => value, disconnect() {} };
  const studio = {
    state: { activeId: 1, filename: 'new.tja' },
    chartFilename: value => value,
    saveToStorage: async handle => { saved = handle; return true; }
  };
  const model = storageDialogModel(storage, studio);
  model.open('save');
  await model.chooseProvider('onedrive');
  model.page.value = 3;
  entries = entries.slice(0, 11);
  await model.refresh();
  assert.equal(model.page.value, 2);
  assert.equal(model.pageEntries.value.length, 1);
  model.query.value = 'song-11';
  await model.refresh();
  assert.equal(model.query.value, 'song-11');
  assert.equal(model.pageEntries.value[0].id, '10');
  model.query.value = 'song-1.tja';
  model.filename.value = 'song-11.tja';
  await model.saveNew();
  assert.equal(saved.id, '10');
  assert.equal(saved.name, 'song-11.tja');
  model.providerId.value = 'dropbox';
  await nextTick();
  assert.equal(model.query.value, '');
  assert.equal(model.page.value, 1);
  assert.equal(model.entries.value.length, 0);
  model.providerId.value = 'onedrive';
  await model.chooseProvider('onedrive');
  model.query.value = 'song-';
  model.page.value = 2;
  model.open();
  await model.chooseProvider('onedrive');
  assert.equal(model.page.value, 1);
  assert.equal(model.query.value, '');
  model.query.value = 'song-';
  model.page.value = 2;
  model.disconnect();
  assert.equal(model.page.value, 1);
  assert.equal(model.query.value, '');
  assert.equal(model.entries.value.length, 0);
});

test('OneDrive requests ten directory items on demand, caches previous pages and fetches the final short page only on navigation', async () => {
  const calls = [];
  const files = Array.from({ length: 21 }, (_, index) => ({ id: `${index}`, name: `song-${index}.tja`, eTag: `"${index}"`, file: {} }));
  const storage = createPersonalStorage('onedrive', credentials, async url => {
    calls.push(String(url));
    if (String(url).endsWith('/special/approot')) return response({ id: 'app' });
    const params = new URL(url).searchParams;
    assert.equal(params.get('$top'), '10');
    const start = Number(params.get('$skiptoken') || 0);
    return response({
      value: files.slice(start, start + 10),
      ...(start + 10 < files.length ? { '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/drive/items/app/children?$top=10&$skiptoken=${start + 10}` } : {})
    });
  });
  const model = storageDialogModel(storage);
  model.open();
  await model.chooseProvider('onedrive');
  assert.equal(model.error.value, null);
  assert.equal(calls.length, 2);
  assert.equal(model.pageEntries.value.length, 10);
  assert.equal(model.canNext.value, true);
  await model.nextPage();
  assert.equal(calls.length, 3);
  assert.equal(model.page.value, 2);
  assert.equal(model.pageEntries.value[0].id, '10');
  model.previousPage();
  await model.nextPage();
  assert.equal(calls.length, 3);
  await model.nextPage();
  assert.equal(calls.length, 4);
  assert.equal(model.page.value, 3);
  assert.equal(model.pageEntries.value.length, 1);
  assert.equal(model.canNext.value, false);
  await model.nextPage();
  assert.equal(calls.length, 4);
  await model.refresh();
  assert.equal(calls.length, 5);
  assert.equal(model.page.value, 1);
  assert.equal(model.remotePages.value.length, 1);
  await model.nextPage();
  assert.equal(calls.length, 6);
});

test('OneDrive filename search scans only enough ten-item batches to fill a page and retains surplus matches without losing files', async () => {
  const file = id => ({ id: `${id}`, name: `Song-${id}.TJA`, eTag: `"${id}"`, file: {} });
  const rawPages = [
    [{ name: 'folder.tja', folder: {} }, { ...file('audio'), name: 'ignore.mp3' }, ...Array.from({ length: 5 }, (_, index) => ({ ...file(`other${index}`), name: `other-${index}.tja` })), file(0), file(1), file(2)],
    Array.from({ length: 10 }, (_, index) => file(index + 3)),
    Array.from({ length: 10 }, (_, index) => index < 2 ? file(index + 13) : { ...file(`text${index}`), name: `ignore-${index}.txt` })
  ];
  const calls = [];
  const storage = createPersonalStorage('onedrive', credentials, async url => {
    calls.push(String(url));
    if (String(url).endsWith('/special/approot')) return response({ id: 'app' });
    const params = new URL(url).searchParams;
    assert.equal(params.get('$top'), '10');
    const index = Number(params.get('$skiptoken') || 0);
    return response({ value: rawPages[index], ...(index < 2 ? { '@odata.nextLink': `https://graph.microsoft.com/next?$top=10&$skiptoken=${index + 1}` } : {}) });
  });
  const first = await storage.listPage({ query: ' SONG- ' });
  assert.equal(calls.length, 3);
  assert.deepEqual(first.entries.map(item => item.id), Array.from({ length: 10 }, (_, index) => `${index}`));
  assert.equal(first.nextCursor.pending.length, 3);
  const second = await storage.listPage({ cursor: first.nextCursor, query: ' SONG- ' });
  assert.equal(calls.length, 4);
  assert.deepEqual(second.entries.map(item => item.id), ['10', '11', '12', '13', '14']);
  assert.equal(second.nextCursor, null);
  const empty = await storage.listPage({ query: 'missing' });
  assert.equal(calls.length, 7);
  assert.deepEqual(empty, { entries: [], nextCursor: null });

  const untrustedCalls = [];
  const untrusted = createPersonalStorage('onedrive', credentials, async url => {
    untrustedCalls.push(String(url));
    return String(url).endsWith('/special/approot') ? response({ id: 'app' }) : response({
      value: rawPages[1], '@odata.nextLink': 'https://other.example/next'
    });
  });
  await assert.rejects(untrusted.listPage(), /无效数据/);
  assert.equal(untrustedCalls.length, 2);
});

test('OneDrive dialog commits searches explicitly, preserves pages on failures, retries and handles trailing empty results without inventing a page', async () => {
  const first = Array.from({ length: 10 }, (_, index) => ({ id: `${index}`, name: `song-${index}.tja` }));
  const calls = [];
  let failNext = true, failSearch = false;
  const storage = { listPage: async ({ cursor = null, query = '' }) => {
    calls.push({ cursor, query });
    if (query && failSearch) throw new Error('Search failed');
    if (query) return { entries: [{ id: 'off-page', name: 'TARGET.tja' }], nextCursor: null };
    if (!cursor) return { entries: first, nextCursor: { url: 'second' } };
    if (failNext) { failNext = false; throw new Error('Next failed'); }
    if (cursor.url === 'second') return { entries: [{ id: 'last', name: 'last.tja' }], nextCursor: { url: 'empty' } };
    return { entries: [], nextCursor: null };
  }, disconnect() {} };
  const model = storageDialogModel(storage);
  await model.refresh();
  await model.nextPage();
  assert.equal(model.error.value.message, 'Next failed');
  assert.equal(model.page.value, 1);
  assert.equal(model.pageEntries.value.length, 10);
  assert.equal(model.canNext.value, true);
  assert.equal(model.busy.value, false);
  await model.nextPage();
  assert.equal(model.error.value, null);
  assert.equal(model.page.value, 2);
  await model.nextPage();
  assert.equal(model.page.value, 2);
  assert.equal(model.pageEntries.value[0].id, 'last');
  assert.equal(model.canNext.value, false);
  assert.equal(model.listEnd.value, true);
  model.query.value = ' TARGET ';
  assert.equal(calls.length, 4);
  assert.equal(model.page.value, 2);
  assert.equal(model.appliedQuery.value, '');
  failSearch = true;
  await model.searchFiles();
  assert.equal(model.error.value.message, 'Search failed');
  assert.equal(model.page.value, 2);
  assert.equal(model.pageEntries.value[0].id, 'last');
  assert.equal(model.appliedQuery.value, '');
  failSearch = false;
  await model.searchFiles();
  assert.equal(model.page.value, 1);
  assert.equal(model.pageEntries.value[0].id, 'off-page');
  assert.equal(model.appliedQuery.value, 'TARGET');
  assert.equal(model.remotePages.value.length, 1);
  await model.refresh();
  assert.equal(calls.at(-1).query, 'TARGET');
  assert.equal(model.query.value, ' TARGET ');
  model.disconnect();
  assert.equal(model.remotePages.value.length, 0);
  assert.equal(model.appliedQuery.value, '');
});

test('OneDrive saving looks up off-page names directly and surfaces lookup failures instead of creating a duplicate', async () => {
  const calls = [];
  let lookupStatus = 200, saved;
  const storage = createPersonalStorage('onedrive', credentials, async url => {
    calls.push(String(url));
    if (String(url).endsWith('/special/approot')) return response({ id: 'app' });
    if (String(url).includes('/children?')) return response({ value: [] });
    assert.ok(String(url).endsWith('/items/app:/OFF%20PAGE.tja'));
    return response({ id: 'off-page', name: 'off page.tja', file: {}, eTag: '"off-page"' }, lookupStatus);
  });
  const studio = {
    state: { activeId: 1, filename: 'OFF PAGE.tja' },
    chartFilename: value => value,
    saveToStorage: async handle => { saved = handle; return true; }
  };
  const model = storageDialogModel(storage, studio);
  model.open('save');
  await model.chooseProvider('onedrive');
  assert.equal(model.entries.value.length, 0);
  await model.saveNew();
  assert.equal(saved.existing, true);
  assert.equal(saved.name, 'off page.tja');
  assert.equal(calls.length, 3);
  saved = null; lookupStatus = 403;
  await model.saveNew();
  assert.equal(saved, null);
  assert.match(model.error.value.message, /拒绝访问/);
  lookupStatus = 404;
  await model.saveNew();
  assert.equal(saved.existing, false);
  assert.equal(saved.name, 'OFF PAGE.tja');
});

test('OneDrive paginates app-folder charts, reads a stable version and uploads with a version precondition without leaking authorization to download/upload hosts', async () => {
  const calls = [];
  const original = { id: 'file', name: 'song.tja', eTag: '"v1"', size: 20, file: {}, '@microsoft.graph.downloadUrl': 'https://download.example/song' };
  const updated = { ...original, eTag: '"v2"' };
  const answers = [
    response({ id: 'app' }),
    response({ value: [original, { id: 'audio', name: 'ignore.mp3', eTag: '"audio"', file: {} }], '@odata.nextLink': 'https://graph.microsoft.com/next' }),
    response({ value: [] }),
    response(original), response('TITLE:Cloud\nBPM:120\n'), response(original),
    response({ uploadUrl: 'https://upload.example/session' }), response(updated)
  ];
  const storage = createPersonalStorage('onedrive', credentials, async (url, options) => {
    calls.push({ url: String(url), options }); return answers.shift();
  });
  const list = await storage.list();
  assert.deepEqual(list, [{ id: 'file', name: 'song.tja', revision: '"v1"' }, { id: 'audio', name: 'ignore.mp3', revision: '"audio"' }]);
  const handle = storage.handle(list[0]);
  assert.match(new TextDecoder().decode(await (await handle.getFile()).arrayBuffer()), /TITLE:Cloud/);
  const writable = await handle.createWritable(); await writable.write(blob()); await writable.close();
  assert.equal(calls[6].options.headers['If-Match'], '"v1"');
  assert.equal(calls[4].options.headers?.Authorization, undefined);
  assert.equal(calls[7].options.headers?.Authorization, undefined);
  assert.equal(calls[7].options.headers['Content-Range'], `bytes 0-${blob().size - 1}/${blob().size}`);
  assert.equal(calls[7].options.credentials, 'omit');
  assert.equal(await calls[7].options.body.text(), await blob().text());
});

test('OneDrive new uploads fail on name collisions, unstable reads fail, and unexpected pagination origins never receive tokens', async () => {
  const calls = [];
  let answers = [
    response({ id: 'app' }), response({ value: [] }),
    response({ uploadUrl: 'https://upload.example/session' }), response({ id: 'new', name: 'new.tja', eTag: '"created"' })
  ];
  const storage = createPersonalStorage('onedrive', credentials, async (url, options) => { calls.push({ url: String(url), options }); return answers.shift(); });
  await storage.list();
  const writer = await storage.handle({ id: null, name: 'new.tja' }).createWritable();
  await writer.write(blob()); await writer.close();
  assert.equal(JSON.parse(calls[2].options.body).item['@microsoft.graph.conflictBehavior'], 'fail');
  answers = [
    response({ id: 'x', name: 'x.tja', eTag: '"before"', '@microsoft.graph.downloadUrl': 'https://download.example/x' }),
    response('text'),
    response({ id: 'x', name: 'x.tja', eTag: '"after"' })
  ];
  await assert.rejects(storage.read({ id: 'x' }), /云端文件已变化/);
  answers = [response({ id: 'app' }), response({ value: [], '@odata.nextLink': 'https://other.example/list' })];
  await assert.rejects(storage.list(), /无效数据/);
  assert.ok(!calls.some(call => call.url.startsWith('https://other.example')));
});

test('all personal storage providers list non-TJA files while excluding folders', async () => {
  const cases = [
    ['onedrive', [
      { id: 'app' },
      { value: [{ id: 'chart', name: 'chart.tja', eTag: '"chart"', file: {} }, { id: 'audio', name: 'audio.mp3', eTag: '"audio"', file: {} }, { id: 'folder', name: 'folder.tja', eTag: '"folder"', folder: {} }] }
    ]],
    ['google', [{ items: [{ id: 'chart', title: 'chart.tja', etag: '"chart"' }, { id: 'audio', title: 'audio.mp3', etag: '"audio"' }] }]],
    ['dropbox', [{ entries: [{ id: 'chart', name: 'chart.tja', rev: 'chart', path_lower: '/chart.tja', '.tag': 'file' }, { id: 'audio', name: 'audio.mp3', rev: 'audio', path_lower: '/audio.mp3', '.tag': 'file' }, { id: 'folder', name: 'folder.tja', '.tag': 'folder' }], has_more: false }]]
  ];
  for (const [provider, answers] of cases) {
    const storage = createPersonalStorage(provider, credentials, async url => {
      if (provider === 'google') assert.match(new URL(url).searchParams.get('q'), /mimeType != 'application\/vnd.google-apps.folder'/);
      return response(answers.shift());
    });
    assert.deepEqual((await storage.list()).map(item => item.name).sort(), ['audio.mp3', 'chart.tja'], provider);
  }
});

test('file deletion uses provider version preconditions, trashes Google files and surfaces conflicts or expired authorization', async () => {
  for (const provider of ['onedrive', 'google', 'dropbox']) {
    const calls = [];
    let status = 200;
    const storage = createPersonalStorage(provider, credentials, async (url, options) => {
      calls.push({ url: String(url), options });
      return provider === 'dropbox' ? response({ metadata: {} }, status) : status === 200 ? new Response(null, { status: 204 }) : response({}, status);
    });
    const item = { id: 'file', name: '音 楽.mp3', revision: '"version"' };
    await storage.delete(item);
    assert.equal(calls.length, 1, provider);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token', provider);
    if (provider === 'dropbox') {
      assert.equal(calls[0].options.method, 'POST');
      assert.match(calls[0].url, /\/files\/delete_v2$/);
      assert.deepEqual(JSON.parse(calls[0].options.body), { path: 'file', parent_rev: '"version"' });
    } else {
      assert.equal(calls[0].options.headers['If-Match'], '"version"', provider);
      assert.equal(calls[0].options.method, provider === 'google' ? 'PATCH' : 'DELETE', provider);
      if (provider === 'google') assert.deepEqual(JSON.parse(calls[0].options.body), { labels: { trashed: true } });
    }
    status = provider === 'dropbox' ? 409 : 412;
    await assert.rejects(storage.delete(item), /云端文件已变化/);
    await assert.rejects(storage.delete({ ...item, revision: null }), /无效数据/);
    assert.equal(calls.length, 2);
    storage.disconnect();
    await assert.rejects(storage.delete(item), /授权已失效/);
    assert.equal(calls.length, 2);
  }
});

test('non-TJA files cannot open or overwrite charts; Google Picker authorization lists them without loading their content', async () => {
  let handles = 0, opened = 0, saved = 0, lists = 0;
  const file = { id: 'audio', name: 'audio.mp3', revision: '"audio"' };
  const storage = {
    handle: value => { handles++; return value; },
    list: async () => { lists++; return [file]; },
    pick: async () => file
  };
  const studio = {
    state: { activeId: 1, filename: 'chart.tja' },
    openStorageChart: async () => { opened++; return true; },
    saveToStorage: async () => { saved++; return true; }
  };
  const model = storageDialogModel(storage, studio);
  model.open('save');
  await model.chooseProvider('onedrive');
  await model.openEntry(file);
  assert.match(model.error.value.message, /\.tja/);
  await model.saveEntry(file);
  assert.match(model.error.value.message, /\.tja/);
  assert.equal(handles + opened + saved, 0);
  await model.pickGoogle();
  assert.equal(model.error.value, null);
  assert.equal(model.authorizedName.value, 'audio.mp3');
  assert.equal(model.entries.value[0].id, 'audio');
  assert.equal(lists, 2);
  assert.equal(handles + opened + saved, 0);
});

test('deletion requires confirmation, preserves failed deletes and invalidates OneDrive cursors even when the subsequent refresh fails', async () => {
  const first = Array.from({ length: 10 }, (_, index) => ({ id: `${index}`, name: `${index}.tja` }));
  const file = { id: 'audio', name: 'audio.mp3', revision: '"audio"' };
  let confirmed = false, failDelete = true, failRefresh = false, deletes = 0, removed = false;
  const prompts = [], requests = [];
  const storage = {
    listPage: async ({ cursor = null, query = '' }) => {
      requests.push({ cursor, query });
      if (failRefresh) throw new Error('Refresh failed');
      return cursor ? { entries: [file], nextCursor: null } : { entries: first, nextCursor: removed ? null : { url: 'second' } };
    },
    delete: async value => {
      deletes++; assert.equal(value.id, 'audio');
      if (failDelete) throw new Error('Delete failed');
      removed = true;
    }
  };
  const model = storageDialogModel(storage, undefined, prompt => { prompts.push(prompt); return confirmed; });
  await model.refresh();
  await model.nextPage();
  await model.deleteEntry(file);
  assert.equal(deletes, 0);
  assert.equal(model.page.value, 2);
  assert.match(prompts[0], /audio\.mp3/);
  assert.match(prompts[0], /能否恢复取决于存储服务/);
  confirmed = true;
  await model.deleteEntry(file);
  assert.equal(deletes, 1);
  assert.equal(model.error.value.message, 'Delete failed');
  assert.equal(model.page.value, 2);
  assert.equal(model.pageEntries.value[0].id, 'audio');
  failDelete = false; failRefresh = true;
  model.appliedQuery.value = 'audio';
  await model.deleteEntry(file);
  assert.equal(deletes, 2);
  assert.equal(model.deletedName.value, 'audio.mp3');
  assert.equal(model.error.value.message, 'Refresh failed');
  assert.equal(model.remotePages.value.length, 0);
  assert.equal(model.entries.value.some(item => item.id === 'audio'), false);
  assert.equal(model.page.value, 1);
  assert.equal(requests.at(-1).cursor, null);
  assert.equal(requests.at(-1).query, 'audio');
  assert.equal(model.busy.value, false);
  failRefresh = false;
  await model.refresh();
  assert.equal(model.canNext.value, false);
});

test('deleting the only file on a local last page clamps pagination without changing search or editor state', async () => {
  let files = Array.from({ length: 21 }, (_, index) => ({ id: `${index}`, name: `song-${index}.mp3` }));
  const studio = { state: { activeId: 1, filename: 'open.tja', text: 'local edits', fileHandle: { id: 'local' } } };
  const storage = {
    list: async () => files,
    delete: async value => { files = files.filter(item => item.id !== value.id); }
  };
  const model = storageDialogModel(storage, studio);
  await model.refresh();
  model.query.value = 'song-'; model.page.value = 3;
  await model.deleteEntry(model.pageEntries.value[0]);
  assert.equal(model.page.value, 2);
  assert.equal(model.pageEntries.value.length, 10);
  assert.equal(model.query.value, 'song-');
  assert.equal(model.deletedName.value, 'song-20.mp3');
  assert.equal(studio.state.text, 'local edits');
  assert.equal(studio.state.fileHandle.id, 'local');
});

test('Dropbox binds downloaded bytes to the returned revision and conditionally updates Unicode paths with HTTP-safe headers', async () => {
  const file = { id: 'id:chart', name: '测试.tja', rev: 'rev1', path_lower: '/测试.tja', '.tag': 'file' };
  const calls = [], answers = [
    response({ entries: [file], has_more: true, cursor: 'cursor' }),
    response({ entries: [], has_more: false }),
    response('TITLE:Cloud\n', 200, { 'Dropbox-API-Result': JSON.stringify(file).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`) }),
    response({ ...file, rev: 'rev2' }),
    response({ error_summary: 'conflict' }, 409)
  ];
  const storage = createPersonalStorage('dropbox', credentials, async (url, options) => { calls.push({ url: String(url), options }); return answers.shift(); });
  const [item] = await storage.list(), handle = storage.handle(item);
  await handle.getFile();
  let writer = await handle.createWritable(); await writer.write(blob()); await writer.close();
  const argumentsHeader = calls[3].options.headers['Dropbox-API-Arg'];
  assert.doesNotMatch(argumentsHeader, /[\u007f-\uffff]/);
  assert.deepEqual(JSON.parse(argumentsHeader).mode, { '.tag': 'update', update: 'rev1' });
  assert.equal(JSON.parse(argumentsHeader).path, '/测试.tja');
  writer = await handle.createWritable(); await writer.write(blob());
  await assert.rejects(writer.close(), /云端文件已变化/);
  assert.equal(JSON.parse(calls[4].options.headers['Dropbox-API-Arg']).mode.update, 'rev2');
});

test('Google Drive lists authorized files across pages, uses ETags for updates and creates named UTF-8 multipart files', async () => {
  const file = { id: 'google-file', title: 'song.tja', etag: '"v1"', downloadUrl: 'https://www.googleapis.com/download/test', fileSize: '20' };
  const calls = [], answers = [
    response({ items: [file], nextPageToken: 'next' }), response({ items: [] }),
    response(file), response('TITLE:Cloud\nBPM:120\n'), response(file),
    response({ ...file, etag: '"v2"' }), response({ id: 'created', title: '新歌.tja', etag: '"new"' })
  ];
  const storage = createPersonalStorage('google', credentials, async (url, options) => { calls.push({ url: String(url), options }); return answers.shift(); });
  const [item] = await storage.list(), handle = storage.handle(item);
  await handle.getFile();
  let writer = await handle.createWritable(); await writer.write(blob()); await writer.close();
  assert.equal(calls[5].options.method, 'PUT');
  assert.equal(calls[5].options.headers['If-Match'], '"v1"');
  assert.equal(new URL(calls[1].url).searchParams.get('pageToken'), 'next');
  writer = await storage.handle({ id: null, name: '新歌.tja' }).createWritable();
  await writer.write(blob()); await writer.close();
  const multipart = await calls[6].options.body.text();
  assert.match(multipart, /"title":"新歌.tja"/);
  assert.ok(multipart.includes('\ufeffTITLE:Cloud'));
  assert.match(calls[6].options.headers['Content-Type'], /^multipart\/related; boundary=/);
});

test('cloud writes enforce the exact 5 MiB boundary, abort without writing, and retain their connection identity after disconnection', async () => {
  let writes = 0;
  const storage = { provider: 'test', write: async value => { writes++; return { ...value, id: 'new', revision: 'saved' }; } };
  let writer = await createStorageHandle(storage, { id: null, name: 'song.tja' }).createWritable();
  await writer.write(new Blob([new Uint8Array(MAX_CLOUD_BYTES)])); await writer.close();
  assert.equal(writes, 1);
  writer = await createStorageHandle(storage, { id: null, name: 'song.tja' }).createWritable();
  await assert.rejects(writer.write(new Blob([new Uint8Array(MAX_CLOUD_BYTES + 1)])), /5 MiB/);
  await writer.abort(); assert.equal(writes, 1);
  writer = await createStorageHandle(storage, { id: null, name: 'song.tja' }).createWritable();
  await writer.write(blob()); await writer.abort(); assert.equal(writes, 1);
  const disconnected = createPersonalStorage('dropbox', credentials, () => assert.fail('Disconnected sessions must not send requests'));
  const handle = disconnected.handle({ id: 'song.tja', name: 'song.tja' });
  disconnected.disconnect();
  await assert.rejects(handle.getFile(), /授权已失效/);
  assert.throws(() => createPersonalStorage('google', { ...credentials, expires_in: 0 }), /无效数据/);
});

test('unsupported providers are rejected before authorization or storage requests', () => {
  const request = () => assert.fail('Unsupported providers must not send requests');
  assert.throws(() => createPersonalStorage('unsupported', credentials, request), /无效数据/);
  assert.throws(() => connectPersonalStorage('unsupported', {}), /无效数据/);
});

test('authorization checks callback window, origin and state, uses PKCE and canonical static callbacks, and reports unavailable configuration before opening a popup', async () => {
  const popup = {}, event = { source: popup, origin: 'https://editor.example', data: { type: 'donkanvas-storage-auth', state: 'expected' } };
  assert.equal(acceptStorageCallback(event, popup, event.origin, 'expected'), true);
  assert.equal(acceptStorageCallback({ ...event, source: {} }, popup, event.origin, 'expected'), false);
  assert.equal(acceptStorageCallback({ ...event, origin: 'https://other.example' }, popup, event.origin, 'expected'), false);
  assert.equal(acceptStorageCallback(event, popup, event.origin, 'wrong'), false);
  assert.equal(storageCallbackURL('https://editor.example/DonKanvas/index.ja.html?x=1'), 'https://editor.example/DonKanvas/storage-callback.html');
  const pair = await pkcePair();
  assert.equal(pair.verifier.length, 43);
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pair.verifier))).toString('base64url');
  assert.equal(pair.challenge, digest);
  assert.deepEqual(missingStorageConfig('google', {}), ['VITE_GOOGLE_CLIENT_ID', 'VITE_GOOGLE_API_KEY', 'VITE_GOOGLE_APP_ID']);
  await assert.rejects(connectPersonalStorage('onedrive', {}), /VITE_ONEDRIVE_CLIENT_ID/);
  for (const address of ['http://storage.example/', 'https://user:password@storage.example/']) assert.throws(() => secureStorageURL(address), /HTTPS/);
});

test('personal storage components compile, all new messages are translated and the Google Picker temporarily leaves the native modal', () => {
  const source = readFileSync(new URL('PersonalStorage.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  compileScript(descriptor, { id: 'personal-storage' });
  for (const file of ['PersonalStorage.vue', 'personal-storage.js', 'storage-auth.js']) {
    for (const match of readFileSync(new URL(file, import.meta.url), 'utf8').matchAll(/'([^'\r\n]*[\u4e00-\u9fff][^'\r\n]*)'/g)) {
      const key = match[1];
      assert.equal(translations[key]?.length, 4, key);
    }
  }
  assert.match(descriptor.template.content, /@cancel.prevent="close"/);
  assert.match(descriptor.template.content, /class="provider-button"[\s\S]*?:disabled="busy"/);
  assert.doesNotMatch(descriptor.scriptSetup.content + descriptor.template.content, /googleReady|googleLoading|googleError|prepareGoogle|storage-google-error/);
  assert.doesNotMatch(descriptor.template.content, /role="alert"|formatMessage\(error\)/);
  assert.match(descriptor.scriptSetup.content, /dialog\.value\.close\(\);[\s\S]*?connection\.value\.pick\(\);[\s\S]*?finally \{ dialog\.value\.showModal\(\)/);
  const callback = readFileSync(new URL('../public/storage-callback.html', import.meta.url), 'utf8');
  const messages = [], address = { pathname: '/storage-callback.html', hash: '', search: '?state=expected&code=test', origin: 'https://editor.example' };
  runInNewContext(callback.match(/<script>([\s\S]*?)<\/script>/)[1], {
    URLSearchParams, location: address, history: { replaceState: (_state, _title, url) => { assert.equal(url, address.pathname); } },
    window: { opener: { postMessage: (value, origin) => messages.push({ value, origin }) } }
  });
  assert.equal(messages[0].origin, address.origin);
  assert.equal(messages[0].value.state, 'expected');
  assert.equal(messages[0].value.code, 'test');
});

test('PWA navigation fallback excludes authorization callbacks with query parameters at root and subdirectory deployments', () => {
  const source = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default ', '');
  const config = runInNewContext(source, {
    defineConfig: value => value, vue: () => ({}), VitePWA: value => value, getPageMetadata: () => ({})
  });
  const { navigateFallbackDenylist } = config.plugins[2].workbox;
  const denied = address => {
    const url = new URL(address, 'https://editor.example');
    return navigateFallbackDenylist.some(pattern => pattern.test(url.pathname + url.search));
  };
  for (const path of [
    '/storage-callback.html',
    '/storage-callback.html?code=test-code&state=test-state',
    '/DonKanvas/storage-callback.html?state=test-state&code=test-code',
    '/DonKanvas/storage-callback.html?error=access_denied&state=test-state',
    '/api/files', '/media/audio'
  ]) assert.equal(denied(path), true, path);
  for (const path of [
    '/', '/DonKanvas/', '/DonKanvas/index.en.html?language=en',
    '/DonKanvas/storage-callback.html.backup?code=test-code',
    '/DonKanvas/index.html?next=/storage-callback.html'
  ]) assert.equal(denied(path), false, path);
});

test('browser OAuth exchanges PKCE codes without secrets and ignores untrusted messages', async () => {
  const originals = new Map(['window', 'location', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const provider of ['dropbox', 'onedrive']) {
      let authorizationURL, listener;
      const requests = [];
      const popup = { closed: false, close() { this.closed = true; }, location: { replace(value) { authorizationURL = new URL(value); } } };
      const location = { href: 'https://editor.example/DonKanvas/index.en.html', origin: 'https://editor.example' };
      Object.defineProperty(globalThis, 'location', { configurable: true, value: location });
      Object.defineProperty(globalThis, 'window', { configurable: true, value: {
        open: () => popup, addEventListener: (_name, handler) => { listener = handler; }, removeEventListener() {}
      } });
      Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url, options) => {
        requests.push({ url: String(url), options });
        return response({ access_token: 'test-token', expires_in: 3600 });
      } });
      const config = { VITE_DROPBOX_CLIENT_ID: 'dropbox-app', VITE_ONEDRIVE_CLIENT_ID: 'microsoft-app' };
      const connecting = connectPersonalStorage(provider, config);
      for (let attempt = 0; attempt < 100 && !authorizationURL; attempt++) await new Promise(resolve => setImmediate(resolve));
      assert.ok(authorizationURL, provider);
      const state = authorizationURL.searchParams.get('state');
      const data = { type: 'donkanvas-storage-auth', state, code: 'test-code' };
      await listener({ source: {}, origin: location.origin, data });
      await listener({ source: popup, origin: 'https://attacker.example', data });
      assert.equal(requests.length, 0);
      await listener({ source: popup, origin: location.origin, data });
      const storage = await connecting;
      assert.equal(storage.connected, true); assert.equal(popup.closed, true);
      assert.equal(authorizationURL.searchParams.get('response_type'), 'code');
      assert.equal(authorizationURL.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(requests.length, 1);
      const exchange = requests[0].options.body;
      assert.equal(exchange.get('client_secret'), null);
      assert.equal(exchange.get('code'), 'test-code');
      assert.equal(exchange.get('redirect_uri'), 'https://editor.example/DonKanvas/storage-callback.html');
      const verifier = exchange.get('code_verifier');
      assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url'), authorizationURL.searchParams.get('code_challenge'));
      storage.disconnect(); assert.equal(storage.connected, false);
    }
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test('Google authorization loads SDKs on demand, retries only failed scripts and authorizes synchronously once ready', async () => {
  const source = readFileSync(new URL('storage-auth.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const nodes = [], googleWindow = {}, config = { VITE_GOOGLE_CLIENT_ID: 'client', VITE_GOOGLE_API_KEY: 'picker-key', VITE_GOOGLE_APP_ID: 'project' };
  let pickerLoad, requests = 0, blockPopup = true;
  const connect = runInNewContext(`${source}; connectPersonalStorage`, {
    LocalizedError, missingStorageConfig, createPersonalStorage, storageRequest,
    window: googleWindow, document: {
      createElement() { return { remove() {} }; },
      head: { append(node) { nodes.push(node); } }
    },
    setTimeout: () => 1, clearTimeout() {}
  });
  const first = connect('google', config);
  assert.equal(nodes.length, 2);
  assert.equal(requests, 0);
  googleWindow.google = { accounts: { oauth2: { initTokenClient(settings) {
    assert.equal(settings.scope, 'https://www.googleapis.com/auth/drive.file');
    return { requestAccessToken(options) {
      requests++; assert.equal(options.prompt, 'consent');
      if (blockPopup) settings.error_callback({ type: 'popup_failed_to_open' });
      else settings.callback(credentials);
    } };
  } } } };
  nodes[0].onload();
  nodes[1].onerror();
  await assert.rejects(first, /组件载入失败/);
  const retry = connect('google', config);
  assert.equal(nodes.length, 3);
  assert.equal(nodes[2].src, 'https://apis.google.com/js/api.js');
  googleWindow.gapi = { load(name, options) { assert.equal(name, 'picker'); pickerLoad = options; } };
  nodes[2].onload();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 0);
  googleWindow.google.picker = {};
  pickerLoad.callback();
  await assert.rejects(retry, /允许本站弹出窗口/);
  assert.equal(requests, 1);
  blockPopup = false;
  const ready = connect('google', config);
  assert.equal(requests, 2);
  assert.equal(nodes.length, 3);
  assert.equal((await ready).connected, true);
});

test('Google browser authorization requests only per-file access, reports popup errors and invalidates the picker and old file handles on disconnect', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const config = { VITE_GOOGLE_CLIENT_ID: 'client', VITE_GOOGLE_API_KEY: 'picker-key', VITE_GOOGLE_APP_ID: 'project' };
  try {
    let settings;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { google: {
      picker: {},
      accounts: { oauth2: { initTokenClient(value) {
        settings = value;
        return { requestAccessToken(options) { assert.equal(options.prompt, 'consent'); value.callback({ access_token: 'test-token', expires_in: 3600 }); } };
      } } }
    } } });
    const storage = await connectPersonalStorage('google', config);
    assert.equal(settings.scope, 'https://www.googleapis.com/auth/drive.file');
    const handle = storage.handle({ id: 'google-file', name: 'song.tja' });
    storage.disconnect();
    assert.throws(() => storage.pick(), /授权已失效/);
    await assert.rejects(handle.getFile(), /授权已失效/);
    window.google.accounts.oauth2.initTokenClient = value => ({ requestAccessToken() { value.error_callback({ type: 'popup_closed' }); } });
    await assert.rejects(connectPersonalStorage('google', config), /popup_closed/);
    window.google.accounts.oauth2.initTokenClient = () => ({ requestAccessToken() { throw new Error('Popup blocked'); } });
    await assert.rejects(connectPersonalStorage('google', config), /Popup blocked/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window;
  }
});
