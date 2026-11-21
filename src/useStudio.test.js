import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, nextTick } from 'vue';
import { useStudio } from './useStudio.js';
import { locale, formatMessage } from './i18n.js';
import { drawNote } from './note-render.js';
import { COURSE_NAMES, courseLevel } from './courses.js';

const chart = 'TITLE:Vue session\nBPM:120\nOFFSET:0\nCOURSE:Oni\nLEVEL:1\n#START\n1000,\n2000,\n#END\n';

test('chart pickers allow unknown Android MIME types while application validation rejects non-TJA files', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    const selected = file('phone.TJA'); selected.type = 'application/octet-stream';
    window.showOpenFilePicker = async options => {
      assert.equal(options.multiple, true); assert.equal(options.types, undefined);
      return [{ getFile: async () => selected }];
    };
    await studio.openCharts();
    assert.equal(studio.state.filename, 'phone.TJA');
    const text = studio.state.text, notice = studio.state.notice;
    await studio.openChart({ name: 'not-a-chart.txt', arrayBuffer() { assert.fail('Rejected files must not be read'); } });
    assert.equal(studio.state.text, text); assert.equal(studio.state.documents.length, 1);
    assert.equal(studio.state.notice, notice); assert.equal(studio.state.error, false);
    assert.match(formatMessage(studio.state.fileErrors[0].error), /\.tja/);
  } finally { cleanup(); }
});

test('file read and parse errors queue for dialogs without replacing the current document or inline notice', async () => {
  const { studio, saved, cleanup } = mountStudio();
  try {
    await studio.openChart(file());
    studio.setBpm(150); studio.select(1);
    const text = studio.state.text, chart = studio.state.chart, undo = studio.state.undo;
    const notice = studio.state.notice, selected = studio.state.selected;
    await studio.openChart(file('broken.tja', 'invalid'));
    await studio.openChart({ name: 'unreadable.tja', async arrayBuffer() { throw new Error('Read denied'); } });
    assert.deepEqual(studio.state.fileErrors.map(item => item.filename), ['broken.tja', 'unreadable.tja']);
    assert.match(formatMessage(studio.state.fileErrors[1].error), /Read denied/);
    assert.equal(studio.state.text, text); assert.equal(studio.state.chart, chart);
    assert.equal(studio.state.undo, undo); assert.equal(studio.state.selected, selected);
    assert.equal(studio.state.notice, notice); assert.equal(studio.state.error, false);
    await studio.openChart(file('valid.tja'));
    assert.equal(studio.state.filename, 'valid.tja'); assert.equal(studio.state.documents.length, 2);
    assert.equal(studio.state.fileErrors.length, 2);
    assert.ok(!JSON.stringify(workspace(saved)).includes('fileErrors'));
  } finally { cleanup(); }
});

test('canceling file selection is not a modal error while picker failures are queued', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    window.showOpenFilePicker = async () => { const error = new Error('Canceled'); error.name = 'AbortError'; throw error; };
    await studio.openCharts();
    assert.equal(studio.state.fileErrors.length, 0); assert.equal(studio.state.error, false);
    const notice = studio.state.notice;
    window.showOpenFilePicker = async () => { throw new Error('Picker denied'); };
    await studio.openCharts();
    assert.equal(studio.state.fileErrors.length, 1);
    assert.match(formatMessage(studio.state.fileErrors[0].error), /Picker denied/);
    assert.equal(studio.state.notice, notice);
  } finally { cleanup(); }
});

test('confirmed PWA reload persists pending source and history without a second unload warning', async () => {
  const { studio, handlers, saved, cleanup } = mountStudio();
  try {
    await studio.openChart(file()); studio.setBpm(150); studio.editSource('invalid source');
    let reloaded = false;
    window.location = { reload: () => { reloaded = true; } };
    assert.equal(studio.reloadForUpdate(), true); assert.equal(reloaded, true);
    const document = workspace(saved).documents[0];
    assert.equal(document.source, 'invalid source'); assert.equal(document.invalid, true);
    assert.equal(document.undo.length, 1); assert.match(document.text, /BPM:150/);
    handlers.get('beforeunload')({ preventDefault() { assert.fail('Restart was already confirmed'); } });
  } finally { cleanup(); }
});

test('PWA reload refuses in-progress saves and failed draft storage', async () => {
  const { studio, handlers, mock, cleanup } = mountStudio();
  try {
    await studio.openChart(file()); studio.setBpm(150);
    window.location = { reload() { assert.fail('Unsafe reload must be blocked'); } };
    studio.state.saving = true; assert.equal(studio.reloadForUpdate(), false);
    studio.state.saving = false;
    mock('localStorage', { setItem() { throw new Error('Storage full'); }, getItem() { return null; } });
    assert.equal(studio.reloadForUpdate(), false); assert.equal(studio.state.error, true);
    let warned = false;
    handlers.get('beforeunload')({ preventDefault() { warned = true; } });
    assert.equal(warned, true);
  } finally { cleanup(); }
});

test('Q/E seeks adjacent measure starts using actual tempo and meter without changing selected notes or edits', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const press = (key, extra = {}) => handlers.get('keydown')({ key, preventDefault() {}, ...extra });
  try {
    await studio.openChart(file('seek.tja', chart.replace('2000,', '#BPMCHANGE 60\n#MEASURE 3/4\n2000,\n#BPMCHANGE 240\n#MEASURE 4/4\n3000,')));
    studio.selectCell({ bar: 0, numerator: 1, denominator: 4, divisions: 16 });
    const selection = { ...studio.state.selectedCell }, command = { ...studio.state.commandCell };
    const source = studio.state.source, text = studio.state.text, history = studio.state.undo.length;
    studio.seek(.5); press('e'); near(studio.state.position, 2);
    press('e'); near(studio.state.position, 5);
    studio.seek(5.5); press('e'); near(studio.state.position, 5.5);
    press('q'); near(studio.state.position, 2);
    press('q'); near(studio.state.position, 0);
    press('q'); near(studio.state.position, 0);
    press('e', { repeat: true }); near(studio.state.position, 0);
    studio.seek(studio.duration.value); press('Q'); near(studio.state.position, 5);
    assert.equal(studio.state.playing, false); assert.equal(studio.state.selected, 0);
    assert.deepEqual(studio.state.selectedCell, selection); assert.deepEqual(studio.state.commandCell, command);
    assert.equal(studio.state.source, source); assert.equal(studio.state.text, text);
    assert.equal(studio.state.undo.length, history); assert.equal(studio.range.value, null);
  } finally { cleanup(); }
});

test('Q/E uses the live audio clock instead of the selected measure or last animation frame and resumes active playback', async () => {
  const { studio, handlers, mock, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  try {
    await studio.openChart(file('live-seek.tja', chart.replace('2000,', '2000,\n3000,\n4000,')));
    studio.selectCell({ bar: 0, numerator: 0, denominator: 4, divisions: 16 });
    await studio.play(); studio.state.followPlayback = false;
    context.currentTime = 3.035;
    handlers.get('keydown')({ key: 'e', preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    near(studio.state.position, 4); assert.equal(studio.state.playing, true); assert.equal(studio.state.selected, 0);
    context.currentTime += .2;
    handlers.get('keydown')({ key: 'q', preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    near(studio.state.position, 2); assert.equal(studio.state.playing, true);
    assert.equal(studio.state.selectedCell.bar, 0); assert.equal(studio.state.undo.length, 0);
  } finally { cleanup(); }
});

test('Q/E preserves native input, dialog, composition and modified shortcuts and ignores empty or invalid charts', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const native = extra => handlers.get('keydown')({ key: 'e', preventDefault() { assert.fail('Native key must not be consumed'); }, ...extra });
  try {
    native(); studio.newChart(); native();
    await studio.openChart(file());
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) { document.activeElement = { tagName }; native(); }
    document.activeElement = { isContentEditable: true }; native();
    document.activeElement = { closest: () => ({}) }; native();
    document.activeElement = null;
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) native({ [modifier]: true });
    studio.state.invalid = true; native();
    assert.equal(studio.state.position, 0);
  } finally { cleanup(); }
});

test('empty-song difficulty actions create exactly one blank single-player chart for each difficulty and preserve song metadata and history', () => {
  const { studio, cleanup } = mountStudio();
  try {
    for (const course of COURSE_NAMES) {
      studio.newChart(); studio.setMetadata({ TITLE: 'Keep this song', SUBTITLE: 'Keep subtitle' });
      const before = studio.state.text, id = studio.state.activeId, documents = studio.state.documents.length;
      assert.equal(studio.createCourse({ course, player: 'single', style: 'Single', level: 1 }), true);
      assert.equal(studio.state.activeId, id); assert.equal(studio.state.documents.length, documents);
      assert.equal(studio.state.chart.variants.length, 1); assert.equal(studio.state.chart.variant.course, course);
      assert.equal(studio.state.chart.variant.player, 'single'); assert.equal(studio.state.chart.variant.style, 'Single');
      assert.equal(studio.state.chart.bars.length, 1); assert.match(studio.bar.value.notes, /^0+$/);
      assert.equal(studio.metadata.value.TITLE, 'Keep this song'); assert.equal(studio.metadata.value.SUBTITLE, 'Keep subtitle');
      studio.history(); assert.equal(studio.state.text, before); assert.equal(studio.bar.value, undefined);
      studio.history(true); assert.equal(studio.state.chart.variant.course, course);
    }
  } finally { cleanup(); }
});

test('new and restored files have no selected range; switching preserves each file selection', async () => {
  const saved = new Map(), mounted = mountStudio(saved);
  const { studio, mock, ticks } = mounted;
  const { context } = fakeAudio(mock);
  try {
    assert.equal(studio.range.value, null);
    await studio.openChart(file()); const first = studio.state.activeId;
    await studio.play(); context.currentTime = 2.535; ticks.frame();
    near(studio.state.position, 2.5); assert.equal(studio.state.selected, 1);
    context.currentTime = 4.1; ticks.schedule(); assert.equal(studio.state.playing, false);
    studio.setLoop(1, 2); assert.deepEqual(studio.range.value, [1, 2]);
    await studio.openChart(file('second.tja')); assert.equal(studio.range.value, null);
    studio.setLoop(2, 2); studio.switchChart(first);
    assert.deepEqual(studio.range.value, [1, 2]);
    studio.newChart(); assert.equal(studio.range.value, null);
  } finally { mounted.cleanup(); }
  const restored = mountStudio(saved);
  try { assert.equal(restored.studio.range.value, null); } finally { restored.cleanup(); }
});

test('measure clipboard is shared between file tabs and paste is one undoable transaction with selection remapping', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('copy.tja', chart));
    studio.setLoop(1, 2); studio.select(1); studio.seek(.5);
    assert.equal(studio.copyMeasures(), true);
    assert.equal(studio.state.undo.length, 0); assert.equal(studio.state.selected, 1);
    assert.equal(studio.state.position, .5); assert.deepEqual(studio.range.value, [1, 2]);
    const clipboard = studio.state.copiedMeasures;
    await studio.openChart(file('paste.tja', chart.replace('1000,\n2000,', '3000,\n4000,')));
    studio.setLoop(2, 2); studio.select(0); studio.selectNote(1, 1); studio.select(0);
    assert.equal(studio.state.copiedMeasures, clipboard);
    const before = studio.state.text;
    assert.equal(studio.requestPaste(), true); assert.equal(studio.state.pasteRequest, 1);
    assert.equal(studio.pasteMeasures('insert'), true);
    assert.deepEqual(studio.state.chart.bars.map(bar => bar.notes), ['1000', '2000', '3000', '4000']);
    assert.deepEqual(studio.range.value, [4, 4]); assert.equal(studio.state.selectedCell, null);
    assert.equal(studio.state.undo.length, 1); assert.equal(studio.state.selected, 0);
    studio.history(); assert.equal(studio.state.text, before); assert.deepEqual(studio.range.value, [2, 2]);
    studio.history(true); assert.equal(studio.state.chart.bars.length, 4);
    studio.history(); studio.select(1);
    assert.equal(studio.pasteMeasures('overwrite'), true);
    assert.deepEqual(studio.state.chart.bars.map(bar => bar.notes), ['3000', '1000', '2000']);
    assert.equal(studio.state.undo.length, 1);
  } finally { cleanup(); }
});

test('unsafe branch overwrite and invalid source leave chart, selections and history untouched', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('copy.tja', chart)); studio.setLoop(1, 2); studio.copyMeasures();
    await studio.openChart(file('branch.tja', branchChart)); studio.select(0);
    const before = studio.state.text;
    assert.equal(studio.pasteMeasures('overwrite'), undefined);
    assert.match(studio.state.notice, /分歧边界，无法粘贴/); assert.equal(studio.state.error, true);
    assert.equal(studio.state.text, before); assert.equal(studio.state.undo.length, 0);
    assert.deepEqual(studio.state.branchRoutes, ['N']); assert.equal(studio.state.selected, 0);
    const clipboard = studio.state.copiedMeasures;
    studio.editSource('invalid source');
    assert.equal(studio.copyMeasures(), undefined); assert.equal(studio.state.copiedMeasures, clipboard);
    assert.equal(studio.requestPaste(), undefined); assert.equal(studio.state.pasteRequest, 0);
    assert.equal(studio.pasteMeasures('insert'), undefined); assert.equal(studio.state.text, before);
  } finally { cleanup(); }
});

test('measure clipboard and selection shortcuts preserve native editing, modal keys, modifiers and repeats', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const press = (key, extra = {}) => handlers.get('keydown')({ key, ctrlKey: true, preventDefault() {}, ...extra });
  try {
    await studio.openChart(file());
    studio.select(1); press('a'); assert.deepEqual(studio.range.value, [1, 2]);
    press('A', { shiftKey: true }); assert.deepEqual(studio.range.value, [2, 2]);
    press('c'); assert.equal(studio.state.copiedMeasures.length, 1);
    assert.match(studio.state.copiedMeasures[0].source, /2000/);
    press('v'); assert.equal(studio.state.pasteRequest, 1);
    press('v', { repeat: true }); assert.equal(studio.state.pasteRequest, 1);
    studio.state.editorBlocked = true;
    for (const key of ['a', 'c', 'v', 'z', 'q', 'e', 'f', '1']) press(key, { ctrlKey: ['a', 'c', 'v', 'z'].includes(key), preventDefault() { assert.fail('Covered editor shortcuts must not execute'); } });
    assert.equal(studio.state.pasteRequest, 1); assert.equal(studio.state.undo.length, 0);
    studio.state.editorBlocked = false;
    const native = extra => press('a', { preventDefault() { assert.fail('Native key must not be consumed'); }, ...extra });
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) { document.activeElement = { tagName }; native({}); }
    document.activeElement = { isContentEditable: true }; native({});
    document.activeElement = { closest: () => ({}) }; native({});
    document.activeElement = null;
    native({ altKey: true }); native({ isComposing: true }); native({ keyCode: 229 }); native({ defaultPrevented: true });
    press('a', { ctrlKey: false, metaKey: true }); assert.deepEqual(studio.range.value, [1, 2]);
    document.getSelection = () => ({ toString: () => 'Selected help text' });
    press('c', { preventDefault() { assert.fail('Text copying must remain native'); } });
  } finally { cleanup(); }
});

test('viewing another measure preserves note and range selections and the playback position; note edits target the selected note', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('independent.tja', chart.replace('2000,', '2000,\n3000,\n#BPMCHANGE 240\n4000,')));
    studio.selectNote(0, 1); studio.setLoop(2, 3); studio.seek(.75);
    const note = studio.state.selectedCell;
    studio.select(3);
    assert.equal(studio.state.selected, 3); assert.equal(studio.state.selectedCell, note);
    assert.deepEqual(studio.range.value, [2, 3]); near(studio.state.position, .75);
    assert.equal(studio.state.followPlayback, false); assert.equal(studio.command.value.bar, 3);
    assert.equal(studio.command.value.numerator, 0); assert.match(studio.state.source, /4000/);
    assert.equal(studio.command.value.timing.bpm, 240); assert.equal(studio.currentTiming.value.bpm, 120);
    studio.chooseNote('2');
    assert.equal(studio.state.chart.bars[0].notes, '2000'); assert.equal(studio.bar.value.notes, '4000');
    assert.equal(studio.state.selected, 3); assert.deepEqual(studio.range.value, [2, 3]);
  } finally { cleanup(); }
});

test('viewing during playback does not restart music, and selected notes survive playback following and clearing the range', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context, sources } = fakeAudio(mock);
  try {
    await studio.openChart(file('playing-selection.tja', chart.replace('2000,', '2000,\n3000,\n4000,')));
    await studio.openAudio(audioFile()); studio.controls.hits = false;
    studio.selectNote(0, 1); studio.setLoop(2, 3); await studio.play();
    const music = sources.at(-1), count = sources.length, note = studio.state.selectedCell;
    context.currentTime = .535; ticks.frame(); near(studio.state.position, 2.5);
    assert.equal(studio.state.selectedCell, note);
    studio.select(3);
    assert.equal(studio.state.playing, true); assert.equal(music.stopped, undefined);
    assert.equal(sources.length, count); near(studio.state.position, 2.5);
    assert.equal(studio.state.selected, 3); assert.equal(studio.state.followPlayback, false);
    context.currentTime = .735; ticks.frame(); near(studio.state.position, 2.7);
    studio.clearLoop(); await Promise.resolve();
    near(studio.state.position, 2.7); assert.equal(studio.state.selectedCell, note);
    context.currentTime = 4.07; ticks.frame(); near(studio.state.position, 6);
    assert.equal(studio.state.playing, true); assert.equal(studio.state.selectedCell, note);
    context.currentTime = 6.17; ticks.schedule();
    assert.equal(studio.state.playing, false); near(studio.state.position, 8);
  } finally { cleanup(); }
});

