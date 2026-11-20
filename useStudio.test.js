import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, nextTick } from 'vue';
import { useStudio } from './useStudio.js';

const chart = 'TITLE:Vue session\nBPM:120\nOFFSET:0\nCOURSE:Oni\nLEVEL:1\n#START\n1000,\n2000,\n#END\n';

function mountStudio(saved = new Map()) {
  const listeners = new Set(), handlers = new Map(), originals = new Map();
  const ticks = { schedule: null, frame: null };
  const mock = (name, value) => { if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  const addEventListener = (name, handler) => { listeners.add(name); handlers.set(name, handler); }, removeEventListener = name => { listeners.delete(name); handlers.delete(name); };
  mock('localStorage', { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) });
  mock('window', { addEventListener, removeEventListener });
  mock('document', { addEventListener, removeEventListener, activeElement: null });
  mock('requestAnimationFrame', callback => { ticks.frame = callback; return 1; }); mock('cancelAnimationFrame', () => {});
  mock('setInterval', callback => { ticks.schedule = callback; return 1; }); mock('clearInterval', () => {});
  mock('fetch', () => assert.fail('The studio must not request local server APIs'));
  mock('confirm', () => true);
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  let studio;
  const app = renderer.createApp({ setup() { studio = useStudio(); return () => null; } });
  app.mount({});
  return { studio, saved, listeners, handlers, ticks, mock, app, cleanup() {
    app.unmount();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  } };
}

const file = (name = 'fixture.tja', text = chart) => ({ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
const workspace = saved => JSON.parse(saved.get('tja-wave-workspace'));

test('Vue session preserves editing, command positions, history, drafts and lifecycle cleanup', async () => {
  const { studio, saved, listeners, mock, app, cleanup } = mountStudio();
  try {
    assert.equal(studio.state.chart, null);
    await studio.openChart(file());
    assert.equal(studio.state.chart.title, 'Vue session');
    assert.equal(studio.state.chart.bars.length, 2);
    studio.selectCell({ bar: 0, numerator: 1, denominator: 3, divisions: 16 });
    studio.chooseNote('7');
    assert.equal(studio.cell.value.note, '7');
    assert.equal(studio.cell.value.count, 5);
    studio.setBalloon(12);
    assert.equal(studio.cell.value.count, 12);
    studio.applySettings({ bpm: 60, delay: .25 });
    assert.equal(studio.bar.value.events.length, 2);
    assert.ok(studio.bar.value.events.every(event => event.fraction === 1 / 3));
    assert.ok(studio.state.source.includes('#BPMCHANGE 60'));
    const edited = studio.state.text;
    assert.equal(workspace(saved).documents[0].text, edited);
    studio.history(); assert.notEqual(studio.state.text, edited);
    studio.history(true); assert.equal(studio.state.text, edited);
    studio.select(1); assert.equal(studio.state.selectedCell, null); assert.equal(studio.command.value.numerator, 0);
    studio.restore(); assert.equal(studio.state.text, edited); assert.equal(studio.state.selected, 1);
    studio.select(0);
    studio.editSource('10\n#BPMCHANGE 0\n20,');
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.equal(studio.state.sourceState, '格式错误'); assert.equal(studio.state.text, edited);
    studio.select(1); assert.equal(studio.state.selected, 0);
    studio.editSource('#BPMCHANGE 120\n10\n#BPMCHANGE 60\n#DELAY 0.25\n20,');
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.equal(studio.state.invalid, false); assert.equal(studio.bar.value.duration, 3.25);
    studio.setCommandPosition(1, 2); studio.applySettings({ delay: -3 });
    assert.ok(studio.state.source.includes('#DELAY -3'));
    assert.equal(studio.bar.value.end, 0);
    assert.equal(studio.timelineBounds.value.start, -2);
    assert.equal(studio.timelineBounds.value.end, 4);
    studio.panTimeline(-2);
    assert.equal(studio.visible.value.start, -2);
    assert.equal(studio.visible.value.end, 2);
    studio.controls.view = 1;
    assert.equal(studio.visible.value.start, -2);
    assert.equal(studio.visible.value.end, 0);
    assert.ok(studio.visible.value.bars.some(item => item.index === 0));
    studio.stop(); assert.equal(studio.state.position, 0);
    studio.setSnap(7); assert.equal(studio.controls.snap, 7);
    studio.setSnap(769); assert.equal(studio.controls.snap, 7);
    studio.controls.hits = false; await nextTick();
    let resume;
    const parameter = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime() {} });
    mock('AudioContext', class {
      currentTime = 0;
      createDynamicsCompressor() { return { connect() {}, threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() }; }
      createGain() { return { connect() {}, gain: parameter() }; }
      resume() { return new Promise(resolve => { resume = resolve; }); }
      createBufferSource() { assert.fail('Cancelled play must not create an audio source'); }
      close() { return Promise.resolve(); }
    });
    studio.state.buffer = { duration: 20 };
    const pending = studio.play(); studio.pause(); resume(); await pending;
    assert.equal(studio.state.playing, false);
    assert.ok(listeners.has('keydown')); assert.ok(listeners.has('beforeunload'));
    app.unmount(); assert.equal(listeners.size, 0);
  } finally {
    cleanup();
  }
});

test('each chart keeps at most 50 reversible diffs, and new edits clear only its redo', async () => {
  const { studio, saved, cleanup } = mountStudio();
  try {
    await studio.openChart(file());
    const first = studio.state.activeId, versions = [studio.state.text];
    for (let index = 1; index <= 55; index++) { studio.setOffset(index / 100); versions.push(studio.state.text); }
    assert.equal(studio.state.undo.length, 50);
    assert.deepEqual(Object.keys(studio.state.undo[0]), ['start', 'removed', 'inserted']);
    assert.ok(JSON.stringify(studio.state.undo).length < versions.slice(5).join('').length);
    for (let index = 54; index >= 5; index--) { studio.history(); assert.equal(studio.state.text, versions[index]); }
    studio.history(); assert.equal(studio.state.text, versions[5]);
    assert.equal(studio.state.redo.length, 50);
    await studio.openChart(file('second.tja', chart.replace('Vue session', 'Second')));
    const second = studio.state.activeId;
    assert.equal(studio.state.undo.length, 0);
    studio.setBpm(150); const secondText = studio.state.text;
    studio.switchChart(first);
    assert.equal(studio.state.redo.length, 50);
    for (let index = 6; index <= 55; index++) { studio.history(true); assert.equal(studio.state.text, versions[index]); }
    studio.history(); studio.setBpm(180);
    assert.equal(studio.state.redo.length, 0);
    assert.equal(studio.state.undo.length, 50);
    studio.switchChart(second); assert.equal(studio.state.text, secondText);
    assert.equal(studio.state.undo.length, 1);
    assert.equal(workspace(saved).documents.length, 2);
  } finally { cleanup(); }
});