test('note selectors count only actual notes, skip empty measures, retain the range and report invalid or exhausted selections', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('note-selection.tja', chart.replace('1000,\n2000,', '1002,\n0000,\n0030,')));
    studio.setLoop(2, 3);
    assert.equal(studio.selectNote(0, 2), true);
    assert.equal(studio.cell.value.note, '2'); assert.equal(studio.cell.value.numerator, 3);
    assert.equal(studio.selectAdjacentNote(1), true);
    assert.equal(studio.cell.value.bar, 2); assert.equal(studio.cell.value.note, '3');
    const last = studio.state.selectedCell;
    assert.equal(studio.selectAdjacentNote(1), undefined); assert.match(studio.state.notice, /没有下一个音符/);
    assert.equal(studio.state.selectedCell, last); assert.deepEqual(studio.range.value, [2, 3]);
    assert.equal(studio.selectAdjacentNote(-1), true); assert.equal(studio.cell.value.bar, 0);
    assert.equal(studio.selectNote(1, 1), undefined); assert.match(studio.state.notice, /只有 0 个音符/);
    assert.equal(studio.selectNote(99, 1), undefined); assert.match(studio.state.notice, /有效的小节编号/);
    studio.clearNoteSelection(); assert.equal(studio.cell.value, null); assert.deepEqual(studio.range.value, [2, 3]);
    assert.equal(studio.selectAdjacentNote(-1), undefined); assert.match(studio.state.notice, /请先选择/);
    assert.equal(studio.state.undo.length, 0);
  } finally { cleanup(); }
});

test('selecting actual notes rewinds to their measure start while blank positions and viewing leave playback position unchanged', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('rewind.tja', chart.replace('1000,\n2000,', '1000,\n#BPMCHANGE 60\n#MEASURE 3/4\n#DELAY .5\n0200,\n3000,')));
    studio.setLoop(1, 3); studio.seek(5);
    studio.selectCell({ bar: 1, numerator: 1, denominator: 4, divisions: 16 });
    near(studio.state.position, 2);
    assert.equal(studio.cell.value.note, '2'); assert.ok(studio.cell.value.time > 2);
    studio.seek(5); studio.selectCell({ bar: 1, numerator: 0, denominator: 4, divisions: 16 });
    near(studio.state.position, 5);
    studio.select(0); near(studio.state.position, 5);
    studio.selectNote(1, 1); near(studio.state.position, 2);
    studio.selectAdjacentNote(1); near(studio.state.position, 5.5);
    studio.seek(6); studio.select(1); studio.setCommandPosition(1, 4);
    near(studio.state.position, 2);
    studio.seek(6); studio.setCommandPosition(1, 2); near(studio.state.position, 6);
    assert.deepEqual(studio.range.value, [1, 3]); assert.equal(studio.state.undo.length, 0);
    assert.equal(studio.state.playing, false);
  } finally { cleanup(); }
});

test('selecting a note pauses live playback before rewinding and clamps negative measure starts to zero', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  try {
    await studio.openChart(file());
    await studio.play(); context.currentTime = 3.035; ticks.frame();
    studio.selectCell({ bar: 0, numerator: 0, denominator: 4, divisions: 16 });
    assert.equal(studio.state.playing, false); near(studio.state.position, 0);
    context.currentTime = 4; ticks.frame(); near(studio.state.position, 0);
    await studio.openChart(file('negative.tja', chart.replace('OFFSET:0', 'OFFSET:1')));
    studio.seek(2); studio.selectNote(0, 1); near(studio.state.position, 0);
  } finally { cleanup(); }
});

test('measure branch commands ignore note position and integrate route toggles, conditions, ending, history and invalid-source guards', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file());
    studio.setCommandPosition(1, 2);
    assert.equal(studio.applyMeasureBranch({ type: 'condition', condition: 'p', lower: 50, upper: 80 }), true);
    assert.equal(studio.state.chart.branches[0].firstBarIndex, 0);
    assert.deepEqual(studio.state.chart.bars.map(bar => bar.notes), ['1000', '2000']);
    assert.equal(studio.applyMeasureBranch({ type: 'route', route: 'E' }), true);
    assert.deepEqual(studio.state.chart.branches[0].routes, ['N', 'E']);
    const before = studio.state.text;
    studio.select(1);
    assert.equal(studio.applyMeasureBranch({ type: 'condition', condition: 'r', lower: 10, upper: 20 }), true);
    assert.equal(studio.state.selected, 1);
    assert.equal(studio.applyMeasureBranch({ type: 'end' }), true);
    assert.equal(studio.bar.value.branchIndex, null); assert.equal(studio.bar.value.notes, '2000');
    const ended = studio.state.text;
    studio.history(); assert.equal(studio.state.chart.branches[0].barCount, 2);
    studio.history(); assert.equal(studio.state.text, before);
    studio.history(true); studio.history(true); assert.equal(studio.state.text, ended);
    studio.select(0);
    assert.equal(studio.applyMeasureBranch({ type: 'route', route: 'N' }), true);
    assert.deepEqual(studio.state.branchRoutes, ['E']);
    assert.equal(studio.applyMeasureBranch({ type: 'route', route: 'E' }), true);
    assert.equal(studio.state.chart.branches.length, 0); assert.equal(studio.state.error, false);
    studio.history(); assert.deepEqual(studio.state.branchRoutes, ['E']);
    studio.history(true); assert.equal(studio.state.chart.branches.length, 0);
    studio.editSource('unfinished');
    const text = studio.state.text;
    assert.equal(studio.applyMeasureBranch({ type: 'condition', condition: 'p', lower: 1, upper: 2 }), undefined);
    assert.equal(studio.state.text, text);
  } finally { cleanup(); }
});

test('measure-scoped settings read and edit the start without moving the selected point or rewriting internal commands', async () => {
  const { studio, cleanup } = mountStudio();
  const source = chart.replace('1000,', '#MEASURE 4/4\n#BARLINEON\n#SECTION\n#LEVELHOLD\n10\n#MEASURE 7/8\n#BARLINEOFF\n#SECTION\n#LEVELHOLD\n#BPMCHANGE 180\n#LYRIC internal\n#SENOTECHANGE 2\n20,');
  try {
    assert.equal(studio.measureCommand.value, null);
    studio.newChart(); assert.equal(studio.measureCommand.value, null);
    await studio.openChart(file('measure-scope.tja', source));
    studio.setCommandPosition(1, 2);
    const point = { ...studio.state.commandCell }, selected = { ...studio.state.selectedCell };
    const internal = studio.bar.value.events.map(({ name, value, slot }) => ({ name, value, slot }));
    assert.equal(studio.command.value.timing.numerator, 7);
    assert.equal(studio.command.value.timing.barline, false);
    assert.equal(studio.measureCommand.value.timing.numerator, 4);
    assert.equal(studio.measureCommand.value.timing.barline, true);
    assert.equal(studio.measureCommand.value.fraction, 0);
    assert.equal(studio.applySettings({ numerator: 3, denominator: 4, barline: false, section: null, levelhold: null }, true), true);
    assert.equal(studio.measureCommand.value.timing.numerator, 3);
    assert.equal(studio.measureCommand.value.timing.barline, false);
    assert.deepEqual(studio.measureCommand.value.commands.map(item => item.name), ['MEASURE', 'BARLINEOFF']);
    assert.deepEqual(studio.bar.value.events.map(({ name, value, slot }) => ({ name, value, slot })), internal);
    assert.deepEqual(studio.state.commandCell, point); assert.deepEqual(studio.state.selectedCell, selected);
    assert.equal(studio.command.value.timing.numerator, 7); assert.equal(studio.command.value.timing.bpm, 180);
    const edited = studio.state.text;
    studio.history(); assert.equal(studio.state.text, source); assert.equal(studio.measureCommand.value.timing.numerator, 4);
    studio.history(true); assert.equal(studio.state.text, edited); assert.equal(studio.measureCommand.value.timing.numerator, 3);
    studio.setCommandPosition(1, 11);
    assert.equal(studio.applySettings({ section: true, levelhold: true }, true), true);
    assert.equal(studio.bar.value.notes, '1020');
    assert.equal(studio.command.value.fraction, 1 / 11);
    assert.ok(studio.measureCommand.value.commands.some(item => item.name === 'SECTION'));
    assert.ok(studio.measureCommand.value.commands.some(item => item.name === 'LEVELHOLD'));
    studio.setCommandPosition(1, 1);
    assert.equal(studio.applySettings({ barline: null }, true), true);
    assert.equal(studio.command.value.fraction, 1);
    assert.ok(!studio.measureCommand.value.commands.some(item => item.name.startsWith('BARLINE')));
    assert.ok(studio.bar.value.events.some(item => item.name === 'BARLINEOFF'));
    studio.select(1);
    assert.equal(studio.measureCommand.value.timing.numerator, 7);
    assert.equal(studio.measureCommand.value.commands.length, 0);
    assert.equal(studio.applySettings({ numerator: 5, denominator: 4 }, true), true);
    assert.equal(studio.state.chart.bars[0].numerator, 3);
    assert.equal(studio.measureCommand.value.timing.numerator, 5);
    const valid = studio.state.text;
    studio.editSource('unfinished');
    assert.equal(studio.applySettings({ section: true }, true), undefined);
    assert.equal(studio.state.text, valid); assert.equal(studio.state.error, true);
  } finally { cleanup(); }
});

test('the header timing follows the selected command point, edits, source and undo without changing measure-start data', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    assert.equal(studio.currentTiming.value, null);
    studio.newChart(); assert.equal(studio.currentTiming.value, null);
    await studio.openChart(file());
    studio.setCommandPosition(1, 2);
    studio.applySettings({ bpm: 200, scroll: 2, numerator: 3, denominator: 4, gogo: true });
    assert.equal(studio.bar.value.bpm, 120); assert.equal(studio.bar.value.scroll, 1);
    assert.equal(studio.currentTiming.value.bpm, 200); assert.equal(studio.currentTiming.value.scroll, 2);
    assert.equal(studio.currentTiming.value.numerator, 3); assert.equal(studio.currentTiming.value.gogo, true);
    studio.history(); assert.equal(studio.currentTiming.value.bpm, 120); assert.equal(studio.currentTiming.value.scroll, 1);
    studio.history(true);
    studio.setCommandPosition(1, 2); assert.equal(studio.currentTiming.value.bpm, 200);
    studio.setCommandPosition(1, 4); assert.equal(studio.currentTiming.value.bpm, 120);
    studio.setCommandPosition(1, 1); assert.equal(studio.currentTiming.value.scroll, 2);
    studio.select(1); assert.equal(studio.currentTiming.value.bpm, 200); assert.equal(studio.currentTiming.value.scroll, 2);
    studio.editSource('#BPMCHANGE 150\n#SCROLL .5\n2000,');
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.equal(studio.currentTiming.value.bpm, 150); assert.equal(studio.currentTiming.value.scroll, .5);
  } finally { cleanup(); }
});

test('playback timing follows the playhead with follow disabled, while the edit point and current measure stay untouched', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  try {
    await studio.openChart(file('live-timing.tja', chart.replace('1000,', '10\n#BPMCHANGE 240\n#SCROLL 2\n20,')));
    await nextTick();
    studio.setCommandPosition(0, 1);
    await studio.play();
    studio.state.followPlayback = false; await nextTick();
    context.currentTime = .535; ticks.frame();
    assert.equal(studio.currentTiming.value.bpm, 120); assert.equal(studio.currentTiming.value.scroll, 1);
    context.currentTime = 1.045; ticks.frame();
    assert.equal(studio.currentTiming.value.bpm, 240); assert.equal(studio.currentTiming.value.scroll, 2);
    assert.equal(studio.command.value.timing.bpm, 120);
    context.currentTime = 1.735; ticks.frame();
    assert.equal(studio.currentTiming.value.bar.index, 1); assert.equal(studio.state.selected, 0);
    assert.equal(studio.command.value.fraction, 0);
    studio.pause(); assert.equal(studio.currentTiming.value.bar.index, 0); assert.equal(studio.currentTiming.value.bpm, 120);
  } finally { cleanup(); }
});

test('measure deletion pauses, selects the remaining measure, preserves audio and persists reversible selection and loops', async () => {
  const saved = new Map(), mounted = mountStudio(saved);
  const { studio, mock } = mounted;
  fakeAudio(mock);
  let edited;
  try {
    await studio.openChart(file());
    await studio.openAudio(audioFile());
    const buffer = studio.state.buffer;
    studio.setLoop(2, 2); studio.select(1);
    studio.selectCell({ bar: 1, numerator: 0, denominator: 16, divisions: 16 });
    await studio.play();
    assert.equal(studio.deleteBar(), true);
    assert.equal(studio.state.playing, false); assert.equal(studio.state.buffer, buffer);
    assert.deepEqual(studio.state.chart.bars.map(bar => bar.notes), ['1000']);
    assert.equal(studio.state.selected, 0); assert.equal(studio.state.selectedCell, null); assert.equal(studio.state.commandCell, null);
    assert.equal(studio.state.customLoop, null); assert.equal(studio.state.undo.length, 1);
    assert.equal(studio.state.source.trim(), '1000,');
    edited = studio.state.text;
    assert.equal(studio.deleteBar(), undefined); assert.equal(studio.state.text, edited);
    assert.match(studio.state.notice, /最后一个小节/);
    studio.history();
    assert.equal(studio.state.text, chart); assert.equal(studio.state.selected, 1);
    assert.deepEqual(studio.state.customLoop, [2, 2]); assert.equal(studio.state.dirty, false);
    studio.history(true); assert.equal(studio.state.text, edited); assert.equal(studio.state.customLoop, null);
    const disk = diskFile('deleted.tja'); window.showSaveFilePicker = async () => disk.handle;
    await studio.saveAs(); assert.equal(disk.text, edited);
  } finally { mounted.cleanup(); }
  const restored = mountStudio(saved);
  try {
    assert.equal(restored.studio.state.text, edited);
    restored.studio.history(); assert.equal(restored.studio.state.selected, 1);
    assert.deepEqual(restored.studio.state.customLoop, [2, 2]);
    restored.studio.history(true); assert.equal(restored.studio.state.selected, 0);
  } finally { restored.cleanup(); }
});

test('deleting before, within and after a loop retains the remaining original measures', async () => {
  const { studio, cleanup } = mountStudio();
  const source = chart.replace('2000,', '2000,\n3000,\n4000,\n5000,');
  try {
    for (const [selected, expected] of [[0, [1, 3]], [1, [2, 3]], [2, [2, 3]], [3, [2, 3]], [4, [2, 4]]]) {
      await studio.openChart(file(`delete-loop-${selected}.tja`, source));
      studio.setLoop(2, 4); studio.select(selected);
      assert.equal(studio.deleteBar(), true);
      assert.deepEqual(studio.state.customLoop, expected);
      assert.equal(studio.state.selected, Math.min(selected, 3));
      studio.history(); assert.deepEqual(studio.state.customLoop, [2, 4]); assert.equal(studio.state.selected, selected);
    }
  } finally { cleanup(); }
});

test('deletion flushes valid pending edits and rejects invalid source or absent charts without deleting', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    assert.equal(studio.deleteBar(), undefined); assert.equal(studio.state.documents.length, 0);
    studio.newChart(); const empty = studio.state.text;
    assert.equal(studio.deleteBar(), undefined); assert.equal(studio.state.text, empty);
    await studio.openChart(file());
    studio.editSource('4000,'); assert.equal(studio.deleteBar(), true);
    assert.deepEqual(studio.state.chart.bars.map(bar => bar.notes), ['2000']);
    studio.history(); assert.deepEqual(studio.state.chart.bars.map(bar => bar.notes), ['4000', '2000']);
    studio.editSource('unfinished');
    const valid = studio.state.text, count = studio.state.undo.length;
    assert.equal(studio.deleteBar(), undefined);
    assert.equal(studio.state.text, valid); assert.equal(studio.state.undo.length, count);
    assert.equal(studio.state.invalid, true); assert.equal(studio.state.error, true);
  } finally { cleanup(); }
});

test('deletion leaves other player parts, documents and course-aware history intact', async () => {
  const { studio, cleanup } = mountStudio();
  const source = chart.replace('#START', '#START P1') + 'COURSE:Oni\n#START P2\n4400,\n#END\n';
  try {
    await studio.openChart(file('delete-players.tja', source));
    const id = studio.state.activeId;
    assert.equal(studio.deleteBar(), true); const edited = studio.state.text;
    studio.changeCourse(1); assert.deepEqual(studio.state.chart.bars.map(bar => bar.notes), ['4400']);
    studio.history(); assert.equal(studio.state.text, source); assert.equal(studio.state.course, 1);
    studio.history(true); assert.equal(studio.state.text, edited); assert.equal(studio.state.course, 1);
    studio.newChart(); studio.switchChart(id);
    assert.equal(studio.state.text, edited); assert.equal(studio.state.course, 1);
  } finally { cleanup(); }
});

test('inserting measures selects the blank, pauses playback, shifts custom loops and restores edits, selection and loops through history', async () => {
  const saved = new Map(), mounted = mountStudio(saved);
  const { studio, mock } = mounted;
  fakeAudio(mock);
  let edited;
  try {
    await studio.openChart(file());
    studio.setLoop(2, 2);
    studio.select(0);
    studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 });
    await studio.play();
    assert.equal(studio.insertBar('before'), true);
    assert.equal(studio.state.playing, false);
    assert.deepEqual(studio.state.chart.bars.map(bar => bar.notes), ['0'.repeat(16), '1000', '2000']);
    assert.equal(studio.state.selected, 0); assert.equal(studio.state.selectedCell, null); assert.equal(studio.state.commandCell, null);
    assert.deepEqual(studio.range.value, [3, 3]);
    assert.equal(studio.state.undo.length, 1); assert.equal(studio.state.dirty, true);
    assert.equal(studio.state.source.trim(), '0'.repeat(16) + ',');
    studio.history();
    assert.equal(studio.state.text, chart); assert.deepEqual(studio.range.value, [2, 2]);
    assert.equal(studio.state.dirty, false); assert.equal(studio.state.selected, 0);
    studio.history(true); assert.deepEqual(studio.range.value, [3, 3]);
    studio.select(2);
    assert.equal(studio.insertBar('after'), true);
    assert.equal(studio.state.selected, 3); assert.equal(studio.state.chart.bars.length, 4);
    assert.deepEqual(studio.range.value, [3, 3]);
    edited = studio.state.text;
    studio.history(); assert.equal(studio.state.selected, 2);
    studio.history(true); assert.equal(studio.state.selected, 3);
    const disk = diskFile('inserted.tja');
    window.showSaveFilePicker = async () => disk.handle;
    await studio.saveAs(); assert.equal(disk.text, edited);
  } finally { mounted.cleanup(); }
  const restored = mountStudio(saved);
  try {
    assert.equal(restored.studio.state.text, edited);
    restored.studio.history(); assert.equal(restored.studio.state.selected, 2);
    assert.deepEqual(restored.studio.range.value, [3, 3]);
    restored.studio.history(true); assert.equal(restored.studio.state.selected, 3);
  } finally { restored.cleanup(); }
});

test('measure insertion flushes valid pending source and rejects invalid source, invalid sides and metadata-only songs atomically', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    studio.newChart();
    const empty = studio.state.text;
    assert.equal(studio.insertBar('after'), undefined); assert.equal(studio.state.text, empty);
    assert.match(studio.state.notice, /请先创建/);
    await studio.openChart(file());
    studio.editSource('4000,');
    assert.equal(studio.insertBar('after'), true);
    assert.deepEqual(studio.state.chart.bars.map(bar => bar.notes), ['4000', '0'.repeat(16), '2000']);
    const valid = studio.state.text, history = studio.state.undo.length;
    studio.editSource('unfinished');
    assert.equal(studio.insertBar('before'), undefined);
    assert.equal(studio.state.text, valid); assert.equal(studio.state.undo.length, history);
    studio.editSource('0000000000000000,');
    assert.equal(studio.insertBar('wrong'), undefined); assert.equal(studio.state.text, valid);
    assert.match(studio.state.notice, /插入位置无效/);
  } finally { cleanup(); }
});

test('measure insertion leaves other player parts, documents and cached audio unchanged', async () => {
  const { studio, mock, cleanup } = mountStudio();
  fakeAudio(mock);
  try {
    const text = chart.replace('#START', '#START P1') + 'COURSE:Oni\n#START P2\n4400,\n#END\n';
    await studio.openChart(file('players.tja', text));
    const id = studio.state.activeId;
    await studio.openAudio(audioFile());
    const buffer = studio.state.buffer;
    studio.insertBar('after'); assert.equal(studio.state.buffer, buffer);
    const inserted = studio.state.text;
    studio.changeCourse(1); assert.deepEqual(studio.state.chart.bars.map(bar => bar.notes), ['4400']);
    studio.history(); assert.equal(studio.state.text, text); assert.equal(studio.state.course, 1);
    studio.history(true); assert.equal(studio.state.text, inserted); assert.equal(studio.state.course, 1);
    studio.newChart(); studio.switchChart(id);
    assert.equal(studio.state.text, inserted); assert.equal(studio.state.buffer, buffer);
  } finally { cleanup(); }
});

test('whole-chart statistics follow edits, history, documents and courses, not the selected measure or playback speed', async () => {
  const { studio, cleanup } = mountStudio();
  const empty = { don: 0, ka: 0, rollSeconds: 0, balloon: 0, special: 0 };
  try {
    assert.deepEqual(studio.chartStats.value, empty);
    const text = 'TITLE:Statistics\nBPM:120\nOFFSET:0\nCOURSE:Oni\nBALLOON:5,11,7,13,999\n#START\n13A24B00,\n5000,\n#BPMCHANGE 240\n#DELAY 0.25\n0080,\n6080,\n7080,\n9080,\n7080,\n9080,\n#END\nCOURSE:Easy\nBALLOON:3\n#START\n1000,\n7080,\n#END\n';
    await studio.openChart(file('statistics.tja', text));
    const id = studio.state.activeId, expected = { don: 3, ka: 3, rollSeconds: 3.25, balloon: 12, special: 24 };
    assert.deepEqual(studio.chartStats.value, expected);
    studio.select(1); assert.equal(studio.stats.value.don, 0);
    studio.controls.rate = .5;
    assert.deepEqual(studio.chartStats.value, expected);
    studio.selectCell({ bar: 4, numerator: 0, denominator: 4, divisions: 16 });
    studio.setBalloon(9); assert.equal(studio.chartStats.value.balloon, 16);
    studio.history(); assert.deepEqual(studio.chartStats.value, expected);
    studio.history(true); assert.equal(studio.chartStats.value.balloon, 16);
    studio.history();
    studio.selectCell({ bar: 0, numerator: 0, denominator: 8, divisions: 16 });
    studio.chooseNote('2');
    assert.equal(studio.chartStats.value.don, 2); assert.equal(studio.chartStats.value.ka, 4);
    studio.history(); assert.deepEqual(studio.chartStats.value, expected);
    studio.changeCourse(1);
    assert.deepEqual(studio.chartStats.value, { ...empty, don: 1, balloon: 3 });
    studio.changeCourse(0); assert.deepEqual(studio.chartStats.value, expected);
    studio.newChart(); assert.deepEqual(studio.chartStats.value, empty);
    studio.switchChart(id); assert.deepEqual(studio.chartStats.value, expected);
  } finally { cleanup(); }
});

test('statistics update for selected branch routes and multiplayer parts without double counting alternatives', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    const text = 'TITLE:Branch statistics\nBPM:120\nCOURSE:Oni\nBALLOON:5,7,11\n#START P1\n#BRANCHSTART p,50,80\n#N\n1000,\n7080,\n#E\n2222,\n9080,\n#M\n3000,\n7080,\n#BRANCHEND\n#END\n#START P2\n4400,\n5080,\n#END\n';
    await studio.openChart(file('branch-statistics.tja', text));
    assert.deepEqual(studio.chartStats.value, { don: 1, ka: 0, rollSeconds: 0, balloon: 5, special: 0 });
    studio.changeAllBranches('E');
    assert.deepEqual(studio.chartStats.value, { don: 0, ka: 4, rollSeconds: 0, balloon: 0, special: 7 });
    studio.changeAllBranches('M');
    assert.deepEqual(studio.chartStats.value, { don: 1, ka: 0, rollSeconds: 0, balloon: 11, special: 0 });
    studio.changeCourse(1);
    assert.deepEqual(studio.chartStats.value, { don: 0, ka: 2, rollSeconds: 1, balloon: 0, special: 0 });
  } finally { cleanup(); }
});

test('unfinished drumrolls use timeline boundaries and absent balloon counts remain explicitly incomplete', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('unfinished-statistics.tja', 'TITLE:Incomplete\nBPM:120\nCOURSE:Oni\n#START\n5000,\n6080,\n7080,\n9080,\n#END\n'));
    assert.deepEqual(studio.chartStats.value, { don: 0, ka: 0, rollSeconds: 3, balloon: null, special: null });
    studio.selectCell({ bar: 2, numerator: 0, denominator: 4, divisions: 16 });
    studio.setBalloon(8);
    assert.equal(studio.chartStats.value.balloon, 8); assert.equal(studio.chartStats.value.special, null);
    studio.selectCell({ bar: 3, numerator: 0, denominator: 4, divisions: 16 });
    studio.setBalloon(12); assert.equal(studio.chartStats.value.special, 12);
    studio.history(); assert.equal(studio.chartStats.value.special, null);
  } finally { cleanup(); }
});

test('new songs, final chart deletion, metadata, history and saving all support metadata-only documents', async () => {
  const { studio, saved, cleanup } = mountStudio();
  try {
    studio.newChart();
    assert.equal(studio.state.chart.variant, null); assert.equal(studio.bar.value, undefined);
    assert.equal(studio.state.selected, 0); assert.equal(studio.state.position, 0);
    assert.equal(studio.state.dirty, false); assert.deepEqual(studio.state.chart.variants, []);
    assert.equal(studio.setMetadata({ TITLE: 'Empty song', ARTIST: 'Fixture artist' }), true);
    const empty = studio.state.text + '\n';
    assert.equal(studio.createCourse({ course: 'Hard', player: 'P2', style: 'Double', level: 1 }), true);
    assert.equal(studio.state.chart.variant.player, 'P2'); assert.equal(studio.state.chart.variants.length, 1);
    studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 }); studio.chooseNote('A');
    const populated = studio.state.text;
    studio.setLoop(1, 1);
    assert.equal(studio.removeCourse(), true);
    assert.equal(studio.state.text, empty); assert.equal(studio.state.chart.variant, null);
    assert.equal(studio.state.selected, 0); assert.equal(studio.state.source, '');
    assert.equal(studio.state.selectedCell, null); assert.equal(studio.state.customLoop, null);
    assert.equal(studio.state.position, 0);
    studio.history(); assert.equal(studio.state.text, populated); assert.equal(studio.state.chart.variant.player, 'P2');
    studio.history(true); assert.equal(studio.state.text, empty);
    studio.restore(); assert.equal(studio.state.chart.variant, null);
    assert.equal(workspace(saved).documents[0].text, empty);
    const disk = diskFile('empty-song.tja');
    window.showSaveFilePicker = async () => disk.handle;
    document.activeElement = { dataset: { songField: 'TITLE' }, value: 'Saved empty song' };
    assert.equal(await studio.saveChart(), true);
    assert.ok(disk.text.includes('TITLE:Saved empty song')); assert.ok(!disk.text.includes('#START'));
    assert.equal(studio.state.dirty, false);
    document.activeElement = { dataset: { songField: 'BPM' }, value: '0' };
    assert.equal(await studio.saveChart(), false); assert.equal(studio.state.error, true);
    assert.equal(studio.state.chart.baseBpm, 120);
  } finally { cleanup(); }
  const restored = mountStudio(saved);
  try {
    assert.equal(restored.studio.state.chart.variant, null);
    assert.equal(restored.studio.metadata.value.TITLE, 'Saved empty song');
    restored.studio.history(); assert.equal(restored.studio.metadata.value.TITLE, 'Empty song');
    restored.studio.history(); assert.equal(restored.studio.state.chart.variant.player, 'P2');
  } finally { restored.cleanup(); }
});

test('shared multiplayer ratings preserve selection and support one-step undo, redo, saving, recovery and no-op edits', async () => {
  const { studio, saved, cleanup } = mountStudio();
  try {
    const text = chart.replace('#START', '#START P1') + '#START P2\n2000,\n#END\nSTYLE:Single\n#START\n3000,\n#END\n';
    await studio.openChart(file('ratings.tja', text));
    studio.selectCell({ bar: 0, numerator: 1, denominator: 4, divisions: 16 });
    const selected = studio.state.selected, cell = { ...studio.state.selectedCell };
    assert.equal(studio.setLevel(10), true);
    assert.equal(studio.state.course, 0); assert.equal(studio.state.chart.variant.player, 'P1');
    assert.equal(studio.state.selected, selected); assert.deepEqual(studio.state.selectedCell, cell);
    assert.deepEqual([0, 1, 2].map(index => courseLevel(studio.state.text, index)), [10, 10, 1]);
    assert.equal(studio.state.undo.length, 1);
    const changed = studio.state.text;
    studio.setLevel(10); assert.equal(studio.state.text, changed); assert.equal(studio.state.undo.length, 1);
    assert.equal(workspace(saved).documents[0].text, changed);
    studio.history(); assert.equal(studio.state.text, text); assert.equal(studio.state.dirty, false);
    studio.history(true); assert.equal(studio.state.text, changed); assert.equal(studio.state.chart.variant.player, 'P1');
    studio.changeCourse(1); studio.setLevel(8);
    assert.deepEqual([0, 1, 2].map(index => courseLevel(studio.state.text, index)), [8, 8, 1]);
    studio.history(); assert.equal(studio.state.text, changed); assert.equal(studio.state.chart.variant.player, 'P2');
    studio.history(true); assert.deepEqual([0, 1, 2].map(index => courseLevel(studio.state.text, index)), [8, 8, 1]);
    studio.changeCourse(2); studio.setLevel(6);
    assert.deepEqual([0, 1, 2].map(index => courseLevel(studio.state.text, index)), [8, 8, 6]);
    studio.restore(); assert.equal(studio.state.chart.variant.player, 'single');
    assert.deepEqual([0, 1, 2].map(index => courseLevel(studio.state.text, index)), [8, 8, 6]);
    const previous = studio.state.text, count = studio.state.undo.length;
    assert.equal(studio.setLevel(11), undefined);
    assert.equal(studio.state.error, true); assert.equal(studio.state.text, previous); assert.equal(studio.state.undo.length, count);
    const disk = diskFile('shared-ratings.tja');
    window.showSaveFilePicker = async () => disk.handle;
    assert.equal(await studio.saveChart(), true);
    assert.equal(disk.text, studio.state.text);
    assert.deepEqual([0, 1, 2].map(index => courseLevel(disk.text, index)), [8, 8, 6]);
  } finally { cleanup(); }
  const restored = mountStudio(saved);
  try {
    assert.equal(restored.studio.state.chart.variant.player, 'single');
    assert.deepEqual([0, 1, 2].map(index => courseLevel(restored.studio.state.text, index)), [8, 8, 6]);
  } finally { restored.cleanup(); }
});

test('a later multiplayer counterpart keeps the shared rating when created from a differently rated solo chart', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('shared-new-part.tja', chart));
    studio.createPlayerCharts('Double', 'P1'); studio.setLevel(9);
    studio.changeCourse(0); studio.setLevel(3);
    const before = studio.state.text;
    studio.createPlayerCharts('Double', 'P2');
    assert.equal(studio.state.chart.variant.player, 'P2');
    assert.deepEqual([0, 1, 2].map(index => courseLevel(studio.state.text, index)), [3, 9, 9]);
    studio.history(); assert.equal(studio.state.text, before); assert.equal(studio.state.chart.variant.player, 'single');
    studio.history(true); assert.equal(studio.state.chart.variant.player, 'P2');
    studio.setLevel(7);
    assert.deepEqual([0, 1, 2].map(index => courseLevel(studio.state.text, index)), [3, 7, 7]);
  } finally { cleanup(); }
});

test('rating metadata preserves active branch routes, cursor and native saved contents', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('branch-rating.tja', branchChart));
    studio.changeAllBranches('E');
    studio.selectCell({ bar: 1, numerator: 1, denominator: 4, divisions: 16 });
    const selected = { ...studio.state.selectedCell }, notes = studio.state.chart.bars.map(bar => bar.notes);
    studio.setLevel(9);
    assert.deepEqual(studio.state.branchRoutes, ['E']);
    assert.deepEqual(studio.state.selectedCell, selected);
    assert.deepEqual(studio.state.chart.bars.map(bar => bar.notes), notes);
    assert.equal(courseLevel(studio.state.text, 1), 0);
    const disk = diskFile('branch-rating.tja');
    window.showSaveFilePicker = async () => disk.handle;
    assert.equal(await studio.saveChart(), true);
    assert.equal(disk.text, studio.state.text);
    assert.equal(courseLevel(disk.text, 0), 9); assert.equal(studio.state.dirty, false);
    studio.history(); assert.equal(studio.state.text, branchChart);
    assert.deepEqual(studio.state.branchRoutes, ['E']);
  } finally { cleanup(); }
});