test('switching flushes pending source and preserves invalid source, selections and per-chart audio', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file());
    const first = studio.state.activeId, audio = { duration: 10 };
    studio.state.buffer = audio; studio.state.audioName = 'first.wav';
    studio.select(1); studio.editSource('3000,');
    await studio.openChart(file('second.tja'));
    const second = studio.state.activeId;
    assert.equal(studio.state.buffer, null);
    studio.switchChart(first);
    assert.equal(studio.state.buffer, audio); assert.equal(studio.state.audioName, 'first.wav');
    assert.equal(studio.state.selected, 1); assert.equal(studio.bar.value.notes, '3000');
    assert.equal(studio.state.undo.length, 1);
    studio.editSource('not a bar');
    studio.switchChart(second); studio.switchChart(first);
    assert.equal(studio.state.invalid, true); assert.equal(studio.state.source, 'not a bar');
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.equal(studio.state.source, 'not a bar');
    studio.editSource('3000,'); await new Promise(resolve => setTimeout(resolve, 280));
    assert.equal(studio.state.invalid, false);
    assert.equal(studio.state.undo.length, 1);
  } finally { cleanup(); }
});

test('workspace restores all charts, undo/redo and invalid source without overwriting on failed restore', async () => {
  const saved = new Map();
  let mounted = mountStudio(saved);
  try {
    const { studio } = mounted;
    await studio.openChart(file()); studio.setBpm(180); studio.setOffset(.25); studio.history();
    const first = studio.state.activeId;
    await studio.openChart(file('second.tja')); studio.editSource('invalid source');
    const second = studio.state.activeId;
    mounted.cleanup(); mounted = mountStudio(saved);
    const restored = mounted.studio;
    assert.equal(restored.state.documents.length, 2);
    assert.equal(restored.state.activeId, second);
    assert.equal(restored.state.source, 'invalid source'); assert.equal(restored.state.invalid, true);
    assert.equal(restored.state.buffer, null);
    restored.switchChart(first);
    assert.equal(restored.state.undo.length, 1); assert.equal(restored.state.redo.length, 1);
    restored.history(true); assert.equal(restored.state.chart.offset, .25);
    const broken = workspace(saved); broken.documents[0].undo[0].start = -1;
    saved.set('tja-wave-workspace', JSON.stringify(broken));
    const text = restored.state.text;
    restored.restore();
    assert.equal(restored.state.error, true); assert.equal(restored.state.text, text);
    assert.equal(restored.state.documents.length, 2);
  } finally { mounted.cleanup(); }
});

test('new, rename, close and legacy draft migration work without server APIs', async () => {
  const saved = new Map([['tja-wave-draft', JSON.stringify({ text: chart, filename: 'legacy.tja', course: 0, selected: 1 })]]);
  const { studio, mock, cleanup } = mountStudio(saved);
  try {
    assert.equal(studio.state.filename, 'legacy.tja'); assert.equal(studio.state.selected, 1);
    const first = studio.state.activeId;
    studio.newChart(); const second = studio.state.activeId;
    assert.equal(studio.state.chart.title, 'Untitled');
    studio.renameChart('new name'); assert.equal(studio.state.filename, 'new name.tja');
    studio.renameChart('../bad'); assert.equal(studio.state.filename, 'new name.tja'); assert.equal(studio.state.error, true);
    mock('confirm', () => false);
    studio.closeChart(first); studio.closeChart(second); assert.equal(studio.state.documents.length, 2);
    mock('confirm', () => true);
    studio.closeChart(first); assert.equal(studio.state.activeId, second);
    studio.closeChart(second); assert.equal(studio.state.chart, null); assert.equal(studio.state.activeId, null);
    assert.equal(studio.state.documents.length, 0); assert.deepEqual(workspace(saved).documents, []);
    await studio.openAudio(file('music.wav')); assert.equal(studio.state.error, true);
    await studio.openChart(file('broken.tja', 'invalid')); assert.equal(studio.state.documents.length, 0);
  } finally { cleanup(); }
});

test('audio reads and decodes cannot attach to the wrong chart or supersede a newer file', async () => {
  const { studio, mock, cleanup } = mountStudio();
  let finishRead, finishDecode;
  const bytes = new ArrayBuffer(4);
  const parameter = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime() {} });
  mock('AudioContext', class {
    currentTime = 0;
    createDynamicsCompressor() { return { connect() {}, threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }; }
    createGain() { return { connect() {}, gain: parameter() }; }
    decodeAudioData() { return new Promise(resolve => { finishDecode = resolve; }); }
    close() { return Promise.resolve(); }
  });
  const buffer = { duration: 1, length: 1, numberOfChannels: 1, getChannelData: () => new Float32Array([.5]) };
  try {
    await studio.openChart(file());
    const pendingRead = studio.openAudio({ name: 'slow.wav', arrayBuffer: () => new Promise(resolve => { finishRead = resolve; }) });
    studio.newChart(); finishRead(bytes); await pendingRead;
    assert.equal(studio.state.buffer, null);
    const pendingDecode = studio.openAudio({ name: 'old.wav', arrayBuffer: async () => bytes });
    await Promise.resolve();
    const resolveOld = finishDecode;
    const latest = studio.openAudio({ name: 'latest.wav', arrayBuffer: async () => bytes });
    await Promise.resolve();
    resolveOld(buffer); await pendingDecode; assert.equal(studio.state.buffer, null);
    finishDecode(buffer); await latest;
    assert.equal(studio.state.audioName, 'latest.wav'); assert.equal(studio.state.buffer, buffer);
    const switching = studio.openAudio({ name: 'switch.wav', arrayBuffer: async () => bytes });
    await Promise.resolve(); studio.newChart(); finishDecode(buffer); await switching;
    assert.equal(studio.state.buffer, null);
  } finally { cleanup(); }
});

test('duplicate filenames are independent and history survives changing course', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    const text = chart + 'COURSE:Easy\nLEVEL:1\n#START\n2000,\n#END\n';
    await studio.openChart(file('same.tja', text));
    const first = studio.state.activeId;
    studio.selectCell({ bar: 0, numerator: 0, denominator: 1 }); studio.chooseNote('3');
    studio.changeCourse(1); assert.equal(studio.bar.value.notes, '2000');
    studio.history(); assert.equal(studio.bar.value.notes, '2000');
    studio.changeCourse(0); assert.equal(studio.bar.value.notes, '1000');
    studio.history(true); assert.equal(studio.bar.value.notes, '3000');
    await studio.openChart(file('same.tja', text));
    assert.equal(studio.state.documents.length, 2); assert.notEqual(studio.state.activeId, first);
    assert.equal(studio.bar.value.notes, '1000'); assert.equal(studio.state.undo.length, 0);
    studio.switchChart(first); assert.equal(studio.bar.value.notes, '3000');
  } finally { cleanup(); }
});

test('restoring valid pending source applies it once and storage failures do not lose live edits', async () => {
  const saved = new Map();
  let mounted = mountStudio(saved);
  try {
    await mounted.studio.openChart(file()); mounted.studio.editSource('4000,');
    mounted.cleanup(); mounted = mountStudio(saved);
    const { studio, mock } = mounted;
    assert.equal(studio.state.invalid, false);
    assert.equal(studio.bar.value.notes, '4000'); assert.equal(studio.state.undo.length, 1);
    mock('localStorage', { getItem: key => saved.get(key), setItem() { throw new Error('quota exceeded'); } });
    studio.setBpm(180);
    assert.equal(studio.state.chart.baseBpm, 180);
    assert.match(studio.state.saveState, /存储不可用/);
    assert.equal(studio.state.error, true); assert.match(studio.state.notice, /quota exceeded/);
    assert.equal(studio.state.undo.length, 2);
  } finally { mounted.cleanup(); }
});

function diskFile(name = 'fixture.tja', text = chart) {
  let contents = text;
  const writes = [], calls = { opens: 0, closes: 0, aborts: 0 };
  const handle = {
    name,
    getFile: async () => file(name, contents),
    async createWritable() {
      calls.opens++;
      let pending;
      return {
        async write(blob) { writes.push(blob); pending = await blob.text(); },
        async close() { contents = pending; calls.closes++; },
        async abort() { calls.aborts++; }
      };
    }
  };
  return { handle, writes, calls, get text() { return contents; }, replace(text) { contents = text; } };
}

test('native opening attaches handles; save overwrites that file with UTF-8 BOM and tracks clean history', async () => {
  const { studio, saved, cleanup } = mountStudio();
  try {
    const disk = diskFile();
    window.showOpenFilePicker = async options => { assert.equal(options.multiple, true); return [disk.handle]; };
    window.showSaveFilePicker = () => assert.fail('Saving an associated file must not ask for a new path');
    await studio.openCharts();
    assert.equal(studio.state.fileHandle, disk.handle);
    studio.setBpm(180);
    const edited = studio.state.text;
    assert.equal(await studio.saveChart(), true);
    assert.equal(disk.text, edited); assert.equal(disk.calls.closes, 1);
    assert.deepEqual([...new Uint8Array(await disk.writes[0].arrayBuffer()).slice(0, 3)], [239, 187, 191]);
    assert.equal(studio.state.dirty, false); assert.equal(studio.state.saving, false);
    assert.equal(studio.state.savedText, edited); assert.equal(studio.state.filename, 'fixture.tja');
    assert.equal(workspace(saved).documents[0].savedText, edited);
    assert.equal('fileHandle' in workspace(saved).documents[0], false);
    studio.history(); assert.equal(studio.state.dirty, true);
    studio.history(true); assert.equal(studio.state.dirty, false);
    studio.restore();
    assert.equal(studio.state.fileHandle, null); assert.equal(studio.state.dirty, false);
    const restored = diskFile('restored.tja', '');
    window.showSaveFilePicker = async () => restored.handle;
    await studio.saveChart();
    assert.equal(restored.text, edited); assert.equal(studio.state.filename, 'restored.tja');
  } finally { cleanup(); }
});

test('first save and save as choose a location, rebind the document, and leave the old file untouched', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    studio.newChart();
    const first = diskFile('first.tja', ''), second = diskFile('second.tja', '');
    let choices = 0;
    window.showSaveFilePicker = async options => {
      assert.equal(options.suggestedName, choices ? 'first.tja' : 'untitled.tja');
      assert.deepEqual(options.types[0].accept, { 'text/plain': ['.tja'] });
      return choices++ ? second.handle : first.handle;
    };
    assert.equal(await studio.saveChart(), true);
    const original = first.text;
    studio.setBpm(160);
    assert.equal(await studio.saveAs(), true);
    assert.equal(first.text, original); assert.equal(second.text, studio.state.text);
    assert.equal(studio.state.filename, 'second.tja'); assert.equal(studio.state.fileHandle, second.handle);
    studio.setOffset(.25); await studio.saveChart();
    assert.equal(choices, 2); assert.equal(second.calls.closes, 2);
    studio.renameChart('renamed');
    assert.equal(studio.state.fileHandle, null); assert.equal(studio.state.dirty, true);
  } finally { cleanup(); }
});