test('difficulty creation and duet deletion preserve player identity across history and recovery', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('difficulties.tja', chart));
    studio.state.audioName = 'attached.wav';
    assert.equal(studio.createCourse({ course: 'Normal', level: 5, style: 'Double' }), true);
    assert.equal(studio.state.course, 1); assert.equal(studio.state.chart.variant.player, 'P1');
    studio.changeCourse(2);
    assert.equal(studio.state.chart.variant.player, 'P2');
    studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 }); studio.chooseNote('A');
    assert.equal(studio.cell.value.name, '双人咚'); assert.equal(studio.stats.value.don, 1);
    studio.changeCourse(1); assert.equal(studio.state.chart.bars[0].notes, '0');
    studio.changeCourse(2);
    assert.equal(studio.removeCourse(), true);
    assert.equal(studio.state.chart.variants.length, 2); assert.equal(studio.state.chart.variant.player, 'P1');
    assert.equal(studio.state.audioName, 'attached.wav');
    studio.restore(); studio.history();
    assert.equal(studio.state.chart.variants.length, 3); assert.equal(studio.state.chart.variant.player, 'P2');
    assert.equal(studio.state.chart.bars[0].notes, 'A');
    studio.history(); studio.history();
    assert.equal(studio.state.text, chart); assert.equal(studio.state.dirty, false);
    studio.history(true); assert.equal(studio.state.chart.variant.player, 'P1');
    assert.equal(studio.createCourse({ course: 'Normal', level: 1, style: 'Single' }), undefined);
    assert.equal(studio.state.error, true);
  } finally { cleanup(); }
});

test('deleting solo or duet separately restores mode selection through history and recovery', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('separate-modes.tja', chart));
    studio.createPlayerCharts('Double'); const both = studio.state.text;
    studio.changeCourse(2);
    assert.equal(studio.removeCourse(), true);
    assert.deepEqual(studio.state.chart.variants.map(variant => variant.player), ['single', 'P1']);
    studio.history(); assert.equal(studio.state.text, both); assert.equal(studio.state.chart.variant.player, 'P2');
    studio.history(true); assert.deepEqual(studio.state.chart.variants.map(variant => variant.player), ['single', 'P1']);
    studio.history(); studio.changeCourse(0);
    assert.equal(studio.removeCourse(), true);
    assert.deepEqual(studio.state.chart.variants.map(variant => variant.player), ['P1', 'P2']);
    assert.equal(studio.state.chart.variant.player, 'P1');
    studio.restore(); assert.equal(studio.state.chart.variant.player, 'P1');
    assert.equal(studio.removeCourse(), true);
    assert.deepEqual(studio.state.chart.variants.map(variant => variant.player), ['P2']);
    assert.equal(studio.removeCourse(), true);
    assert.equal(studio.state.chart.variant, null);
    studio.history(); studio.history();
    studio.history(); assert.equal(studio.state.text, both); assert.equal(studio.state.chart.variant.player, 'single');
  } finally { cleanup(); }
});

test('deleting nonactive rows before and after the current chart preserves its routes, cursor and loop', async () => {
  const { studio, saved, cleanup } = mountStudio();
  let updated;
  const source = chart.replace('COURSE:Oni', 'COURSE:Normal') + branchChart;
  try {
    await studio.openChart(file('indexed-deletion.tja', source));
    studio.changeCourse(1); studio.changeAllBranches('E');
    studio.setLoop(1, 2); studio.selectCell({ bar: 1, numerator: 1, denominator: 4, divisions: 16 });
    const snapshot = () => ({
      course: studio.state.chart.variant.course, routes: [...studio.state.branchRoutes],
      selected: studio.state.selected, cell: { ...studio.state.selectedCell },
      command: studio.state.commandCell, loop: [...studio.state.customLoop], position: studio.state.position,
      notes: studio.state.chart.bars.map(bar => bar.notes), source: studio.state.source
    });
    const before = snapshot();
    assert.equal(studio.removeCourse(2), true);
    assert.equal(studio.state.course, 1); assert.deepEqual(snapshot(), before);
    const afterLast = studio.state.text;
    assert.equal(studio.removeCourse(0), true);
    assert.equal(studio.state.course, 0); assert.deepEqual(snapshot(), before);
    updated = studio.state.text;
    assert.equal(studio.state.chart.variants.length, 1);
    assert.equal(workspace(saved).documents[0].text, updated);
    studio.history(); assert.equal(studio.state.text, afterLast); assert.equal(studio.state.course, 1);
    assert.deepEqual(studio.state.branchRoutes, ['E']);
    studio.history(); assert.equal(studio.state.text, source); assert.equal(studio.state.course, 1);
    studio.history(true); studio.history(true);
    assert.equal(studio.state.text, updated); assert.equal(studio.state.course, 0);
    assert.deepEqual(studio.state.branchRoutes, ['E']);
  } finally { cleanup(); }
  const restored = mountStudio(saved);
  try {
    assert.equal(restored.studio.state.text, updated);
    assert.equal(restored.studio.state.chart.variant.course, 'Oni');
    assert.deepEqual(restored.studio.state.branchRoutes, ['E']);
    restored.studio.history(); assert.equal(restored.studio.state.course, 1);
    assert.equal(restored.studio.state.chart.variant.course, 'Oni');
  } finally { restored.cleanup(); }
});

test('localized metadata supports history, focused saves, validation and workspace recovery', async () => {
  const { studio, saved, cleanup } = mountStudio();
  let updated;
  try {
    await studio.openChart(file('localized-metadata.tja', chart));
    assert.equal(studio.setMetadata({ TITLEZH: '中文曲名', SUBTITLEEN: '--Subtitle', TITLEKO: '한국어 제목' }), true);
    assert.equal(studio.state.chart.title, 'Vue session');
    studio.history(); assert.equal(studio.metadata.value.TITLEZH, '');
    studio.history(true); assert.equal(studio.metadata.value.TITLEZH, '中文曲名');
    const disk = diskFile('localized-metadata.tja');
    window.showSaveFilePicker = async () => disk.handle;
    document.activeElement = { dataset: { songField: 'TITLEJA' }, value: '日本語の曲名' };
    assert.equal(await studio.saveChart(), true);
    updated = studio.state.text;
    assert.equal(disk.text, updated); assert.equal(studio.state.dirty, false);
    assert.equal(studio.metadata.value.TITLEJA, '日本語の曲名');
    assert.equal(studio.metadata.value.TITLE, 'Vue session');
    document.activeElement.value = 'Invalid\n#END';
    assert.equal(await studio.saveChart(), false);
    assert.equal(studio.state.error, true); assert.equal(studio.state.text, updated);
    assert.equal(disk.text, updated);
  } finally { cleanup(); }
  const restored = mountStudio(saved);
  try {
    assert.equal(restored.studio.state.text, updated);
    assert.equal(restored.studio.metadata.value.TITLEZH, '中文曲名');
    assert.equal(restored.studio.metadata.value.TITLEJA, '日本語の曲名');
    assert.equal(restored.studio.metadata.value.TITLEKO, '한국어 제목');
    restored.studio.history(); assert.equal(restored.studio.metadata.value.TITLEJA, '');
    assert.equal(restored.studio.metadata.value.TITLEZH, '中文曲名');
  } finally { restored.cleanup(); }
});

test('creating a missing player tab is one reversible edit without creating its counterpart', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('mode-tabs.tja', chart));
    assert.equal(studio.createPlayerCharts('Double', 'P2'), true);
    assert.deepEqual(studio.state.chart.variants.map(variant => variant.player), ['single', 'P2']);
    assert.equal(studio.state.chart.variant.player, 'P2'); assert.equal(studio.state.undo.length, 1);
    studio.history(); assert.equal(studio.state.text, chart);
    studio.history(true); assert.equal(studio.state.chart.variant.player, 'P2');
    studio.restore(); assert.equal(studio.state.chart.variant.player, 'P2');
    assert.equal(studio.createPlayerCharts('Double', 'P1'), true);
    assert.deepEqual(studio.state.chart.variants.map(variant => variant.player), ['single', 'P2', 'P1']);
    assert.equal(studio.state.chart.variant.player, 'P1');
  } finally { cleanup(); }
});

test('player structure cloning and inherited balloons stay isolated between P1 and P2', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    const text = chart.replace('LEVEL:1', 'LEVEL:1\nBALLOON:11').replace('1000,', '7008,');
    await studio.openChart(file('players.tja', text));
    assert.equal(studio.createPlayerCharts('Double'), true);
    assert.equal(studio.state.chart.variants.length, 3); assert.equal(studio.state.chart.variant.player, 'P1');
    studio.selectCell({ bar: 0, numerator: 0, denominator: 4, divisions: 16 }); studio.setBalloon(19);
    assert.equal(studio.cell.value.count, 19);
    studio.changeCourse(2); studio.selectCell({ bar: 0, numerator: 0, denominator: 4, divisions: 16 });
    assert.equal(studio.cell.value.count, 11);
    studio.chooseNote('B'); assert.equal(studio.stats.value.ka, 1);
    studio.changeCourse(1); assert.equal(studio.state.chart.bars[0].notes, '7008');
    studio.changeCourse(0); assert.equal(studio.state.chart.bars[0].notes, '7008');
  } finally { cleanup(); }
});

test('minus and equals shortcuts preserve A/B source codes, percussion and the other player without consuming B', async () => {
  const { studio, handlers, mock, ticks, cleanup } = mountStudio();
  const { context, sources } = fakeAudio(mock);
  try {
    await studio.openChart(file('duet-notes.tja', chart.replace('#START', 'STYLE:Double\n#START P1').replace('1000,', 'AB00,')));
    studio.selectCell({ bar: 0, numerator: 0, denominator: 4, divisions: 16 });
    const event = key => ({ key, preventDefault() {}, repeat: false });
    handlers.get('keydown')(event('=')); assert.equal(studio.cell.value.note, 'B');
    const edits = studio.state.undo.length;
    handlers.get('keydown')({ ...event('='), repeat: true }); assert.equal(studio.state.undo.length, edits);
    handlers.get('keydown')(event('-')); assert.equal(studio.cell.value.note, 'A');
    handlers.get('keydown')({ key: 'b', preventDefault() { assert.fail('B is no longer a note shortcut'); } });
    assert.equal(studio.cell.value.note, 'A');
    await studio.play();
    assert.equal(sources.length, 1);
    context.currentTime = .5; ticks.schedule(); assert.equal(sources.length, 2);
    assert.equal(studio.state.chart.variant.player, 'P1');
  } finally { cleanup(); }
});

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
  const app = renderer.createApp({ setup() { studio = useStudio(); studio.timelineWidth.value = 576; return () => null; } });
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
const branchChart = 'TITLE:Branch session\nBPM:120\nCOURSE:Oni\n#START\n4000,\n#SECTION\n#BRANCHSTART p,50,80\n#N\n1000,\n#E\n2222,\n#M\n3333,\n#BRANCHEND\n1000,\n#END\nCOURSE:Easy\n#START\n1000,\n#END\n';
const multiBranchChart = branchChart.replace('#BRANCHEND\n1000,\n#END', '#BRANCHEND\n#BRANCHSTART p,50,80\n#BRANCHEND\n#BRANCHSTART r,5,10\n#N\n1000,\n#E\n2000,\n#M\n3000,\n#BRANCHEND\n1000,\n#END');

test('branch structure creation and route removal survive history, restore and course navigation', async () => {
  const { studio, saved, cleanup } = mountStudio();
  try {
    await studio.openChart(file('structure.tja', branchChart));
    studio.changeBranch(0, 'E'); studio.select(0);
    const source = '#BRANCHSTART s,100,200\n#N\n1000,\n#E\n2000,\n#M\n3000,\n#BRANCHEND';
    assert.equal(studio.applyBranchSource(source), true);
    assert.deepEqual(studio.state.branchRoutes, ['N', 'E']);
    assert.equal(studio.state.undo.length, 1);
    assert.equal(studio.state.selectedCell, null); assert.equal(studio.state.dirty, true);
    studio.history(); assert.equal(studio.state.text, branchChart);
    assert.deepEqual(studio.state.branchRoutes, ['E']);
    studio.history(true); assert.deepEqual(studio.state.branchRoutes, ['N', 'E']);
    assert.equal(studio.applyBranchSource(source.replace('#E\n2000,\n', ''), 1), true);
    assert.deepEqual(studio.state.branchRoutes, ['N', 'N']);
    studio.restore(); assert.deepEqual(studio.state.branchRoutes, ['N', 'N']);
    studio.history(); assert.deepEqual(studio.state.branchRoutes, ['N', 'E']);
    studio.changeCourse(1); studio.history();
    assert.equal(studio.state.error, false); assert.deepEqual(studio.state.branchRoutes, []);
    studio.changeCourse(0);
    assert.equal(studio.state.chart.branches.length, 1);
    assert.equal(workspace(saved).documents[0].undo.length, 0);
  } finally { cleanup(); }
});

test('preserved command edits integrate with history and invalid branch drafts do not mutate documents', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('commands.tja', chart));
    studio.setCommandPosition(1, 3);
    studio.applySettings({ lyric: 'Hello', section: true, levelhold: true, senote: 3 });
    assert.equal(studio.state.undo.length, 1);
    assert.equal(studio.command.value.commands.length, 4);
    studio.history(); assert.equal(studio.state.text, chart);
    studio.history(true);
    const before = studio.state.text, undo = studio.state.undo;
    assert.equal(studio.applyBranchSource('#BRANCHSTART p,50,80'), undefined);
    assert.equal(studio.state.error, true);
    assert.equal(studio.state.text, before); assert.equal(studio.state.undo, undo);
    studio.editSource('broken');
    assert.equal(studio.applyBranchSource('#BRANCHSTART p,50,80\n#BRANCHEND'), undefined);
    assert.equal(studio.state.source, 'broken');
  } finally { cleanup(); }
});

test('one bulk route change stops playback and persists all choices once without editing source', async () => {
  const { studio, saved, mock, cleanup } = mountStudio();
  const { sources } = fakeAudio(mock);
  try {
    await studio.openChart(file('many-branches.tja', multiBranchChart));
    studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 });
    studio.setLoop(1, 3); await studio.play();
    let writes = 0;
    mock('localStorage', { getItem: key => saved.get(key), setItem(key, value) { writes++; saved.set(key, value); } });
    studio.changeAllBranches('M');
    assert.deepEqual(studio.state.branchRoutes, ['M', null, 'M']);
    assert.equal(writes, 1);
    assert.equal(studio.state.playing, false); assert.ok(sources.every(source => source.stopped));
    assert.equal(studio.state.selectedCell, null); assert.equal(studio.state.customLoop, null);
    assert.equal(studio.state.text, multiBranchChart); assert.equal(studio.state.dirty, false);
    assert.equal(studio.state.undo.length, 0);
    assert.deepEqual(workspace(saved).documents[0].branchRoutes, ['M', null, 'M']);
    studio.changeAllBranches('M'); assert.equal(writes, 1);
    studio.setLoop(1, 3); await studio.play();
    const loop = studio.state.customLoop, selected = studio.state.selected;
    studio.changeAllBranches('M');
    assert.equal(studio.state.playing, true);
    assert.equal(studio.state.customLoop, loop); assert.equal(studio.state.selected, selected);
    studio.changeBranch(2, 'E');
    assert.deepEqual(studio.state.branchRoutes, ['M', null, 'E']);
    studio.changeAllBranches('M'); studio.restore();
    assert.deepEqual(studio.state.branchRoutes, ['M', null, 'M']);
    assert.equal(studio.state.text, multiBranchChart);
  } finally { cleanup(); }
});

test('bulk route selection rejects unavailable paths atomically but individual overrides remain available', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    const text = multiBranchChart.replace('#E\n2000,\n#M\n3000,', '#M\n3000,');
    await studio.openChart(file('partial-branches.tja', text));
    studio.changeAllBranches('E');
    assert.equal(studio.state.error, true); assert.match(studio.state.notice, /没有路线 E/);
    assert.deepEqual(studio.state.branchRoutes, ['N', null, 'N']);
    assert.equal(studio.state.text, text); assert.equal(studio.state.undo.length, 0);
    studio.changeBranch(0, 'E');
    assert.deepEqual(studio.state.branchRoutes, ['E', null, 'N']);
    studio.changeAllBranches('M');
    assert.deepEqual(studio.state.branchRoutes, ['M', null, 'M']);
    assert.equal(studio.state.error, false);
    studio.changeAllBranches('bad');
    assert.deepEqual(studio.state.branchRoutes, ['M', null, 'M']);
    studio.editSource('broken');
    studio.changeAllBranches('N');
    assert.deepEqual(studio.state.branchRoutes, ['M', null, 'M']);
    assert.equal(studio.state.source, 'broken');
  } finally { cleanup(); }
});

test('bulk routes recalculate unequal durations and later branches without changing edit history', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('timed-branches.tja', multiBranchChart));
    studio.changeBranch(0, 'E'); studio.applySettings({ bpm: 60 });
    const text = studio.state.text, undo = studio.state.undo;
    studio.changeAllBranches('E');
    assert.equal(studio.duration.value, 14);
    assert.equal(studio.state.chart.bars[2].start, 6);
    studio.changeAllBranches('M');
    assert.equal(studio.duration.value, 8);
    assert.equal(studio.state.chart.bars[2].start, 4);
    assert.equal(studio.state.text, text);
    assert.equal(studio.state.undo, undo);
  } finally { cleanup(); }
});