test('cancelled pickers, permission errors, external changes and failed writes retain dirty state and handles', async () => {
  const { studio, mock, cleanup } = mountStudio();
  try {
    const disk = diskFile();
    await studio.openChart(await disk.handle.getFile(), disk.handle); studio.setBpm(180);
    const failure = (message, name = 'Error') => Object.assign(new Error(message), { name });
    window.showSaveFilePicker = async () => { throw failure('cancelled', 'AbortError'); };
    assert.equal(await studio.saveAs(), false); assert.equal(studio.state.error, false);
    assert.equal(studio.state.dirty, true); assert.equal(studio.state.fileHandle, disk.handle);
    window.showSaveFilePicker = async () => { throw failure('denied', 'NotAllowedError'); };
    assert.equal(await studio.saveAs(), false); assert.match(studio.state.notice, /denied/);
    assert.equal(studio.state.error, true); assert.equal(studio.state.saving, false);
    disk.replace(chart.replace('120', '140')); mock('confirm', () => false);
    assert.equal(await studio.saveChart(), false); assert.equal(disk.calls.opens, 0);
    mock('confirm', () => true);
    const write = disk.handle.createWritable;
    disk.handle.createWritable = async () => {
      const stream = await write();
      stream.write = async () => { throw failure('disk full'); };
      return stream;
    };
    assert.equal(await studio.saveChart(), false);
    assert.match(studio.state.notice, /disk full/); assert.equal(disk.calls.aborts, 1);
    assert.equal(studio.state.dirty, true); assert.equal(studio.state.fileHandle, disk.handle);
    disk.handle.createWritable = async () => {
      const stream = await write();
      stream.close = async () => { throw failure('close failed'); };
      return stream;
    };
    assert.equal(await studio.saveChart(), false);
    assert.match(studio.state.notice, /close failed/); assert.equal(disk.calls.aborts, 2);
    assert.equal(studio.state.dirty, true);
    disk.handle.createWritable = write;
    assert.equal(await studio.saveChart(), true); assert.equal(studio.state.dirty, false);
  } finally { cleanup(); }
});

test('pending saves stay bound to their chart and do not clear edits made while saving', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    studio.newChart();
    const first = studio.state.activeId, firstText = studio.state.text, disk = diskFile('saved-first.tja', '');
    let choose;
    window.showSaveFilePicker = () => new Promise(resolve => { choose = resolve; });
    const saving = studio.saveChart();
    assert.equal(studio.state.saving, true); assert.equal(await studio.saveChart(), false);
    studio.closeChart(first); assert.equal(studio.state.documents.length, 1);
    studio.restore(); assert.match(studio.state.notice, /等待文件保存完成/);
    studio.setBpm(180);
    await studio.openChart(file('second.tja'));
    const second = studio.state.activeId;
    choose(disk.handle); assert.equal(await saving, true);
    assert.equal(disk.text, firstText); assert.equal(studio.state.activeId, second);
    assert.equal(studio.state.filename, 'second.tja'); assert.equal(studio.state.saving, false);
    studio.switchChart(first);
    assert.equal(studio.state.filename, 'saved-first.tja'); assert.equal(studio.state.chart.baseBpm, 180);
    assert.equal(studio.state.dirty, true); assert.equal(studio.state.saving, false);
    await studio.saveChart(); assert.equal(studio.state.dirty, false);
  } finally { cleanup(); }
});

test('save shortcuts work inside inputs, flush pending source and distinguish save as without stealing text undo', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  try {
    const disk = diskFile(), copy = diskFile('copy.tja', '');
    await studio.openChart(await disk.handle.getFile(), disk.handle);
    document.activeElement = { tagName: 'TEXTAREA' };
    let pickerCalls = 0, prevented = 0;
    window.showSaveFilePicker = async () => { pickerCalls++; return copy.handle; };
    const keydown = handlers.get('keydown');
    const event = changes => ({ key: 's', ctrlKey: true, shiftKey: false, preventDefault() { prevented++; }, ...changes });
    studio.editSource('4000,');
    keydown(event()); await new Promise(resolve => setImmediate(resolve));
    assert.equal(studio.state.invalid, false); assert.match(disk.text, /4000,/);
    assert.equal(studio.state.dirty, false); assert.equal(pickerCalls, 0);
    keydown(event({ key: 'S', shiftKey: true })); await new Promise(resolve => setImmediate(resolve));
    assert.equal(pickerCalls, 1); assert.equal(studio.state.filename, 'copy.tja');
    keydown(event({ repeat: true })); await new Promise(resolve => setImmediate(resolve));
    assert.equal(copy.calls.closes, 1);
    keydown(event({ key: 'z' })); assert.equal(prevented, 3);
    studio.editSource('broken');
    assert.equal(await studio.saveChart(), false);
    assert.equal(studio.state.invalid, true); assert.equal(copy.calls.closes, 1);
    assert.match(studio.state.notice, /修正小节源码/);
  } finally { cleanup(); }
});

test('unsupported browsers explicitly download copies without claiming direct-save success', async () => {
  const { studio, mock, cleanup } = mountStudio();
  const downloads = [], blobs = [];
  mock('URL', { createObjectURL(blob) { blobs.push(blob); return 'blob:download'; }, revokeObjectURL() {} });
  document.createElement = () => ({ click() { downloads.push(this.download); } });
  try {
    studio.newChart();
    assert.equal(await studio.saveChart(), true);
    assert.deepEqual(downloads, ['untitled.tja']); assert.equal(studio.state.dirty, true);
    assert.match(studio.state.notice, /不支持直接写回/);
    window.prompt = () => 'copy';
    await studio.saveAs();
    assert.equal(downloads[1], 'copy.tja'); assert.equal(studio.state.filename, 'copy.tja');
    assert.equal(studio.state.fileHandle, null); assert.equal(studio.state.dirty, true);
    assert.deepEqual([...new Uint8Array(await blobs[1].arrayBuffer()).slice(0, 3)], [239, 187, 191]);
    window.prompt = () => null;
    assert.equal(await studio.saveAs(), false); assert.equal(downloads.length, 2);
    window.prompt = () => '../invalid';
    assert.equal(await studio.saveAs(), false); assert.equal(downloads.length, 2);
    assert.equal(studio.state.error, true);
  } finally { cleanup(); }
});

test('save includes focused uncommitted file fields and refuses invalid values without writing stale content', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    const disk = diskFile(), copy = diskFile('renamed.tja', '');
    await studio.openChart(await disk.handle.getFile(), disk.handle);
    document.activeElement = { tagName: 'INPUT', id: 'base-bpm', value: '180' };
    assert.equal(await studio.saveChart(), true); assert.match(disk.text, /BPM:180/);
    document.activeElement.value = '0';
    assert.equal(await studio.saveChart(), false); assert.equal(disk.calls.closes, 1);
    document.activeElement = { tagName: 'INPUT', id: 'offset', value: '.25' };
    assert.equal(await studio.saveChart(), true); assert.match(disk.text, /OFFSET:0.25/);
    studio.selectCell({ bar: 0, numerator: 0, denominator: 1 }); studio.chooseNote('7');
    document.activeElement = { tagName: 'INPUT', id: 'balloon-count', value: '13' };
    assert.equal(await studio.saveChart(), true); assert.match(disk.text, /BALLOON:13/);
    document.activeElement = { tagName: 'INPUT', id: 'chart-name', value: '../invalid' };
    assert.equal(await studio.saveChart(), false); assert.equal(disk.calls.closes, 3);
    document.activeElement.value = 'renamed';
    window.showSaveFilePicker = async options => { assert.equal(options.suggestedName, 'renamed.tja'); return copy.handle; };
    assert.equal(await studio.saveChart(), true);
    assert.equal(studio.state.filename, 'renamed.tja'); assert.equal(copy.calls.closes, 1);
    assert.equal(disk.calls.closes, 3);
  } finally { cleanup(); }
});

test('unmounting during stream creation aborts without writing after the editor closes', async () => {
  const { studio, app, cleanup } = mountStudio();
  try {
    const disk = diskFile();
    let finish, aborted = false;
    disk.handle.createWritable = () => new Promise(resolve => { finish = resolve; });
    await studio.openChart(await disk.handle.getFile(), disk.handle); studio.setBpm(180);
    const saving = studio.saveChart();
    await new Promise(resolve => setImmediate(resolve));
    app.unmount();
    finish({ write() { assert.fail('Unmounted editors must not write'); }, close() { assert.fail('Unmounted editors must not commit'); }, async abort() { aborted = true; } });
    assert.equal(await saving, false); assert.equal(aborted, true);
    assert.equal(studio.state.saving, false); assert.equal(studio.state.dirty, true);
  } finally { cleanup(); }
});

function fakeAudio(mock) {
  const sources = [], decoded = [];
  const parameter = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {} });
  const buffer = (length = 8, rate = 1) => {
    const samples = new Float32Array(length).fill(.25);
    return { length, duration: length / rate, numberOfChannels: 1, getChannelData: () => samples };
  };
  const context = {
    currentTime: 0, sampleRate: 1000,
    async resume() {}, async close() {},
    createDynamicsCompressor() { return { connect() {}, threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() }; },
    createGain() { return { connect() {}, disconnect() {}, gain: parameter() }; },
    createBuffer(channels, length, rate) { return buffer(length, rate); },
    async decodeAudioData(bytes) { const result = { ...buffer(), marker: new Uint8Array(bytes)[0] }; decoded.push(result); return result; },
    createBufferSource() {
      const source = { playbackRate: parameter(), connect() {}, disconnect() {}, start(when, offset) { this.when = when; this.offset = offset; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    }
  };
  mock('AudioContext', function () { return context; });
  return { context, sources, decoded };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < .000001, `${actual} should equal ${expected}`);
const audioFile = (name = 'song.mp3', path = '', marker = 1) => ({ name, webkitRelativePath: path, arrayBuffer: async () => new Uint8Array([marker]).buffer });
const waveChart = wave => chart.replace('BPM:120', `WAVE:${wave}\nBPM:120`);

test('charts play synthesized notes without music, advance their own clock and stop at chart end', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context, sources } = fakeAudio(mock);
  try {
    await studio.openChart(file()); studio.controls.loop = false; await nextTick();
    assert.equal(studio.duration.value, 4);
    await studio.play();
    assert.equal(studio.state.playing, true); assert.equal(studio.state.buffer, null);
    assert.equal(sources.length, 1); near(sources[0].when, .035);
    context.currentTime = 1.035; ticks.frame(); near(studio.state.position, 1);
    context.currentTime = 1.98; ticks.schedule();
    assert.equal(sources.length, 2); near(sources[1].when, 2.035);
    context.currentTime = 4.1; ticks.schedule();
    assert.equal(studio.state.playing, false); assert.equal(studio.state.position, 4);
    assert.ok(sources.every(source => source.stopped));
    await studio.play(); assert.equal(studio.state.position, 0);
  } finally { cleanup(); }
});

test('unaccompanied playback loops and seeks without duplicate hits and changes rate without jumping', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context, sources } = fakeAudio(mock);
  try {
    await studio.openChart(file()); await studio.play();
    context.currentTime = 1.98; ticks.schedule();
    assert.equal(sources.length, 2); near(sources[1].when, 2.035);
    context.currentTime = 1.99; ticks.schedule(); assert.equal(sources.length, 2);
    context.currentTime = 2.535; ticks.frame(); near(studio.state.position, .5);
    studio.seek(1); await Promise.resolve();
    near(studio.state.position, 1);
    context.currentTime = 2.82; ticks.frame(); near(studio.state.position, 1.25);
    studio.controls.rate = 2; await nextTick(); await Promise.resolve();
    near(studio.state.position, 1.25);
    context.currentTime = 3.105; ticks.frame(); near(studio.state.position, 1.75);
    assert.equal(studio.state.playing, true);
  } finally { cleanup(); }
});

test('silent playback still stops without animation frames; music playback retains its buffer and duration', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context, sources } = fakeAudio(mock);
  try {
    await studio.openChart(file()); studio.controls.loop = false; studio.controls.hits = false; await nextTick();
    await studio.play();
    assert.equal(sources.length, 0); assert.match(studio.state.notice, /仅运行播放头/);
    context.currentTime = 4.1; ticks.schedule();
    assert.equal(studio.state.playing, false); assert.equal(studio.state.position, 4);
    await studio.openAudio(audioFile());
    assert.equal(studio.duration.value, 8);
    await studio.play(0);
    assert.equal(sources.at(-1).buffer, studio.state.buffer);
    sources.at(-1).onended();
    assert.equal(studio.state.playing, false); assert.equal(studio.state.position, 8);
  } finally { cleanup(); }
});

test('chart duration includes negative-delay overlaps and rejects charts wholly before zero', async () => {
  const { studio, mock, cleanup } = mountStudio();
  const { sources } = fakeAudio(mock);
  try {
    const overlapping = chart.replace('1000,\n2000,', '10\n#DELAY -3\n20,');
    await studio.openChart(file('overlap.tja', overlapping));
    assert.equal(studio.bar.value.end, -1); assert.equal(studio.duration.value, 1);
    await studio.play();
    assert.equal(studio.state.playing, true); assert.equal(sources.length, 1);
    await studio.openChart(file('negative.tja', chart.replace('OFFSET:0', 'OFFSET:100')));
    assert.equal(studio.duration.value, 0);
    await studio.play(); assert.equal(studio.state.playing, false); assert.match(studio.state.notice, /正时间区间/);
  } finally { cleanup(); }
});