test('branch selection is clean navigation, persists per document, and resets on course changes', async () => {
  const { studio, saved, cleanup } = mountStudio();
  try {
    await studio.openChart(file('branches.tja', branchChart)); const first = studio.state.activeId;
    assert.deepEqual(studio.state.branchRoutes, ['N']);
    studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 });
    studio.setLoop(1, 3);
    studio.changeBranch(0, 'E');
    assert.equal(studio.state.selected, 1); assert.equal(studio.bar.value.notes, '2222');
    assert.equal(studio.state.position, 2); assert.equal(studio.state.selectedCell, null);
    assert.equal(studio.state.commandCell, null); assert.equal(studio.state.customLoop, null);
    assert.equal(studio.state.text, branchChart); assert.equal(studio.state.dirty, false);
    assert.equal(studio.state.undo.length, 0);
    assert.deepEqual(workspace(saved).documents[0].branchRoutes, ['E']);
    studio.newChart(); assert.deepEqual(studio.state.branchRoutes, []);
    studio.switchChart(first); assert.deepEqual(studio.state.branchRoutes, ['E']);
    studio.restore(); assert.deepEqual(studio.state.branchRoutes, ['E']);
    assert.equal(studio.bar.value.notes, '2222');
    studio.changeCourse(1); assert.deepEqual(studio.state.branchRoutes, []);
    studio.changeCourse(0); assert.deepEqual(studio.state.branchRoutes, ['N']);
  } finally { cleanup(); }
});

test('editing different branches shares text history while native save preserves every path and condition', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    const disk = diskFile('branches.tja', branchChart);
    window.showOpenFilePicker = async () => [disk.handle];
    await studio.openCharts();
    studio.changeBranch(0, 'N');
    studio.selectCell({ bar: 1, numerator: 0, denominator: 4, divisions: 4 });
    studio.chooseNote('4');
    assert.ok(studio.state.text.includes('#N\n4000,'));
    studio.changeBranch(0, 'M');
    studio.selectCell({ bar: 1, numerator: 0, denominator: 4, divisions: 4 });
    studio.chooseNote('2');
    assert.equal(studio.bar.value.notes, '2333');
    studio.history(); assert.equal(studio.bar.value.notes, '3333');
    assert.ok(studio.state.text.includes('#N\n4000,'));
    studio.history(); assert.equal(studio.state.text, branchChart);
    assert.deepEqual(studio.state.branchRoutes, ['M']);
    studio.history(true); studio.history(true);
    assert.equal(studio.bar.value.notes, '2333');
    assert.equal(await studio.saveChart(), true);
    assert.ok(disk.text.includes('#BRANCHSTART p,50,80'));
    assert.ok(disk.text.includes('#N\n4000,\n#E\n2222,\n#M\n2333,\n#BRANCHEND'));
    assert.equal(studio.state.dirty, false);
    studio.changeBranch(0, 'E'); assert.equal(studio.bar.value.notes, '2222');
    assert.equal(studio.state.dirty, false);
  } finally { cleanup(); }
});

test('invalid branch edits, source topology changes and shared-command deletion leave the chart protected', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('branches.tja', branchChart));
    studio.changeBranch(0, 'E');
    studio.applySettings({ bpm: 0 });
    assert.equal(studio.state.error, true); assert.match(studio.state.notice, /BPM 须为正数/);
    assert.equal(studio.state.text, branchChart); assert.equal(studio.state.undo.length, 0);
    const shared = studio.bar.value.instructions.find(item => item.shared);
    studio.removeCommand(shared);
    assert.match(studio.state.notice, /不能从路线小节中删除/);
    assert.equal(studio.state.text, branchChart);
    studio.changeBranch(0, 'bad'); assert.deepEqual(studio.state.branchRoutes, ['E']);
    studio.editSource('#BRANCHEND\n1000,');
    studio.changeBranch(0, 'M');
    assert.deepEqual(studio.state.branchRoutes, ['E']); assert.equal(studio.state.invalid, true);
    studio.select(0);
    assert.equal(studio.state.text, branchChart); assert.match(studio.state.notice, /请先修正/);
    assert.equal(studio.state.source, '#BRANCHEND\n1000,');
  } finally { cleanup(); }
});

test('unequal route timing edits update duration, survive switching and restore, and remain undoable', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    await studio.openChart(file('branches.tja', branchChart));
    studio.changeBranch(0, 'E');
    studio.applySettings({ bpm: 60 });
    assert.equal(studio.state.error, false);
    assert.equal(studio.duration.value, 10);
    assert.equal(studio.state.chart.bars[2].start, 6);
    assert.equal(studio.state.undo.length, 1);
    const text = studio.state.text;
    assert.ok(text.includes('#E\n#BPMCHANGE 60\n2222,'));
    studio.changeBranch(0, 'N');
    assert.equal(studio.duration.value, 6);
    assert.equal(studio.state.chart.bars[2].start, 4);
    assert.equal(studio.state.text, text);
    studio.changeBranch(0, 'E');
    assert.equal(studio.duration.value, 10);
    studio.history(); assert.equal(studio.duration.value, 6);
    studio.history(true); assert.equal(studio.duration.value, 10);
    studio.restore();
    assert.deepEqual(studio.state.branchRoutes, ['E']);
    assert.equal(studio.duration.value, 10);
    assert.equal(studio.state.text, text);
  } finally { cleanup(); }
});

test('branch preview schedules only selected notes and switching stops active voices', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context, sources } = fakeAudio(mock);
  try {
    await studio.openChart(file('branches.tja', branchChart));
    await nextTick();
    studio.changeBranch(0, 'N');
    await studio.play(2);
    assert.equal(sources.length, 1);
    studio.changeBranch(0, 'E');
    assert.equal(studio.state.playing, false); assert.ok(sources[0].stopped);
    await studio.play(2);
    for (const time of [.5, 1, 1.5]) { context.currentTime = time; ticks.schedule(); }
    assert.equal(sources.length, 5);
    assert.equal(studio.duration.value, 6);
    assert.equal(studio.state.buffer, null);
  } finally { cleanup(); }
});

test('barline edits are undoable, persist in drafts and remain isolated between documents', async () => {
  const { studio, saved, cleanup } = mountStudio();
  try {
    await studio.openChart(file()); const first = studio.state.activeId;
    studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 });
    studio.applySettings({ barline: false });
    assert.equal(studio.bar.value.barline, false);
    assert.equal(studio.state.chart.bars[1].barline, false);
    assert.ok(workspace(saved).documents[0].text.includes('#BARLINEOFF'));
    assert.equal(studio.command.value.commands[0].name, 'BARLINEOFF');
    studio.history(); assert.equal(studio.bar.value.barline, true);
    studio.history(true); assert.equal(studio.bar.value.barline, false);
    await studio.openChart(file('second.tja')); assert.equal(studio.bar.value.barline, true);
    studio.switchChart(first); assert.equal(studio.bar.value.barline, false);
    studio.restore(); assert.equal(studio.bar.value.barline, false);
    studio.clearSettings(); assert.equal(studio.bar.value.barline, true);
    assert.equal(studio.state.undo.length, 2);
  } finally { cleanup(); }
});

test('language changes update existing notices and cells without touching chart state or history', async () => {
  const { studio, saved, cleanup } = mountStudio();
  try {
    await studio.openChart(file('咚.tja', chart.replace('TITLE:Vue session', 'TITLE:歌曲')));
    studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 });
    studio.chooseNote('7');
    const text = studio.state.text, source = studio.state.source, undo = studio.state.undo;
    const persisted = saved.get('tja-wave-workspace'), selected = studio.state.selectedCell;
    const cases = [['en', 'Balloon roll', 'Changes synchronized.'], ['ja', '風船連打', '変更を同期しました。'], ['zh-TW', '氣球連打', '變更已同步。'], ['ko', '풍선 연타', '변경 사항이 동기화되었습니다.'], ['zh-CN', '气球连打', '更改已同步。']];
    for (const [code, name, notice] of cases) {
      locale.value = code; await nextTick();
      assert.equal(studio.cell.value.name, name); assert.equal(studio.state.notice, notice);
      assert.equal(studio.state.filename, '咚.tja'); assert.equal(studio.state.chart.title, '歌曲');
      assert.equal(studio.state.text, text); assert.equal(studio.state.source, source);
      assert.equal(studio.state.undo, undo); assert.equal(studio.state.selectedCell, selected);
      assert.equal(studio.state.dirty, true); assert.equal(saved.get('tja-wave-workspace'), persisted);
    }
    studio.setBpm(0);
    assert.equal(studio.state.error, true);
    locale.value = 'en'; assert.equal(studio.state.notice, 'BPM must be positive.');
    locale.value = 'ja'; assert.equal(studio.state.notice, 'BPM は正の数で指定してください。');
  } finally { locale.value = 'zh-CN'; cleanup(); }
});

test('Escape deselects notes without editing and canceled selections stay cleared across tabs', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  try {
    await studio.openChart(file()); const first = studio.state.activeId;
    studio.selectCell({ bar: 1, numerator: 0, denominator: 16, divisions: 16 });
    const text = studio.state.text, source = studio.state.source, position = studio.state.position;
    let prevented = false;
    handlers.get('keydown')({ key: 'Escape', preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(studio.cell.value, null); assert.equal(studio.state.commandCell, null);
    for (const key of ['1', '8', '0', 'Delete', 'Backspace', 'Escape']) handlers.get('keydown')({ key, preventDefault() { assert.fail('Deselected editor must not consume this key'); } });
    assert.equal(studio.state.text, text); assert.equal(studio.state.source, source);
    assert.equal(studio.state.position, position); assert.equal(studio.state.selected, 1);
    assert.equal(studio.state.dirty, false); assert.equal(studio.state.undo.length, 0); assert.equal(studio.state.redo.length, 0);
    studio.newChart(); studio.switchChart(first);
    assert.equal(studio.cell.value, null); assert.equal(studio.state.commandCell, null);
  } finally { cleanup(); }
});

test('Escape preserves native input, dialog, modified and composing behavior', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const native = overrides => handlers.get('keydown')({ key: 'Escape', preventDefault() { assert.fail('Native Escape action must be preserved'); }, ...overrides });
  try {
    await studio.openChart(file()); studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 });
    for (const activeElement of [
      ...['INPUT', 'TEXTAREA', 'SELECT'].map(tagName => ({ tagName })),
      { tagName: 'DIV', isContentEditable: true }, { tagName: 'BUTTON', closest: () => ({}) }
    ]) { document.activeElement = activeElement; native({}); }
    document.activeElement = null;
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) native({ [modifier]: true });
    assert.ok(studio.state.selectedCell);
    studio.editSource('unfinished'); native({});
    assert.equal(studio.state.source, 'unfinished'); assert.equal(studio.state.invalid, true);
  } finally { cleanup(); }
});

test('Escape cancels the pending smooth reveal', async () => {
  const { studio, handlers, mock, ticks, cleanup } = mountStudio();
  let now = 0;
  try {
    mock('performance', { now: () => now });
    await studio.openChart(file('long.tja', longChart));
    studio.controls.view = .25; studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 });
    for (let index = 0; index < 8; index++) handlers.get('keydown')({ key: 'd', preventDefault() {} });
    now = 45; ticks.frame(now);
    const start = studio.visible.value.start; assert.ok(start > 0);
    handlers.get('keydown')({ key: 'Escape', preventDefault() {} });
    now = 500; ticks.frame(now);
    assert.equal(studio.visible.value.start, start); assert.equal(studio.cell.value, null);
  } finally { cleanup(); }
});

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
    assert.equal(studio.visible.value.endBeat - studio.visible.value.startBeat, 8);
    studio.controls.view = 1;
    assert.equal(studio.visible.value.start, -2);
    assert.equal(studio.visible.value.endBeat - studio.visible.value.startBeat, 4);
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
    await studio.openAudio(file('music.wav')); assert.equal(studio.state.fileErrors.length, 1);
    await studio.openChart(file('broken.tja', 'invalid')); assert.equal(studio.state.documents.length, 0);
    assert.equal(studio.state.fileErrors.length, 2);
  } finally { cleanup(); }
});

test('untouched new charts stay clean across navigation, inactive closing and automatic restore', () => {
  const saved = new Map(), mounted = mountStudio(saved);
  const { studio, handlers, mock } = mounted;
  const unexpectedPrompt = () => assert.fail('Untouched new charts must not prompt to save');
  try {
    mock('confirm', unexpectedPrompt);
    studio.newChart();
    const first = studio.state.activeId;
    assert.equal(studio.state.dirty, false);
    assert.equal(studio.state.savedText, studio.state.text);
    assert.equal(studio.state.fileHandle, null);
    studio.select(0); studio.setSnap(7); studio.panTimeline(.25);
    studio.selectCell({ bar: 0, numerator: 1, denominator: 4, divisions: 16 });
    studio.newChart();
    studio.closeChart(first);
    assert.equal(studio.state.documents.length, 1);
    assert.equal(studio.state.dirty, false);
    handlers.get('beforeunload')({ preventDefault: unexpectedPrompt });
    assert.equal(workspace(saved).documents[0].dirty, false);
  } finally { mounted.cleanup(); }
  const restored = mountStudio(saved);
  try {
    restored.mock('confirm', unexpectedPrompt);
    assert.equal(restored.studio.state.filename, 'untitled.tja');
    assert.equal(restored.studio.state.dirty, false);
    restored.studio.closeChart(restored.studio.state.activeId);
    assert.equal(restored.studio.state.documents.length, 0);
    assert.deepEqual(workspace(saved).documents, []);
  } finally { restored.cleanup(); }
});