test('native read-only directory grants resolve WAVE relative to the chart and never replace manually loaded audio', async () => {
  const { studio, mock, cleanup } = mountStudio();
  const { decoded } = fakeAudio(mock);
  try {
    const disk = diskFile('fixture.tja', waveChart('music\\song.mp3')), audio = audioFile();
    const music = { async getFileHandle(name) { assert.equal(name, 'song.mp3'); return { getFile: async () => audio }; } };
    const pack = { async getDirectoryHandle(name) { assert.equal(name, 'music'); return music; } };
    window.showDirectoryPicker = async options => {
      assert.equal(options.mode, 'read');
      return { name: 'Songs', async resolve(handle) { assert.equal(handle, disk.handle); return ['pack', 'fixture.tja']; }, async getDirectoryHandle(name) { assert.equal(name, 'pack'); return pack; } };
    };
    await studio.chooseMediaDirectory();
    await studio.openChart(await disk.handle.getFile(), disk.handle);
    assert.equal(studio.state.audioName, 'song.mp3'); assert.equal(studio.state.buffer, decoded[0]);
    assert.equal(studio.state.mediaDirectoryName, 'Songs');
    await studio.openAudio(audioFile('manual.wav', '', 2));
    await studio.autoAudio();
    assert.equal(studio.state.audioName, 'manual.wav'); assert.equal(studio.state.buffer.marker, 2);
    assert.equal(decoded.length, 2);
  } finally { cleanup(); }
});

test('directory file selection matches current and future charts and preserves each chart audio on switches', async () => {
  const { studio, mock, cleanup } = mountStudio();
  fakeAudio(mock);
  try {
    await studio.openChart(file('first.tja', waveChart('song.mp3')));
    assert.equal(studio.state.buffer, null); assert.match(studio.state.notice, /关联音频文件夹/);
    const first = studio.state.activeId;
    const indexedChart = (name, path) => ({ ...file(name), webkitRelativePath: path });
    await studio.setMediaFiles([
      indexedChart('first.tja', 'Songs/a/first.tja'), audioFile('song.mp3', 'Songs/a/song.mp3', 1),
      indexedChart('second.tja', 'Songs/b/second.tja'), audioFile('song.mp3', 'Songs/b/song.mp3', 2)
    ]);
    assert.equal(studio.state.buffer.marker, 1);
    await studio.openChart(file('second.tja', waveChart('song.mp3')));
    assert.equal(studio.state.buffer.marker, 2);
    studio.switchChart(first); assert.equal(studio.state.buffer.marker, 1);
    await studio.openChart(file('missing.tja', waveChart('missing.mp3')));
    assert.equal(studio.state.buffer, null); assert.equal(studio.state.error, true);
    assert.match(studio.state.notice, /无伴奏播放/);
    await studio.play(); assert.equal(studio.state.playing, true);
  } finally { cleanup(); }
});

test('manual audio and chart switches supersede pending automatic WAVE reads', async () => {
  const { studio, mock, cleanup } = mountStudio();
  fakeAudio(mock);
  try {
    await studio.openChart(file('fixture.tja', waveChart('song.mp3')), {});
    let finish;
    window.showDirectoryPicker = async () => ({
      name: 'Songs',
      resolve: () => new Promise(resolve => { finish = resolve; }),
      getFileHandle: async () => ({ getFile: async () => audioFile() })
    });
    const granting = studio.chooseMediaDirectory(); await Promise.resolve();
    await studio.openAudio(audioFile('manual.wav', '', 9));
    finish(['fixture.tja']); await granting;
    assert.equal(studio.state.buffer.marker, 9); assert.equal(studio.state.audioName, 'manual.wav');
    const first = studio.state.activeId;
    studio.newChart(); studio.switchChart(first);
    studio.state.buffer = null;
    const pending = studio.autoAudio(); await Promise.resolve();
    studio.newChart(); finish(['fixture.tja']); await pending;
    assert.equal(studio.state.buffer, null);
  } finally { cleanup(); }
});

test('directory cancellation, denied permissions and corrupt audio are explicit and leave chart playback usable', async () => {
  const { studio, mock, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  try {
    await studio.openChart(file('fixture.tja', waveChart('song.mp3')));
    window.showDirectoryPicker = async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); };
    assert.equal(await studio.chooseMediaDirectory(), false); assert.equal(studio.state.error, false);
    window.showDirectoryPicker = async () => { throw new Error('permission denied'); };
    assert.equal(await studio.chooseMediaDirectory(), false); assert.match(studio.state.notice, /permission denied/);
    context.decodeAudioData = async () => { throw new Error('corrupt audio'); };
    await studio.setMediaFiles([audioFile('song.mp3', 'Songs/song.mp3')]);
    assert.equal(studio.state.buffer, null); assert.match(studio.state.notice, /corrupt audio/);
    assert.equal(studio.state.error, true);
    await studio.play(); assert.equal(studio.state.playing, true);
  } finally { cleanup(); }
});

test('long notes play without music and a pending resume cannot start a different chart', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context, sources } = fakeAudio(mock);
  try {
    await studio.openChart(file('roll.tja', chart.replace('1000,', '5008,')));
    await studio.play();
    assert.equal(sources.length, 2);
    context.currentTime = .1; ticks.schedule(); assert.equal(sources.length, 3);
    studio.pause(); assert.equal(studio.state.playing, false);
    let resume;
    context.resume = () => new Promise(resolve => { resume = resolve; });
    const playing = studio.play();
    studio.newChart(); resume(); await playing;
    assert.equal(studio.state.playing, false);
    assert.ok(sources.every(source => source.stopped));
  } finally { cleanup(); }
});

test('closing an inactive chart cannot cancel manual audio, while closing the active chart matches the next WAVE', async () => {
  const { studio, mock, cleanup } = mountStudio();
  fakeAudio(mock);
  try {
    await studio.openChart(file('first.tja', waveChart('song.mp3')));
    const first = studio.state.activeId;
    await studio.openChart(file('second.tja', waveChart('song.mp3')));
    await studio.setMediaFiles([audioFile('song.mp3', 'Songs/song.mp3')]);
    studio.state.buffer = null;
    let finish;
    const loading = studio.openAudio({ name: 'manual.wav', arrayBuffer: () => new Promise(resolve => { finish = resolve; }) });
    studio.closeChart(first); finish(new Uint8Array([9]).buffer); await loading;
    assert.equal(studio.state.audioName, 'manual.wav'); assert.equal(studio.state.buffer.marker, 9);
    const second = studio.state.activeId;
    studio.state.buffer = null;
    studio.newChart();
    studio.closeChart(studio.state.activeId);
    await new Promise(setImmediate);
    assert.equal(studio.state.activeId, second); assert.equal(studio.state.audioName, 'song.mp3');
  } finally { cleanup(); }
});

test('folder authorization and decoded audio are runtime-only; restore can match again after granting access', async () => {
  const saved = new Map(), mounted = mountStudio(saved);
  fakeAudio(mounted.mock);
  try {
    await mounted.studio.openChart(file('fixture.tja', waveChart('song.mp3')));
    await mounted.studio.setMediaFiles([audioFile('song.mp3', 'Songs/song.mp3')]);
    mounted.studio.setBpm(150);
    assert.equal(mounted.studio.state.buffer.marker, 1);
    assert.ok(!JSON.stringify(workspace(saved)).includes('Songs'));
  } finally { mounted.cleanup(); }
  const restored = mountStudio(saved);
  const { context } = fakeAudio(restored.mock);
  try {
    assert.equal(restored.studio.state.mediaDirectoryName, '');
    assert.equal(restored.studio.state.buffer, null);
    assert.equal(restored.studio.state.chart.baseBpm, 150);
    await restored.studio.setMediaFiles([audioFile('song.mp3', 'Songs/song.mp3', 2)]);
    assert.equal(restored.studio.state.buffer.marker, 2);
    const decode = context.decodeAudioData;
    context.decodeAudioData = async bytes => ({ ...await decode(bytes), duration: .5 });
    restored.studio.seek(7);
    await restored.studio.openAudio(audioFile('short.wav', '', 3));
    assert.equal(restored.studio.state.position, .5);
  } finally { restored.cleanup(); }
});

test('loop range applies while playing, clamps both endpoints, restarts at the range start and rejects only completed invalid ranges', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  try {
    await studio.openChart(file()); studio.controls.loop = false; await nextTick();
    await studio.play();
    context.currentTime = 1.035; ticks.frame(); near(studio.state.position, 1);
    assert.equal(studio.setLoop(2, 200), true);
    await Promise.resolve();
    assert.deepEqual(studio.range.value, [2, 2]); near(studio.state.position, 2);
    assert.equal(studio.state.selected, 1);
    assert.equal(studio.state.playing, true);
    context.currentTime = 1.57; ticks.frame(); near(studio.state.position, 2.5);
    assert.equal(studio.setLoop(-100, 200), true); await Promise.resolve();
    assert.deepEqual(studio.range.value, [1, 2]); near(studio.state.position, 0);
    assert.equal(studio.setLoop(2, 1), undefined);
    assert.deepEqual(studio.range.value, [1, 2]); assert.equal(studio.state.playing, true);
    assert.match(studio.state.notice, /结束小节不能早于/);
    assert.equal(studio.setLoop(1.5, 2), undefined);
    assert.deepEqual(studio.range.value, [1, 2]);
    studio.controls.loop = true; await nextTick(); await Promise.resolve();
    studio.setLoop(2, 2); await Promise.resolve();
    context.currentTime = 4.105; ticks.frame(); near(studio.state.position, 2.5);
    assert.equal(studio.state.playing, true);
    studio.pause(); studio.setLoop(99, 99); assert.deepEqual(studio.range.value, [2, 2]); near(studio.state.position, 2);
  } finally { cleanup(); }
});

test('song metadata is one undoable edit, survives saving/restoring, and WAVE edits invalidate and rematch audio', async () => {
  const saved = new Map(), mounted = mountStudio(saved);
  fakeAudio(mounted.mock);
  const { studio } = mounted;
  try {
    await studio.openChart(file('fixture.tja', waveChart('song.mp3')));
    await studio.setMediaFiles([audioFile('song.mp3', 'Songs/song.mp3', 1), audioFile('next.mp3', 'Songs/next.mp3', 2)]);
    assert.equal(studio.setMetadata({ TITLE: 'Edited title', ARTIST: 'Artist', BPM: '150', OFFSET: '-.5' }), true);
    assert.equal(studio.state.undo.length, 1); assert.equal(studio.state.buffer.marker, 1);
    assert.equal(studio.state.chart.title, 'Edited title'); assert.equal(studio.metadata.value.ARTIST, 'Artist');
    const updated = studio.state.text;
    assert.equal(studio.setMetadata({ BPM: '-1', TITLE: 'Rejected' }), undefined);
    assert.equal(studio.state.text, updated);
    studio.history(); assert.equal(studio.state.chart.title, 'Vue session');
    studio.history(true); assert.equal(studio.state.chart.title, 'Edited title');
    assert.equal(studio.setMetadata({ WAVE: 'next.mp3' }), true);
    assert.equal(studio.state.buffer, null);
    await new Promise(setImmediate); assert.equal(studio.state.buffer.marker, 2);
    studio.history(); await new Promise(setImmediate);
    assert.equal(studio.state.buffer.marker, 1);
    studio.history(true); await new Promise(setImmediate);
    assert.equal(studio.state.buffer.marker, 2);
    const disk = diskFile('saved.tja');
    window.showSaveFilePicker = async () => disk.handle;
    assert.equal(await studio.saveChart(), true);
    assert.equal(disk.text, studio.state.text); assert.equal(studio.state.dirty, false);
  } finally { mounted.cleanup(); }
  const restored = mountStudio(saved);
  try { assert.equal(restored.studio.metadata.value.ARTIST, 'Artist'); assert.equal(restored.studio.metadata.value.WAVE, 'next.mp3'); }
  finally { restored.cleanup(); }
});