test('editing a chart prompts on close, undo clears dirty, and invalid source remains protected', async () => {
  const { studio, handlers, mock, cleanup } = mountStudio();
  let confirmations = 0;
  try {
    mock('confirm', () => { confirmations++; return false; });
    await studio.openChart(file());
    studio.selectCell({ bar: 0, numerator: 0, denominator: 4, divisions: 16 });
    studio.chooseNote('2');
    assert.equal(studio.state.dirty, true);
    studio.closeChart(studio.state.activeId);
    assert.equal(confirmations, 1); assert.equal(studio.state.documents.length, 1);
    let warned = false;
    handlers.get('beforeunload')({ preventDefault() { warned = true; } });
    assert.equal(warned, true);
    studio.history();
    assert.equal(studio.state.dirty, false);
    handlers.get('beforeunload')({ preventDefault() { assert.fail('Undo to the initial chart must clear the warning'); } });
    studio.history(true);
    assert.equal(studio.state.dirty, true);
    studio.closeChart(studio.state.activeId);
    assert.equal(confirmations, 2);
    studio.history();
    studio.editSource('unfinished');
    assert.equal(studio.state.dirty, false); assert.equal(studio.state.invalid, true);
    studio.closeChart(studio.state.activeId);
    assert.equal(confirmations, 3); assert.equal(studio.state.documents.length, 1);
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
    assert.equal(studio.state.dirty, false);
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
    await studio.openChart(file()); await nextTick();
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
    await studio.openChart(file()); studio.setLoop(1, 1); await nextTick(); await studio.play();
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
    await studio.openChart(file()); studio.controls.hits = false; await nextTick();
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

test('WAVE remains metadata and opening a chart never requests a directory or automatically loads audio', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    window.showDirectoryPicker = () => assert.fail('Opening a chart must not request directory access');
    await studio.openChart(file('unlinked.tja', waveChart('owned-music.ogg')));
    assert.equal(studio.state.chart.wave, 'owned-music.ogg');
    assert.equal(studio.state.notice, '谱面已载入，可直接播放音符音或载入伴奏。');
    assert.equal(studio.state.error, false);
    assert.equal(studio.state.buffer, null);
    assert.equal('mediaDirectoryName' in studio.state, false);
    for (const method of ['autoAudio', 'chooseMediaDirectory', 'setMediaFiles']) assert.equal(method in studio, false);
  } finally { cleanup(); }
});

test('manual audio belongs to its chart and missing WAVE audio does not prevent unaccompanied playback', async () => {
  const { studio, mock, cleanup } = mountStudio();
  fakeAudio(mock);
  try {
    await studio.openChart(file('first.tja', waveChart('song.mp3')));
    assert.equal(studio.state.buffer, null); assert.equal(studio.state.notice, '谱面已载入，可直接播放音符音或载入伴奏。');
    const first = studio.state.activeId;
    await studio.openAudio(audioFile('first.wav', '', 1));
    assert.equal(studio.state.buffer.marker, 1);
    await studio.openChart(file('second.tja', waveChart('song.mp3')));
    assert.equal(studio.state.buffer, null);
    await studio.openAudio(audioFile('second.wav', '', 2));
    assert.equal(studio.state.buffer.marker, 2);
    studio.switchChart(first); assert.equal(studio.state.buffer.marker, 1);
    await studio.openChart(file('missing.tja', waveChart('missing.mp3')));
    assert.equal(studio.state.buffer, null); assert.equal(studio.state.error, false);
    await studio.play(); assert.equal(studio.state.playing, true);
  } finally { cleanup(); }
});

test('changing WAVE cancels a pending manual audio read without trying to match another file', async () => {
  const { studio, mock, cleanup } = mountStudio();
  fakeAudio(mock);
  try {
    await studio.openChart(file('fixture.tja', waveChart('song.mp3')));
    let finish;
    const loading = studio.openAudio({ name: 'manual.wav', arrayBuffer: () => new Promise(resolve => { finish = resolve; }) });
    studio.setMetadata({ WAVE: 'next.mp3' });
    finish(new Uint8Array([9]).buffer); await loading;
    assert.equal(studio.state.buffer, null);
    assert.equal(studio.state.chart.wave, 'next.mp3'); assert.equal(studio.state.error, false);
  } finally { cleanup(); }
});

test('corrupt manually loaded audio is explicit and leaves chart playback usable', async () => {
  const { studio, mock, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  try {
    await studio.openChart(file('fixture.tja', waveChart('song.mp3')));
    const notice = studio.state.notice;
    context.decodeAudioData = async () => { throw new Error('corrupt audio'); };
    await studio.openAudio(audioFile('song.mp3'));
    assert.equal(studio.state.buffer, null); assert.equal(studio.state.notice, notice);
    assert.match(formatMessage(studio.state.fileErrors[0].error), /corrupt audio/);
    assert.equal(studio.state.error, false);
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

test('closing an inactive chart cannot cancel manual audio, while closing the active chart restores cached audio', async () => {
  const { studio, mock, cleanup } = mountStudio();
  fakeAudio(mock);
  try {
    await studio.openChart(file('first.tja', waveChart('song.mp3')));
    const first = studio.state.activeId;
    await studio.openChart(file('second.tja', waveChart('song.mp3')));
    let finish;
    const loading = studio.openAudio({ name: 'manual.wav', arrayBuffer: () => new Promise(resolve => { finish = resolve; }) });
    studio.closeChart(first); finish(new Uint8Array([9]).buffer); await loading;
    assert.equal(studio.state.audioName, 'manual.wav'); assert.equal(studio.state.buffer.marker, 9);
    const second = studio.state.activeId;
    studio.newChart();
    studio.closeChart(studio.state.activeId);
    await new Promise(setImmediate);
    assert.equal(studio.state.activeId, second); assert.equal(studio.state.audioName, 'manual.wav');
    assert.equal(studio.state.buffer.marker, 9);
  } finally { cleanup(); }
});

test('decoded audio is runtime-only and restore requires manually loading it again', async () => {
  const saved = new Map(), mounted = mountStudio(saved);
  fakeAudio(mounted.mock);
  try {
    await mounted.studio.openChart(file('fixture.tja', waveChart('song.mp3')));
    await mounted.studio.openAudio(audioFile('song.mp3'));
    mounted.studio.setBpm(150);
    assert.equal(mounted.studio.state.buffer.marker, 1);
    assert.ok(!JSON.stringify(workspace(saved)).includes('audioName'));
  } finally { mounted.cleanup(); }
  const restored = mountStudio(saved);
  const { context } = fakeAudio(restored.mock);
  try {
    assert.equal(restored.studio.state.buffer, null);
    assert.equal(restored.studio.state.chart.baseBpm, 150);
    assert.match(restored.studio.state.notice, /请重新载入音频/);
    await restored.studio.openAudio(audioFile('song.mp3', '', 2));
    assert.equal(restored.studio.state.buffer.marker, 2);
    const decode = context.decodeAudioData;
    context.decodeAudioData = async bytes => ({ ...await decode(bytes), duration: .5 });
    restored.studio.seek(7);
    await restored.studio.openAudio(audioFile('short.wav', '', 3));
    assert.equal(restored.studio.state.position, .5);
  } finally { restored.cleanup(); }
});

test('clearing loops removes range and pending markers without seeking, selecting, editing or starting playback and persists the clear', async () => {
  const saved = new Map(), mounted = mountStudio(saved);
  const { studio, handlers } = mounted;
  try {
    await studio.openChart(file()); studio.setLoop(1, 2, true);
    studio.selectCell({ bar: 1, numerator: 1, denominator: 4, divisions: 16 }); studio.seek(2.5);
    studio.panTimeline(1); studio.state.followPlayback = false;
    handlers.get('keydown')({ key: 'f', preventDefault() {} });
    const cell = studio.state.selectedCell, command = studio.state.commandCell, source = studio.state.source, start = studio.state.viewStart;
    studio.clearLoop();
    assert.equal(studio.state.customLoop, null); assert.equal(studio.state.loopAnchor, null);
    near(studio.state.position, 2.5); assert.equal(studio.state.playing, false);
    assert.equal(studio.state.selectedCell, cell); assert.equal(studio.state.commandCell, command);
    assert.equal(studio.state.source, source); assert.equal(studio.state.viewStart, start); assert.equal(studio.state.followPlayback, false);
    assert.equal(studio.state.text, chart); assert.equal(studio.state.undo.length, 0);
    assert.equal(studio.state.documents[0].customLoop, null);
  } finally { mounted.cleanup(); }
  const restored = mountStudio(saved);
  try { assert.equal(restored.studio.range.value, null); } finally { restored.cleanup(); }
});

test('clearing an active loop continues from the exact playback position beyond the old range', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  try {
    await studio.openChart(file()); studio.setLoop(1, 1, true); await studio.play();
    context.currentTime = .535; ticks.frame(); near(studio.state.position, .5);
    studio.clearLoop(); await nextTick(); await Promise.resolve();
    near(studio.state.position, .5); assert.equal(studio.state.playing, true);
    assert.equal(studio.range.value, null);
    context.currentTime = 3.07; ticks.frame(); near(studio.state.position, 3);
    assert.equal(studio.state.selected, 1); assert.equal(studio.state.playing, true);
    assert.equal(studio.state.text, chart);
  } finally { cleanup(); }
});

test('Shift+F clears confirmed and pending loops, ignores repeats and preserves native typing, dialogs, composition and modifiers', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const press = overrides => handlers.get('keydown')({ key: 'F', shiftKey: true, preventDefault() {}, ...overrides });
  const native = overrides => press({ preventDefault() { assert.fail('Native Shift+F must be preserved'); }, ...overrides });
  try {
    native(); await studio.openChart(file()); native();
    studio.setLoop(1, 2, true);
    for (const activeElement of [
      ...['INPUT', 'TEXTAREA', 'SELECT'].map(tagName => ({ tagName })),
      { tagName: 'DIV', isContentEditable: true }, { tagName: 'BUTTON', closest: () => ({}) }
    ]) { document.activeElement = activeElement; native(); }
    document.activeElement = null;
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'isComposing']) native({ [modifier]: true });
    press({ repeat: true }); assert.deepEqual(studio.state.customLoop, [1, 2]);
    press(); assert.equal(studio.range.value, null);
    handlers.get('keydown')({ key: 'f', preventDefault() {} }); assert.equal(studio.state.loopAnchor, 0);
    press(); assert.equal(studio.state.loopAnchor, null);
    studio.setLoop(1, 2, true); studio.editSource('unfinished');
    press(); assert.equal(studio.state.customLoop, null); assert.equal(studio.state.source, 'unfinished'); assert.equal(studio.state.invalid, true);
  } finally { cleanup(); }
});

test('F selects inclusive forward, reverse and single-measure loops without altering notes or starting paused playback', async () => {
  const { studio, handlers, saved, cleanup } = mountStudio();
  const press = overrides => handlers.get('keydown')({ key: 'f', preventDefault() {}, ...overrides });
  const source = chart.replace('2000,', '2000,\n3000,\n4000,');
  try {
    await studio.openChart(file('four.tja', source));
    studio.setLoop(2, 3);
    studio.selectCell({ bar: 1, numerator: 1, denominator: 4, divisions: 16 });
    const position = studio.state.position, cell = studio.state.selectedCell;
    press();
    assert.equal(studio.state.loopAnchor, 1);
    assert.equal(studio.state.position, position); assert.equal(studio.state.selectedCell, cell);
    assert.deepEqual(studio.range.value, [2, 3]); assert.equal(studio.state.playing, false);
    press({ repeat: true }); assert.equal(studio.state.loopAnchor, 1);
    studio.select(3); press({ key: 'F' });
    assert.deepEqual(studio.range.value, [2, 4]); assert.equal(studio.state.loopAnchor, null);
    assert.equal(studio.state.playing, false);
    assert.equal(studio.state.position, position); assert.equal(studio.state.selectedCell, cell);
    studio.select(3); press(); studio.select(0); press();
    assert.deepEqual(studio.range.value, [1, 4]);
    studio.select(2); press(); press();
    assert.deepEqual(studio.range.value, [3, 3]); assert.equal(studio.state.position, position);
    assert.equal(studio.state.text, source); assert.equal(studio.state.undo.length, 0);
    assert.ok(!JSON.stringify(workspace(saved)).includes('loopAnchor'));
  } finally { cleanup(); }
});

test('F preserves native inputs, dialogs, modifiers and composition, and needs a valid measure', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const native = overrides => handlers.get('keydown')({ key: 'f', preventDefault() { assert.fail('Native F must be preserved'); }, ...overrides });
  try {
    native(); studio.newChart(); native();
    await studio.openChart(file());
    for (const activeElement of [
      ...['INPUT', 'TEXTAREA', 'SELECT'].map(tagName => ({ tagName })),
      { tagName: 'DIV', isContentEditable: true },
      { tagName: 'BUTTON', closest: () => ({}) }
    ]) { document.activeElement = activeElement; native(); }
    document.activeElement = null;
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) native({ [modifier]: true });
    assert.equal(studio.state.loopAnchor, null);
    handlers.get('keydown')({ key: 'f', repeat: true, preventDefault() {} });
    assert.equal(studio.state.loopAnchor, null);
    studio.editSource('unfinished'); native();
    assert.equal(studio.state.loopAnchor, null); assert.equal(studio.state.invalid, true);
    assert.equal(studio.state.text, chart); assert.equal(studio.state.undo.length, 0);
  } finally { cleanup(); }
});

test('IME physical F keys select and clear ranges for Process, legacy 229 and composing events', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const press = overrides => handlers.get('keydown')({ key: 'Process', code: 'KeyF', preventDefault() {}, ...overrides });
  try {
    await studio.openChart(file());
    for (const event of [{}, { key: 'f', keyCode: 229 }, { key: 'f', isComposing: true }, { key: 'Unidentified', isComposing: true }]) {
      studio.select(0); press(event);
      assert.equal(studio.state.loopAnchor, 0);
      press({ ...event, repeat: true }); assert.equal(studio.state.loopAnchor, 0);
      studio.select(1); press(event);
      assert.deepEqual(studio.range.value, [1, 2]); assert.equal(studio.state.loopAnchor, null);
      press({ ...event, shiftKey: true }); assert.equal(studio.range.value, null);
    }
    assert.equal(studio.state.text, chart); assert.equal(studio.state.undo.length, 0);
    assert.equal(studio.state.playing, false);
  } finally { cleanup(); }
});

test('IME physical keys edit notes, move the selection, change snap and seek without changing their shortcut meanings', async () => {
  const { studio, handlers, mock, cleanup } = mountStudio();
  fakeAudio(mock);
  const press = code => handlers.get('keydown')({ key: 'Process', code, keyCode: 229, isComposing: true, preventDefault() {} });
  try {
    await studio.openChart(file());
    studio.selectCell({ bar: 0, numerator: 0, denominator: 4, divisions: 16 });
    press('Digit2'); assert.equal(studio.cell.value.note, '2');
    press('Minus'); assert.equal(studio.cell.value.note, 'A');
    press('Equal'); assert.equal(studio.cell.value.note, 'B');
    press('KeyD'); near(studio.cell.value.numerator / studio.cell.value.denominator, 1 / 16);
    press('KeyA'); near(studio.cell.value.numerator / studio.cell.value.denominator, 0);
    press('KeyW'); assert.equal(studio.controls.snap, 24);
    press('KeyS'); assert.equal(studio.controls.snap, 16);
    press('KeyE'); near(studio.state.position, 2);
    press('KeyQ'); near(studio.state.position, 0);
    press('Space'); await Promise.resolve(); assert.equal(studio.state.playing, true);
    press('Space'); assert.equal(studio.state.playing, false);
    assert.equal(studio.state.undo.length, 3);
  } finally { cleanup(); }
});

test('IME physical shortcuts preserve native text entry, dialogs, blocked editing and events without usable physical keys', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const native = overrides => handlers.get('keydown')({ key: 'Process', code: 'KeyF', keyCode: 229, isComposing: true, preventDefault() { assert.fail('Native IME action must be preserved'); }, ...overrides });
  try {
    await studio.openChart(file());
    studio.selectCell({ bar: 0, numerator: 0, denominator: 4, divisions: 16 });
    for (const activeElement of [
      ...['INPUT', 'TEXTAREA', 'SELECT'].map(tagName => ({ tagName })),
      { tagName: 'DIV', isContentEditable: true }, { tagName: 'BUTTON', closest: () => ({}) }
    ]) {
      document.activeElement = activeElement;
      for (const code of ['KeyF', 'Digit2', 'Space']) native({ code });
    }
    document.activeElement = null;
    studio.state.editorBlocked = true; native(); studio.state.editorBlocked = false;
    for (const code of [undefined, '', 'Unidentified', 'Enter']) native({ code });
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) native({ [modifier]: true });
    assert.equal(studio.state.loopAnchor, null); assert.equal(studio.state.text, chart);
    assert.equal(studio.state.undo.length, 0);
  } finally { cleanup(); }
});

test('keyup-only IME letters select ranges, navigate, change snap and seek', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const release = (key, extra = {}) => handlers.get('keyup')({ key, code: `Key${key.toUpperCase()}`, preventDefault() {}, ...extra });
  try {
    await studio.openChart(file());
    studio.selectCell({ bar: 0, numerator: 0, denominator: 4, divisions: 16 });
    release('w'); assert.equal(studio.controls.snap, 24);
    release('s'); assert.equal(studio.controls.snap, 16);
    release('d'); near(studio.cell.value.numerator / studio.cell.value.denominator, 1 / 16);
    release('a'); near(studio.cell.value.numerator / studio.cell.value.denominator, 0);
    release('e'); near(studio.state.position, 2);
    release('q'); near(studio.state.position, 0);
    release('f'); assert.equal(studio.state.loopAnchor, 0); assert.equal(studio.range.value, null);
    studio.select(1); release('f'); assert.deepEqual(studio.range.value, [1, 2]);
    release('f', { shiftKey: true }); assert.equal(studio.range.value, null);
    assert.equal(studio.state.text, chart); assert.equal(studio.state.undo.length, 0);
  } finally { cleanup(); }
});

test('keyup-only IME Space toggles playback on the first release after Q/E without duplicating paired events', async () => {
  const { studio, handlers, mock, cleanup } = mountStudio();
  fakeAudio(mock);
  const event = code => ({ key: 'Process', code, keyCode: 229, isComposing: true, preventDefault() {} });
  try {
    await studio.openChart(file());
    handlers.get('keyup')(event('KeyE')); near(studio.state.position, 2);
    handlers.get('keyup')(event('Space')); await Promise.resolve();
    assert.equal(studio.state.playing, true);
    handlers.get('keyup')(event('KeyQ')); await Promise.resolve();
    near(studio.state.position, 0); assert.equal(studio.state.playing, true);
    handlers.get('keyup')(event('Space'));
    assert.equal(studio.state.playing, false);
    for (const playing of [true, false]) {
      handlers.get('keydown')(event('Space')); await Promise.resolve();
      assert.equal(studio.state.playing, playing);
      handlers.get('keydown')({ ...event('Space'), repeat: true });
      handlers.get('keyup')(event('Space')); await Promise.resolve();
      assert.equal(studio.state.playing, playing);
    }
  } finally { cleanup(); }
});

test('keyup-only Space preserves native controls and modified actions, including focus changes during a press', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const event = extra => ({ key: ' ', code: 'Space', preventDefault() { assert.fail('Native Space action must be preserved'); }, ...extra });
  try {
    await studio.openChart(file());
    for (const activeElement of [
      ...['INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY'].map(tagName => ({ tagName })),
      { tagName: 'DIV', isContentEditable: true }, { tagName: 'BUTTON', closest: () => ({}) }
    ]) { document.activeElement = activeElement; handlers.get('keyup')(event()); }
    document.activeElement = { tagName: 'INPUT' };
    handlers.get('keydown')(event());
    document.activeElement = null; handlers.get('keyup')(event());
    for (const flag of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'defaultPrevented', 'repeat']) handlers.get('keyup')(event({ [flag]: true }));
    studio.state.editorBlocked = true; handlers.get('keyup')(event());
    assert.equal(studio.state.playing, false);
  } finally { cleanup(); }
});

test('paired keydown and keyup do not execute twice and lost releases reset on blur', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const event = (key, extra = {}) => ({ key, code: `Key${key.toUpperCase()}`, preventDefault() {}, ...extra });
  try {
    await studio.openChart(file());
    for (const extra of [{}, { key: 'Process', isComposing: true, keyCode: 229 }]) {
      handlers.get('keydown')(event('w', extra)); assert.equal(studio.controls.snap, 24);
      handlers.get('keyup')(event('w')); assert.equal(studio.controls.snap, 24);
      handlers.get('keydown')(event('s', extra));
      handlers.get('keyup')(event('s')); assert.equal(studio.controls.snap, 16);
      handlers.get('keydown')(event('f', extra));
      handlers.get('keydown')(event('f', { ...extra, repeat: true }));
      handlers.get('keyup')(event('f'));
      assert.equal(studio.state.loopAnchor, 0); assert.equal(studio.range.value, null);
      studio.clearLoop();
    }
    handlers.get('keydown')(event('f')); studio.clearLoop();
    handlers.get('blur')();
    handlers.get('keyup')(event('f')); assert.equal(studio.state.loopAnchor, 0);
  } finally { cleanup(); }
});

test('keyup fallback preserves native typing and does not trigger after focus leaves an input', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const native = extra => handlers.get('keyup')({ key: 'f', code: 'KeyF', preventDefault() { assert.fail('Native keyup must be preserved'); }, ...extra });
  try {
    await studio.openChart(file());
    for (const activeElement of [
      ...['INPUT', 'TEXTAREA', 'SELECT'].map(tagName => ({ tagName })),
      { tagName: 'DIV', isContentEditable: true }, { tagName: 'BUTTON', closest: () => ({}) }
    ]) { document.activeElement = activeElement; native(); }
    document.activeElement = { tagName: 'INPUT' };
    handlers.get('keydown')({ key: 'f', code: 'KeyF', preventDefault() { assert.fail('Input keydown must be preserved'); } });
    document.activeElement = null; native();
    for (const flag of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented', 'repeat']) native({ [flag]: true });
    studio.state.editorBlocked = true; native();
    assert.equal(studio.state.loopAnchor, null); assert.equal(studio.state.text, chart);
  } finally { cleanup(); }
});

test('unfinished F markers cancel on Escape, document changes, course or branch switches, edits and other loop operations', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const mark = () => { handlers.get('keydown')({ key: 'f', preventDefault() {} }); assert.equal(studio.state.loopAnchor, studio.state.selected); };
  try {
    await studio.openChart(file('branches.tja', branchChart));
    const first = studio.state.activeId;
    studio.selectCell({ bar: 0, numerator: 1, denominator: 4, divisions: 16 });
    mark();
    handlers.get('keydown')({ key: 'Escape', preventDefault() {} });
    assert.equal(studio.state.loopAnchor, null); assert.ok(studio.state.selectedCell);
    assert.equal(studio.state.customLoop, null);
    mark(); await studio.openChart(file('second.tja')); assert.equal(studio.state.loopAnchor, null);
    mark(); studio.switchChart(first); assert.equal(studio.state.loopAnchor, null);
    mark(); studio.changeCourse(1); assert.equal(studio.state.loopAnchor, null);
    studio.changeCourse(0);
    mark(); studio.changeBranch(0, 'E'); assert.equal(studio.state.loopAnchor, null);
    mark(); studio.applySettings({ bpm: 140 }); assert.equal(studio.state.loopAnchor, null);
    mark(); studio.history(); assert.equal(studio.state.loopAnchor, null);
    mark(); studio.setLoop(1, 2, true); assert.equal(studio.state.loopAnchor, null);
    mark(); studio.loopCurrent(); assert.equal(studio.state.loopAnchor, null);
    mark(); studio.editSource('unfinished'); assert.equal(studio.state.loopAnchor, null);
  } finally { cleanup(); }
});

test('F leaves active playback untouched at the first endpoint and loops through the entire last measure after the second', async () => {
  const { studio, handlers, mock, ticks, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  const press = () => handlers.get('keydown')({ key: 'f', preventDefault() {} });
  try {
    await studio.openChart(file()); await nextTick();
    await studio.play();
    context.currentTime = .535; ticks.frame(); near(studio.state.position, .5);
    press(); assert.equal(studio.state.playing, true); near(studio.state.position, .5);
    assert.equal(studio.range.value, null);
    studio.state.selected = 1; press(); await nextTick(); await Promise.resolve();
    assert.equal(studio.state.playing, true);
    assert.deepEqual(studio.range.value, [1, 2]); near(studio.state.position, 0);
    context.currentTime = 3.07; ticks.frame(); near(studio.state.position, 2.5);
    context.currentTime = 5.07; ticks.frame(); near(studio.state.position, .5);
    assert.equal(studio.state.text, chart); assert.equal(studio.state.undo.length, 0);
  } finally { cleanup(); }
});

test('drag-selected loop ranges enable repetition without starting paused playback and immediately retarget active playback', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  try {
    await studio.openChart(file()); await nextTick();
    assert.equal(studio.setLoop(2, 2, true), true);
    assert.equal(studio.state.playing, false);
    assert.deepEqual(studio.range.value, [2, 2]); near(studio.state.position, 0);
    assert.equal(studio.state.text, chart); assert.equal(studio.state.undo.length, 0);
    await studio.play();
    context.currentTime = .535; ticks.frame(); near(studio.state.position, 2.5);
    assert.equal(studio.setLoop(1, 1, true), true);
    await nextTick(); await Promise.resolve();
    assert.equal(studio.state.playing, true);
    assert.deepEqual(studio.range.value, [1, 1]); near(studio.state.position, 0);
    context.currentTime = 3.07; ticks.frame(); near(studio.state.position, .5);
    studio.pause(); await nextTick();
    assert.equal(studio.setLoop(2, 1, true), undefined);
    assert.deepEqual(studio.range.value, [1, 1]);
    assert.equal(studio.state.error, true);
  } finally { cleanup(); }
});

test('loop range applies while playing, clamps both endpoints, restarts at the range start and rejects only completed invalid ranges', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  try {
    await studio.openChart(file()); await nextTick();
    await studio.play();
    context.currentTime = 1.035; ticks.frame(); near(studio.state.position, 1);
    assert.equal(studio.setLoop(2, 200), true);
    await Promise.resolve();
    assert.deepEqual(studio.range.value, [2, 2]); near(studio.state.position, 2);
    assert.equal(studio.state.selected, 0);
    assert.equal(studio.state.playing, true);
    context.currentTime = 1.57; ticks.frame(); near(studio.state.position, 2.5);
    assert.equal(studio.setLoop(-100, 200), true); await Promise.resolve();
    assert.deepEqual(studio.range.value, [1, 2]); near(studio.state.position, 0);
    assert.equal(studio.setLoop(2, 1), undefined);
    assert.deepEqual(studio.range.value, [1, 2]); assert.equal(studio.state.playing, true);
    assert.match(studio.state.notice, /结束小节不能早于/);
    assert.equal(studio.setLoop(1.5, 2), undefined);
    assert.deepEqual(studio.range.value, [1, 2]);
    await nextTick(); await Promise.resolve();
    studio.setLoop(2, 2); await Promise.resolve();
    context.currentTime = 4.105; ticks.frame(); near(studio.state.position, 2.5);
    assert.equal(studio.state.playing, true);
    studio.pause(); const position = studio.state.position;
    studio.setLoop(99, 99); assert.deepEqual(studio.range.value, [2, 2]); near(studio.state.position, position);
  } finally { cleanup(); }
});

test('song metadata is one undoable edit, survives saving/restoring, and WAVE edits invalidate manual audio', async () => {
  const saved = new Map(), mounted = mountStudio(saved);
  fakeAudio(mounted.mock);
  const { studio } = mounted;
  try {
    await studio.openChart(file('fixture.tja', waveChart('song.mp3')));
    await studio.openAudio(audioFile('song.mp3', '', 1));
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
    await new Promise(setImmediate); assert.equal(studio.state.buffer, null);
    await studio.openAudio(audioFile('next.mp3', '', 2)); assert.equal(studio.state.buffer.marker, 2);
    studio.history(); await new Promise(setImmediate);
    assert.equal(studio.state.buffer, null); assert.equal(studio.state.chart.wave, 'song.mp3');
    studio.history(true); await new Promise(setImmediate);
    assert.equal(studio.state.buffer, null); assert.equal(studio.state.chart.wave, 'next.mp3');
    const disk = diskFile('saved.tja');
    window.showSaveFilePicker = async () => disk.handle;
    assert.equal(await studio.saveChart(), true);
    assert.equal(disk.text, studio.state.text); assert.equal(studio.state.dirty, false);
  } finally { mounted.cleanup(); }
  const restored = mountStudio(saved);
  try { assert.equal(restored.studio.metadata.value.ARTIST, 'Artist'); assert.equal(restored.studio.metadata.value.WAVE, 'next.mp3'); }
  finally { restored.cleanup(); }
});

test('number keys insert the matching note at the selected cell and preserve selection and undo', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  let prevented = 0;
  const press = (key, overrides) => handlers.get('keydown')({ key, code: `Digit${key}`, preventDefault() { prevented++; }, ...overrides });
  try {
    await studio.openChart(file());
    studio.selectCell({ bar: 0, numerator: 1, denominator: 4, divisions: 16 });
    document.activeElement = { tagName: 'DIV' };
    for (const [index, note] of [...'1234567890'].entries()) {
      press(note, note === '2' ? { code: 'Numpad2' } : {});
      assert.equal(studio.cell.value.note, note);
      assert.equal(studio.state.undo.length, index + 1);
      assert.equal(studio.cell.value.numerator, 1); assert.equal(studio.cell.value.denominator, 4);
    }
    press('1', { repeat: true });
    assert.equal(studio.cell.value.note, '0'); assert.equal(studio.state.undo.length, 10);
    assert.equal(prevented, 11);
    studio.history(); studio.selectCell({ bar: 0, numerator: 1, denominator: 4, divisions: 16 });
    assert.equal(studio.cell.value.note, '9');
    studio.history(true); studio.selectCell({ bar: 0, numerator: 1, denominator: 4, divisions: 16 });
    assert.equal(studio.cell.value.note, '0');
  } finally { cleanup(); }
});

test('Delete and Backspace clear the selected note like zero, including balloon counts and undo', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  let prevented = 0;
  try {
    await studio.openChart(file());
    studio.selectCell({ bar: 0, numerator: 1, denominator: 4, divisions: 16 });
    for (const key of ['Delete', 'Backspace', '0']) {
      studio.chooseNote('7'); studio.setBalloon(11);
      const original = studio.state.text, historyLength = studio.state.undo.length;
      handlers.get('keydown')({ key, preventDefault() { prevented++; } });
      assert.equal(studio.cell.value.note, '0'); assert.equal(studio.cell.value.ordinal, -1);
      assert.equal(studio.state.undo.length, historyLength + 1);
      assert.equal(studio.cell.value.numerator, 1); assert.equal(studio.cell.value.denominator, 4);
      studio.history();
      studio.selectCell({ bar: 0, numerator: 1, denominator: 4, divisions: 16 });
      assert.equal(studio.state.text, original); assert.equal(studio.cell.value.count, 11);
      studio.history(true); studio.selectCell({ bar: 0, numerator: 1, denominator: 4, divisions: 16 });
      assert.equal(studio.cell.value.note, '0');
    }
    assert.equal(prevented, 3);
  } finally { cleanup(); }
});

test('note shortcuts do not edit without a cell, inside inputs or dialogs, or with modifiers', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const press = overrides => handlers.get('keydown')({ key: '1', code: 'Digit1', preventDefault() { assert.fail('This numeric key must not be intercepted'); }, ...overrides });
  try {
    await studio.openChart(file());
    const original = studio.state.text;
    for (const key of ['1', '0', '-', '=', 'Delete', 'Backspace']) press({ key });
    studio.selectCell({ bar: 0, numerator: 0, denominator: 4, divisions: 16 });
    for (const activeElement of [
      ...['INPUT', 'TEXTAREA', 'SELECT'].map(tagName => ({ tagName })),
      { tagName: 'DIV', isContentEditable: true },
      { tagName: 'BUTTON', closest: () => ({}) }
    ]) {
      document.activeElement = activeElement;
      for (const key of ['1', '0', '-', '=', 'Delete', 'Backspace']) press({ key });
    }
    document.activeElement = null;
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
      for (const key of ['1', '0', '-', '=', 'Delete', 'Backspace']) press({ key, [modifier]: true });
    }
    press({ isComposing: true, code: undefined });
    assert.equal(studio.state.text, original); assert.equal(studio.state.undo.length, 0);
    studio.editSource('unfinished');
    for (const key of ['1', '0', '-', '=', 'Delete', 'Backspace']) press({ key });
    assert.equal(studio.state.source, 'unfinished'); assert.equal(studio.state.invalid, true);
  } finally { cleanup(); }
});

test('Ctrl+Alt+W closes only the active chart once per press, including from inputs', () => {
  const { studio, handlers, mock, cleanup } = mountStudio();
  let prevented = 0, blurred = 0;
  const press = overrides => handlers.get('keydown')({ key: 'w', code: 'KeyW', ctrlKey: true, altKey: true, preventDefault() { prevented++; }, ...overrides });
  try {
    mock('confirm', () => assert.fail('Untouched new tabs must close without confirmation'));
    studio.newChart(); const first = studio.state.activeId;
    studio.newChart(); const second = studio.state.activeId;
    document.activeElement = { tagName: 'INPUT', blur() { blurred++; } };
    press({});
    assert.equal(studio.state.activeId, first); assert.equal(studio.state.documents.length, 1);
    assert.ok(!studio.state.documents.some(item => item.id === second));
    press({ repeat: true });
    assert.equal(studio.state.activeId, first); assert.equal(blurred, 1);
    document.activeElement = { tagName: 'TEXTAREA' };
    press({ key: 'W' });
    assert.equal(studio.state.documents.length, 0);
    press({});
    assert.equal(studio.state.documents.length, 0); assert.equal(prevented, 4);
  } finally { cleanup(); }
});

test('close shortcut protects pending edits and saving, and ignores dialogs and other key combinations', async () => {
  const { studio, handlers, mock, cleanup } = mountStudio();
  let prevented = 0, confirmations = 0;
  const press = overrides => handlers.get('keydown')({ key: 'w', code: 'KeyW', ctrlKey: true, altKey: true, preventDefault() { prevented++; }, ...overrides });
  try {
    mock('confirm', () => { confirmations++; return false; });
    await studio.openChart(file());
    document.activeElement = { tagName: 'INPUT', blur() { studio.renameChart('renamed'); } };
    press({});
    assert.equal(studio.state.filename, 'renamed.tja');
    assert.equal(studio.state.dirty, true); assert.equal(confirmations, 1);
    document.activeElement = { tagName: 'TEXTAREA' };
    studio.editSource('1000,');
    press({});
    assert.equal(studio.state.invalid, false); assert.equal(studio.state.chart.bars[0].notes, '1000');
    assert.equal(confirmations, 2); assert.equal(studio.state.documents.length, 1);
    studio.editSource('unfinished');
    press({});
    assert.equal(studio.state.invalid, true); assert.equal(confirmations, 3);
    studio.state.saving = true; studio.state.documents[0].saving = true;
    press({});
    assert.match(studio.state.notice, /正在保存/); assert.equal(confirmations, 3);
    studio.state.saving = false; studio.state.documents[0].saving = false;
    document.activeElement = { tagName: 'BUTTON', closest: () => ({}) };
    press({});
    document.activeElement = null;
    for (const overrides of [
      { altKey: false }, { altKey: false, shiftKey: true },
      { shiftKey: true }, { metaKey: true }, { isComposing: true },
      { key: '\u0142', getModifierState: key => key === 'AltGraph' }, { key: 'q', code: 'KeyQ' }
    ]) press(overrides);
    assert.equal(prevented, 4); assert.equal(confirmations, 3);
    assert.equal(studio.state.documents.length, 1);
  } finally { cleanup(); }
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
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) press({ [modifier]: true });
    press({ isComposing: true, code: undefined });
    assert.equal(studio.state.playing, false);
  } finally { cleanup(); }
});

const longChart = chart.replace('1000,\n2000,', '1000,\n'.repeat(10).trimEnd());

test('automatic zoom packs sixteenth notes within ten percent of their rendered diameter across workspace sizes and tempos', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    assert.equal(studio.controls.view, 'auto');
    let radius, stroke;
    const brush = new Proxy({}, {
      get: (_, key) => key === 'arc' ? (x, y, value) => { radius = value; } : () => {},
      set: (_, key, value) => { if (key === 'lineWidth') stroke = value; return true; }
    });
    for (const note of ['1', '2']) {
      drawNote(brush, note, 0, 0);
      const diameter = 2 * radius + stroke;
      for (const bpm of [60, 120, 240]) {
        await studio.openChart(file(`auto-${note}-${bpm}.tja`, chart.replace('BPM:120', `BPM:${bpm}`).replace('1000,\n2000,', `${note.repeat(16)},\n#BPMCHANGE ${bpm * 2}\n${note.repeat(16)},`)));
        for (const width of [240, 305, 619, 980, 1600]) {
          studio.timelineWidth.value = width;
          near(studio.viewBeats.value, width / 72);
          for (const bar of studio.state.chart.bars) {
            const first = studio.timelineScale.value.beatAt(bar.start);
            const second = studio.timelineScale.value.beatAt(bar.start + bar.duration / 16);
            const spacing = (second - first) / studio.viewBeats.value * width;
            const overlap = (diameter - spacing) / diameter;
            assert.ok(overlap <= .1 + 1e-10);
            near(overlap, .1);
          }
        }
      }
    }
    studio.controls.view = 1.25; near(studio.viewBeats.value, 5);
    studio.timelineWidth.value = 305; near(studio.viewBeats.value, 5);
    studio.controls.view = 'auto'; near(studio.viewBeats.value, 305 / 72);
    assert.equal(studio.state.playing, false); assert.equal(studio.state.undo.length, 0);
  } finally { cleanup(); }
});