test('space toggles playback from the timeline and editing buttons without repeating while held', async () => {
  const { studio, handlers, mock, cleanup } = mountStudio();
  fakeAudio(mock);
  let prevented = 0;
  const press = repeat => handlers.get('keydown')({ key: ' ', code: 'Space', repeat, preventDefault() { prevented++; } });
  try {
    await studio.openChart(file());
    for (const tagName of ['DIV', 'BUTTON']) {
      document.activeElement = { tagName };
      press(false); await Promise.resolve();
      assert.equal(studio.state.playing, true);
      press(true); assert.equal(studio.state.playing, true);
      press(false); assert.equal(studio.state.playing, false);
      press(true); assert.equal(studio.state.playing, false);
    }
    assert.equal(prevented, 8);
  } finally { cleanup(); }
});

test('space preserves typing, disclosure, dialog, modified and composing keyboard actions', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const press = overrides => handlers.get('keydown')({ key: ' ', code: 'Space', preventDefault() { assert.fail('Native keyboard action must be preserved'); }, ...overrides });
  try {
    await studio.openChart(file());
    for (const activeElement of [
      ...['INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY'].map(tagName => ({ tagName })),
      { tagName: 'DIV', isContentEditable: true },
      { tagName: 'BUTTON', closest: selector => { assert.equal(selector, 'dialog, [role="dialog"]'); return {}; } }
    ]) {
      document.activeElement = activeElement;
      press({});
      assert.equal(studio.state.playing, false);
    }
    document.activeElement = { tagName: 'DIV' };
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) press({ [modifier]: true });
    assert.equal(studio.state.playing, false);
  } finally { cleanup(); }
});

const longChart = chart.replace('1000,\n2000,', '1000,\n'.repeat(10).trimEnd());

test('timeline panning is continuous and independent of selection, playback, text and per-chart history', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('first.tja', longChart));
    const first = studio.state.activeId, original = studio.state.text;
    studio.panTimeline(.375);
    near(studio.visible.value.start, .375); near(studio.visible.value.end, 4.375);
    assert.equal(studio.state.selected, 0); assert.equal(studio.state.position, 0);
    assert.equal(studio.state.text, original); assert.equal(studio.state.undo.length, 0);
    studio.panTimeline(4.125);
    assert.deepEqual(studio.visible.value.bars.map(item => item.index), [2, 3, 4]);
    studio.selectCell({ bar: 2, numerator: 1, denominator: 4, divisions: 16 });
    near(studio.visible.value.start, 4.125);
    studio.controls.view = 1; near(studio.visible.value.end, 6.125);
    assert.equal(studio.state.followPlayback, false);
    await studio.openChart(file('second.tja', longChart)); studio.panTimeline(9.25);
    studio.switchChart(first);
    near(studio.visible.value.start, 4.125); assert.equal(studio.state.followPlayback, false);
    assert.equal(studio.cell.value.numerator, 1);
    studio.editSource('unfinished');
    studio.panTimeline(5.5);
    assert.equal(studio.state.source, 'unfinished'); assert.equal(studio.state.invalid, true);
  } finally { cleanup(); }
});

test('timeline bounds include audio tails and negative timing segments and clamp scrolling at both ends', async () => {
  const { studio, mock, cleanup } = mountStudio();
  fakeAudio(mock);
  try {
    await studio.openChart(file()); await studio.openAudio(audioFile());
    assert.equal(studio.timelineBounds.value.end, 8);
    studio.panTimeline(1000); near(studio.visible.value.start, 4); near(studio.visible.value.end, 8);
    studio.panTimeline(-1000); near(studio.visible.value.start, 0);
    studio.panTimeline(Infinity); assert.match(studio.state.notice, /有限数值/);
    studio.controls.view = 8; near(studio.visible.value.start, 0); near(studio.viewSpan.value, 16);
    await studio.openChart(file('overlap.tja', chart.replace('1000,\n2000,', '10\n#DELAY -3\n20,')));
    assert.equal(studio.timelineBounds.value.start, -2); assert.equal(studio.timelineBounds.value.end, 1);
    studio.controls.view = 1; studio.panTimeline(-2);
    near(studio.visible.value.start, -2); near(studio.visible.value.end, 0);
    assert.ok(studio.visible.value.bars.some(item => item.index === 0));
  } finally { cleanup(); }
});

test('playback holds each page until its boundary and manual panning suspends follow without pausing music', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  try {
    await studio.openChart(file('long.tja', longChart)); studio.controls.loop = false; await nextTick();
    await studio.play();
    context.currentTime = 1.535; ticks.frame(); near(studio.visible.value.start, 0);
    context.currentTime = 4.034; ticks.frame(); near(studio.visible.value.start, 0);
    context.currentTime = 4.035; ticks.frame(); near(studio.visible.value.start, 4);
    context.currentTime = 4.135; ticks.frame(); near(studio.visible.value.start, 4);
    studio.panTimeline(8.25);
    context.currentTime = 5.035; ticks.frame();
    near(studio.visible.value.start, 8.25); near(studio.state.position, 5);
    assert.equal(studio.state.playing, true); assert.equal(studio.state.selected, 2);
    studio.state.followPlayback = true; await nextTick(); ticks.frame();
    near(studio.visible.value.start, 4.25); assert.equal(studio.state.selected, 2);
    studio.controls.rate = .5; await nextTick(); await Promise.resolve();
    context.currentTime = 6.07; ticks.frame(); near(studio.state.position, 5.5); near(studio.visible.value.start, 4.25);
    context.currentTime = 12.07; ticks.frame(); near(studio.visible.value.start, 8.25);
    await studio.play(17.25);
    near(studio.visible.value.start, 16); near(studio.visible.value.end, 20);
  } finally { cleanup(); }
});

test('loop wrap and explicit navigation reposition the viewport without changing loop boundaries', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  try {
    await studio.openChart(file('long.tja', longChart)); studio.setLoop(2, 5); await studio.play();
    context.currentTime = 2.535; ticks.frame(); near(studio.visible.value.start, 2);
    context.currentTime = 4.035; ticks.frame(); near(studio.visible.value.start, 6);
    context.currentTime = 8.535; ticks.frame(); near(studio.visible.value.start, 2);
    assert.deepEqual(studio.range.value, [2, 5]); assert.equal(studio.state.playing, true);
    studio.pause(); studio.panTimeline(10.2);
    studio.select(1); near(studio.visible.value.start, 2); assert.equal(studio.state.followPlayback, true);
    studio.panTimeline(8.5); studio.setLoop(3, 4); near(studio.visible.value.start, 4);
  } finally { cleanup(); }
});