test('beat-based views show equally spaced measures across BPM changes and preserve the musical viewport through edits and history', async () => {
  const { studio, cleanup } = mountStudio();
  try {
    const source = chart.replace('BPM:120', 'BPM:100').replace('1000,\n2000,', '1111,\n1111,\n#BPMCHANGE 200\n1111,\n1111,');
    await studio.openChart(file('tempo-layout.tja', source));
    near(studio.visible.value.start, 0); near(studio.visible.value.end, 4.8);
    assert.equal(studio.viewBeats.value, 8);
    studio.panTimeline(4.8);
    near(studio.visible.value.startBeat, 8); near(studio.visible.value.endBeat, 16);
    near(studio.visible.value.start, 4.8); near(studio.visible.value.end, 7.2);
    studio.setBpm(200);
    near(studio.visible.value.startBeat, 8); near(studio.visible.value.start, 2.4);
    studio.history(); near(studio.visible.value.startBeat, 8); near(studio.visible.value.start, 4.8);
    studio.history(true); near(studio.visible.value.startBeat, 8); near(studio.visible.value.start, 2.4);
    studio.controls.view = .5;
    near(studio.visible.value.endBeat - studio.visible.value.startBeat, 2);
  } finally { cleanup(); }
});

test('playback pages advance after the same beat count at different BPM without changing audio timing', async () => {
  const { studio, mock, ticks, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  try {
    await studio.openChart(file('tempo-pages.tja', chart.replace('BPM:120', 'BPM:100').replace('1000,\n2000,', '1111,\n1111,\n#BPMCHANGE 200\n1111,\n1111,\n1111,\n1111,')));
    await nextTick(); await studio.play();
    context.currentTime = 4.734; ticks.frame(); near(studio.visible.value.startBeat, 0);
    context.currentTime = 4.835; ticks.frame(); near(studio.visible.value.startBeat, 8); near(studio.state.position, 4.8);
    context.currentTime = 7.235; ticks.frame(); near(studio.visible.value.startBeat, 16); near(studio.state.position, 7.2);
    assert.equal(studio.state.playing, true);
  } finally { cleanup(); }
});

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
    await studio.openChart(file('long.tja', longChart)); await nextTick();
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
    await studio.openChart(file('long.tja', longChart)); studio.setLoop(2, 5, true); await studio.play();
    context.currentTime = 2.535; ticks.frame(); near(studio.visible.value.start, 4);
    context.currentTime = 4.035; ticks.frame(); near(studio.visible.value.start, 4);
    context.currentTime = 8.535; ticks.frame(); near(studio.visible.value.start, 0);
    assert.deepEqual(studio.range.value, [2, 5]); assert.equal(studio.state.playing, true);
    studio.pause(); studio.panTimeline(10.2);
    studio.select(1); near(studio.visible.value.start, 2); assert.equal(studio.state.followPlayback, false);
    studio.panTimeline(8.5); studio.setLoop(3, 4); near(studio.visible.value.start, 8.5);
  } finally { cleanup(); }
});

test('arrows pan by one eighth of the beat viewport without moving selection or interrupting playback', async () => {
  const { studio, handlers, mock, ticks, cleanup } = mountStudio();
  const { context } = fakeAudio(mock);
  let now = 0;
  const press = (key, repeat = false) => handlers.get('keydown')({ key, repeat, preventDefault() {} });
  try {
    mock('performance', { now: () => now });
    await studio.openChart(file('pan-keys.tja', longChart.replace('1000,\n1000,', '1000,\n#BPMCHANGE 240\n1000,')));
    studio.selectCell({ bar: 0, numerator: 1, denominator: 16, divisions: 16 });
    const point = { ...studio.state.selectedCell }, command = { ...studio.state.commandCell }, text = studio.state.text;
    press('ArrowRight'); press('ArrowRight', true); press('ArrowRight', true);
    now = 90; ticks.frame(now);
    assert.ok(studio.visible.value.startBeat > 0 && studio.visible.value.startBeat < 3);
    now = 200; ticks.frame(now); near(studio.visible.value.startBeat, 3);
    assert.deepEqual(studio.state.selectedCell, point); assert.deepEqual(studio.state.commandCell, command);
    assert.equal(studio.state.position, 0); assert.equal(studio.state.followPlayback, false);
    mock('matchMedia', () => ({ matches: true }));
    for (let index = 0; index < 20; index++) press('ArrowLeft', true);
    near(studio.visible.value.startBeat, 0);
    for (let index = 0; index < 50; index++) press('ArrowRight', true);
    near(studio.visible.value.endBeat, studio.timelineScale.value.beatAt(studio.timelineBounds.value.end));
    studio.panTimeline(0); studio.controls.view = .25;
    press('ArrowRight'); near(studio.visible.value.startBeat, studio.viewBeats.value / 8);
    await studio.play(0);
    const position = studio.state.position;
    press('ArrowRight');
    assert.equal(studio.state.playing, true); assert.equal(studio.state.followPlayback, false);
    assert.equal(studio.state.position, position); assert.deepEqual(studio.state.selectedCell, point);
    context.currentTime = .535; ticks.frame(now + 20); assert.ok(studio.state.position > position);
    assert.equal(studio.state.text, text); assert.equal(studio.state.undo.length, 0);
  } finally { cleanup(); }
});

test('W/S steps through shared snap presets and custom boundaries without changing notes, selection or playback', async () => {
  const { studio, handlers, mock, cleanup } = mountStudio();
  fakeAudio(mock);
  const press = (key, repeat = false) => handlers.get('keydown')({ key, repeat, preventDefault() {} });
  try {
    handlers.get('keydown')({ key: 'w', preventDefault() { assert.fail('No chart must not capture W'); } });
    await studio.openChart(file());
    studio.selectCell({ bar: 0, numerator: 1, denominator: 16, divisions: 16 });
    const point = { ...studio.state.selectedCell }, text = studio.state.text;
    press('w'); assert.equal(studio.controls.snap, 24); assert.equal(studio.controls.snapChoice, '24');
    press('W', true); assert.equal(studio.controls.snap, 32);
    press('s'); assert.equal(studio.controls.snap, 24);
    press('S', true); assert.equal(studio.controls.snap, 16);
    studio.setSnap(7); studio.controls.snapChoice = 'custom';
    press('w'); assert.equal(studio.controls.snap, 8); assert.equal(studio.controls.snapChoice, '8');
    studio.setSnap(7); press('s'); assert.equal(studio.controls.snap, 4);
    press('s'); assert.equal(studio.controls.snap, 1); assert.equal(studio.controls.snapChoice, 'custom');
    press('s', true); assert.equal(studio.controls.snap, 1);
    studio.setSnap(200); press('w'); assert.equal(studio.controls.snap, 768);
    assert.equal(studio.controls.snapChoice, 'custom'); assert.equal(studio.controls.customSnap, 768);
    press('w', true); assert.equal(studio.controls.snap, 768);
    press('s'); assert.equal(studio.controls.snap, 192); assert.equal(studio.controls.snapChoice, '192');
    await studio.play();
    press('s'); assert.equal(studio.controls.snap, 96); assert.equal(studio.state.playing, true);
    assert.deepEqual(studio.state.selectedCell, point);
    assert.equal(studio.state.text, text); assert.equal(studio.state.undo.length, 0); assert.equal(studio.state.dirty, false);
  } finally { cleanup(); }
});

test('A and D move by the snap grid, repeat, cross measures and stop at chart boundaries', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const press = (key, repeat = false) => handlers.get('keydown')({ key, repeat, preventDefault() {} });
  try {
    await studio.openChart(file());
    studio.setSnap(4);
    const original = studio.state.text;
    press('d');
    assert.equal(studio.cell.value.bar, 0); assert.equal(studio.cell.value.numerator, 0);
    press('D', true);
    assert.equal(studio.cell.value.numerator, 1); assert.equal(studio.cell.value.denominator, 4);
    studio.selectCell({ bar: 0, numerator: 3, denominator: 4, divisions: 4 });
    press('d');
    assert.equal(studio.cell.value.bar, 1); assert.equal(studio.cell.value.numerator, 0);
    assert.equal(studio.state.selected, 1); assert.equal(studio.state.source.trim(), '2000,');
    press('a');
    assert.equal(studio.cell.value.bar, 0); assert.equal(studio.cell.value.numerator, 3);
    studio.selectCell({ bar: 0, numerator: 0, denominator: 4, divisions: 4 });
    press('A');
    assert.equal(studio.cell.value.bar, 0); assert.equal(studio.cell.value.numerator, 0);
    studio.selectCell({ bar: 1, numerator: 3, denominator: 4, divisions: 4 });
    press('d');
    assert.equal(studio.cell.value.bar, 1); assert.equal(studio.cell.value.numerator, 3);
    assert.equal(studio.state.text, original); assert.equal(studio.state.undo.length, 0);
    assert.equal(studio.state.dirty, false); assert.equal(studio.state.position, 0);
  } finally { cleanup(); }
});

test('A/D navigation moves off-grid positions to the nearest snap in the requested direction', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const press = key => handlers.get('keydown')({ key, preventDefault() {} });
  try {
    await studio.openChart(file());
    studio.selectCell({ bar: 0, numerator: 1, denominator: 24, divisions: 16 });
    press('d');
    assert.equal(studio.cell.value.numerator, 1); assert.equal(studio.cell.value.denominator, 16);
    studio.selectCell({ bar: 0, numerator: 1, denominator: 24, divisions: 16 });
    press('a');
    assert.equal(studio.cell.value.numerator, 0);
    studio.setSnap(7); studio.selectCell({ bar: 0, numerator: 3, denominator: 7, divisions: 7 });
    press('d');
    assert.equal(studio.cell.value.numerator, 4); assert.equal(studio.cell.value.denominator, 7);
    press('a'); assert.equal(studio.cell.value.numerator, 3);
    studio.setSnap(32); press('d');
    assert.equal(studio.cell.value.numerator, 14); assert.equal(studio.cell.value.denominator, 32);
    assert.equal(studio.state.undo.length, 0); assert.equal(studio.state.dirty, false);
  } finally { cleanup(); }
});

test('A/D navigation reveals the selected cell and pauses playback without changing custom loop or text', async () => {
  const { studio, handlers, mock, ticks, cleanup } = mountStudio();
  fakeAudio(mock);
  const press = key => handlers.get('keydown')({ key, preventDefault() {} });
  try {
    await studio.openChart(file('long.tja', longChart));
    studio.controls.view = .25; studio.setLoop(1, 2);
    studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 });
    const original = studio.state.text;
    await studio.play();
    press('d');
    assert.equal(studio.state.playing, false);
    assert.equal(studio.cell.value.numerator, 1);
    press('d'); press('d');
    near(studio.visible.value.start, 0);
    press('d');
    near(studio.visible.value.start, 0);
    ticks.frame(performance.now() + 200);
    near(studio.cell.value.time, .5); near(studio.visible.value.start, .375);
    for (let index = 0; index < 4; index++) press('a');
    ticks.frame(performance.now() + 200);
    near(studio.cell.value.time, 0); near(studio.visible.value.start, 0);
    assert.deepEqual(studio.range.value, [1, 2]);
    assert.equal(studio.state.text, original); assert.equal(studio.state.undo.length, 0);
  } finally { cleanup(); }
});

test('navigation and snap shortcuts preserve native inputs, modifiers, dialogs and invalid source', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const native = overrides => handlers.get('keydown')({ preventDefault() { assert.fail('Native action must be preserved'); }, ...overrides });
  try {
    await studio.openChart(file()); studio.selectCell({ bar: 0, numerator: 2, denominator: 16, divisions: 16 });
    for (const activeElement of [
      ...['INPUT', 'TEXTAREA', 'SELECT'].map(tagName => ({ tagName })),
      { tagName: 'DIV', isContentEditable: true },
      { tagName: 'BUTTON', closest: () => ({}) }
    ]) {
      document.activeElement = activeElement;
      for (const key of ['ArrowLeft', 'ArrowRight', 'a', 'd', 'w', 's']) native({ key });
    }
    document.activeElement = null;
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) {
      for (const key of ['ArrowLeft', 'ArrowRight', 'a', 'd', 'w', 's']) {
        if (['s', 'a'].includes(key) && ['ctrlKey', 'metaKey'].includes(modifier)) continue;
        native({ key, [modifier]: true });
      }
    }
    assert.equal(studio.cell.value.numerator, 2);
    studio.editSource('unfinished');
    handlers.get('keydown')({ key: 'd', preventDefault() {} });
    assert.equal(studio.state.source, 'unfinished'); assert.equal(studio.state.invalid, true);
    assert.equal(studio.state.selectedCell, null); assert.equal(studio.state.undo.length, 0);
  } finally { cleanup(); }
});

test('A/D selects every intervening off-grid note before the next grid in both directions', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const press = key => handlers.get('keydown')({ key, preventDefault() {} });
  try {
    const notes = Array(48).fill('0');
    notes[1] = '1'; notes[2] = '2'; notes[3] = '3'; notes[5] = '4';
    await studio.openChart(file('off-grid.tja', chart.replace('1000,\n2000,', `${notes.join('')},\n0000,`)));
    const original = studio.state.text;
    studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 });
    for (const [numerator, denominator, note] of [[1, 48, '1'], [2, 48, '2'], [1, 16, '3'], [5, 48, '4'], [2, 16, '0']]) {
      press('d');
      assert.equal(studio.cell.value.numerator, numerator); assert.equal(studio.cell.value.denominator, denominator);
      assert.equal(studio.cell.value.note, note);
    }
    for (const [numerator, denominator] of [[5, 48], [1, 16], [2, 48], [1, 48], [0, 16]]) {
      press('a');
      assert.equal(studio.cell.value.numerator, numerator); assert.equal(studio.cell.value.denominator, denominator);
    }
    assert.equal(studio.state.text, original); assert.equal(studio.state.undo.length, 0);
    press('d'); press('d');
    studio.chooseNote('7');
    assert.equal(studio.state.chart.bars[0].notes[2], '7');
    assert.equal(studio.state.chart.bars[0].notes[3], '3');
  } finally { cleanup(); }
});

test('A/D prioritizes trailing notes across measures and at the final chart boundary', async () => {
  const { studio, handlers, cleanup } = mountStudio();
  const press = key => handlers.get('keydown')({ key, preventDefault() {} });
  try {
    const notes = Array(48).fill('0'); notes[46] = '1'; notes[47] = '2';
    await studio.openChart(file('trailing.tja', chart.replace('1000,\n2000,', `${notes.join('')},\n${notes.join('')},`)));
    studio.selectCell({ bar: 0, numerator: 15, denominator: 16, divisions: 16 });
    press('d'); assert.equal(studio.cell.value.numerator, 46); assert.equal(studio.cell.value.denominator, 48);
    press('d'); assert.equal(studio.cell.value.numerator, 47);
    press('d'); assert.equal(studio.cell.value.bar, 1); assert.equal(studio.cell.value.numerator, 0);
    press('a'); assert.equal(studio.cell.value.bar, 0); assert.equal(studio.cell.value.numerator, 47);
    press('a'); assert.equal(studio.cell.value.numerator, 46);
    press('a'); assert.equal(studio.cell.value.numerator, 15); assert.equal(studio.cell.value.denominator, 16);
    studio.selectCell({ bar: 1, numerator: 15, denominator: 16, divisions: 16 });
    press('d'); assert.equal(studio.cell.value.numerator, 46);
    press('d'); assert.equal(studio.cell.value.numerator, 47);
    press('d'); assert.equal(studio.cell.value.numerator, 47); assert.equal(studio.cell.value.bar, 1);
    assert.equal(studio.state.undo.length, 0); assert.equal(studio.state.dirty, false);
  } finally { cleanup(); }
});

test('keyboard reveal animates between frames, coalesces repeated moves and cancels on manual pan or tab switch', async () => {
  const { studio, handlers, mock, ticks, cleanup } = mountStudio();
  let now = 0;
  const frame = elapsed => { now += elapsed; ticks.frame(now); };
  const right = () => handlers.get('keydown')({ key: 'd', preventDefault() {} });
  try {
    mock('performance', { now: () => now });
    await studio.openChart(file('long.tja', longChart)); const first = studio.state.activeId;
    studio.controls.view = .25;
    studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 });
    for (let index = 0; index < 8; index++) right();
    near(studio.visible.value.start, 0);
    frame(90);
    assert.ok(studio.visible.value.start > 0 && studio.visible.value.start < .75);
    frame(90); near(studio.visible.value.start, .75);
    for (let index = 0; index < 4; index++) right();
    frame(45);
    studio.panTimeline(.7); frame(200); near(studio.visible.value.start, .7);
    right(); frame(45);
    await studio.openChart(file('second.tja', longChart));
    frame(200); near(studio.visible.value.start, 0);
    studio.switchChart(first);
    const start = studio.visible.value.start;
    frame(200); near(studio.visible.value.start, start);
    assert.equal(studio.state.undo.length, 0);
  } finally { cleanup(); }
});

test('reduced motion reveals instantly and starting playback cancels pending keyboard motion', async () => {
  const { studio, handlers, mock, ticks, cleanup } = mountStudio();
  fakeAudio(mock);
  const right = () => handlers.get('keydown')({ key: 'd', preventDefault() {} });
  try {
    await studio.openChart(file('long.tja', longChart));
    studio.controls.view = .25;
    studio.selectCell({ bar: 0, numerator: 0, denominator: 16, divisions: 16 });
    mock('matchMedia', () => ({ matches: true }));
    for (let index = 0; index < 4; index++) right();
    near(studio.visible.value.start, .375);
    mock('matchMedia', () => ({ matches: false }));
    for (let index = 0; index < 4; index++) right();
    await studio.play(0);
    near(studio.visible.value.start, 0);
    ticks.frame(performance.now() + 200);
    near(studio.visible.value.start, 0); assert.equal(studio.state.playing, true);
  } finally { cleanup(); }
});