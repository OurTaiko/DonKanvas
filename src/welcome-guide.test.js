import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { computed, ref, watch } from 'vue';
import { parse } from 'vue/compiler-sfc';
import { translations } from './locales.js';
import { NOTE_TYPES } from './note-model.js';

function guide(storage) {
  const { descriptor } = parse(readFileSync(new URL('WelcomeGuide.vue', import.meta.url), 'utf8'));
  const script = descriptor.scriptSetup.content.replace(/^import .*;\n/gm, '').replace('defineExpose({ open });', '');
  let mounted;
  const model = runInNewContext(`${script}\n({ dialog, device, step, steps, phase, moveFrame, demo, miniNotes, open, close, remember, previous, next })`, {
    computed, ref, watch, NOTE_TYPES, setInterval() { return 1; }, clearInterval() {}, onUnmounted() {}, localStorage: storage, onMounted(callback) { mounted = callback; }
  });
  model.dialog.value = { open: false, showModal() { this.open = true; }, close() { this.open = false; model.remember(); } };
  return { ...model, mounted };
}

test('guide opens once, selects a device, navigates and can be reopened', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const model = guide(storage);
  model.mounted();
  assert.equal(model.dialog.value.open, true);
  assert.equal(model.device.value, '');
  model.device.value = 'touch';
  assert.equal(model.steps.value.length, 8);
  model.next();
  assert.equal(model.step.value, 1);
  model.previous(); model.previous();
  assert.equal(model.device.value, '');
  model.device.value = 'desktop';
  for (let index = 0; index < model.steps.value.length; index++) model.next();
  assert.equal(model.dialog.value.open, false);
  assert.equal(values.get('donkanvas-welcome-guide-seen'), '1');
  const returning = guide(storage);
  returning.mounted();
  assert.equal(returning.dialog.value.open, false);
  returning.open();
  assert.equal(returning.dialog.value.open, true);
  assert.equal(returning.device.value, '');
  assert.equal(returning.step.value, 0);
});

test('guide still opens when storage is unavailable and lesson text is localized', () => {
  const model = guide({ getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); } });
  model.mounted();
  assert.equal(model.dialog.value.open, true);
  for (const device of ['touch', 'desktop']) {
    model.device.value = device;
    for (const item of model.steps.value) for (const text of [item.title, item.description, item.hint]) {
      if (text === 'Ctrl+Alt+N / Ctrl+O') continue;
      assert.equal(translations[text]?.length, 4, `Missing translations for ${text}`);
    }
  }
  assert.doesNotThrow(() => model.close());
});

test('key demonstrations change selection, grid, seeking and playback independently', () => {
  const model = guide({ getItem: () => '1' });
  model.device.value = 'desktop';
  function scene(name, phase) {
    model.step.value = model.steps.value.findIndex(item => item.scene === name);
    model.phase.value = phase;
    return model.demo.value;
  }
  assert.equal(scene('position', 1).key, 'A');
  assert.equal(scene('position', 1).selection, 25);
  assert.equal(scene('position', 4).key, 'D');
  assert.equal(scene('position', 4).selection, 37.5);
  assert.equal(scene('snap', 1).key, 'W');
  assert.equal(scene('snap', 1).divisions, 12);
  assert.equal(scene('snap', 4).key, 'S');
  assert.equal(scene('snap', 4).divisions, 8);
  assert.equal(scene('seek', 1).key, 'Q');
  assert.equal(scene('seek', 1).playhead, 100 / 3);
  assert.equal(scene('seek', 4).key, 'E');
  assert.equal(scene('seek', 4).playhead, 50);
  assert.equal(scene('seek', 1).selection, scene('seek', 4).selection);
  assert.equal(scene('play', 1).key, 'Space');
  assert.equal(scene('play', 1).playing, true);
  assert.equal(scene('play', 4).playing, false);
  assert.equal(scene('play', 4).playhead, scene('play', 5).playhead);
});

test('touch demonstrations show adjustment overlay, gray edges and hold-to-play progression', () => {
  const model = guide({ getItem: () => '1' });
  model.device.value = 'touch';
  function scene(name, phase) {
    model.step.value = model.steps.value.findIndex(item => item.scene === name);
    model.phase.value = phase;
    return model.demo.value;
  }
  assert.equal(scene('move', 0).adjusting, false);
  model.moveFrame.value = 16;
  assert.equal(model.demo.value.adjusting, true);
  assert.notEqual(scene('gutter', 1).playhead, scene('gutter', 4).playhead);
  assert.equal(scene('hold', 0).holding, true);
  assert.equal(scene('hold', 0).playing, false);
  assert.equal(scene('hold', 1).holding, false);
  assert.equal(scene('hold', 1).playing, true);
  assert.equal(scene('hold', 2).holding, false);
  assert.equal(scene('hold', 2).playing, true);
  assert.ok(scene('hold', 3).playhead > scene('hold', 2).playhead);
  const { descriptor } = parse(readFileSync(new URL('WelcomeGuide.vue', import.meta.url), 'utf8'));
  assert.match(descriptor.template.content, /v-if="demo.adjusting" class="mock-adjustment"><ChevronsLeft \/><ChevronsRight \/>/);
  assert.match(descriptor.styles.map(item => item.content).join('\n'), /\.mock-adjustment\{[^}]*background:#0006/);
  assert.match(descriptor.styles.map(item => item.content).join('\n'), /\.scene-move \.mock-selection\{transform:translateX\(-50%\);transition:none\}/);
});

test('touch distance advances selection only at 24px thresholds, stopping at grid lines and notes', () => {
  const model = guide({ getItem: () => '1' });
  model.device.value = 'touch';
  model.step.value = model.steps.value.findIndex(item => item.scene === 'move');
  function frame(index) { model.moveFrame.value = index; return model.demo.value; }
  assert.equal(frame(16).divisions, 32);
  assert.equal(frame(27).pointerOffset, 22);
  assert.equal(frame(27).selection, 37.5);
  assert.equal(frame(28).pointerOffset, 24);
  assert.equal(frame(28).selection, 39.0625);
  assert.ok(frame(28).notes.includes(frame(28).selection));
  assert.notEqual(frame(28).selection % (100 / 32), 0);
  assert.equal(frame(39).selection, 39.0625);
  assert.equal(frame(39).pointerOffset, 46);
  assert.equal(frame(40).selection, 40.625);
  assert.equal(frame(40).selection % (100 / 32), 0);
  assert.equal(frame(64).selection, 46.875);
  assert.equal(frame(75).selection, 46.875);
  assert.equal(frame(76).selection, 43.75);
  assert.equal(frame(100).selection, 39.0625);
  assert.equal(frame(112).selection, 37.5);
  assert.equal(frame(112).pointerOffset, 0);
  assert.equal(frame(112).adjusting, false);
});

test('guide labels the measure strip as global navigation without overlaying shortcut hints', () => {
  const { descriptor } = parse(readFileSync(new URL('WelcomeGuide.vue', import.meta.url), 'utf8'));
  assert.match(descriptor.template.content, /class="mock-navigation"><span class="mock-navigation-label">\{\{ t\('全局导航'\) \}\}<\/span><i v-for/);
  assert.equal(translations['全局导航'].length, 4);
  assert.match(descriptor.styles.map(item => item.content).join('\n'), /\.guide-key\{position:static;width:fit-content;max-width:100%/);
});

test('gray edge arrows appear only during the matching demonstration press', () => {
  const model = guide({ getItem: () => '1' });
  model.device.value = 'touch';
  for (let step = 0; step < model.steps.value.length; step++) {
    model.step.value = step;
    for (let phase = 0; phase < 8; phase++) {
      model.phase.value = phase;
      const expected = model.steps.value[step].scene === 'gutter'
        ? (phase % 2 === 1 ? ['wave-left', 'wave-right', 'note-left', 'note-right'][Math.floor(phase / 2)] : '') : '';
      assert.equal(model.demo.value.pressedGutter, expected);
    }
  }
  const { descriptor } = parse(readFileSync(new URL('WelcomeGuide.vue', import.meta.url), 'utf8'));
  for (const edge of ['wave-left', 'wave-right', 'note-left', 'note-right']) {
    assert.ok(descriptor.template.content.includes(`v-if="demo.pressedGutter === '${edge}'"`));
  }
});

test('gray edge demo distinguishes both waveform jumps from both note selection reveals', () => {
  const model = guide({ getItem: () => '1' });
  model.device.value = 'touch';
  model.step.value = model.steps.value.findIndex(item => item.scene === 'gutter');
  const frames = Array.from({ length: 8 }, (_, phase) => { model.phase.value = phase; return model.demo.value; });
  for (const [phase, target] of [[1, 'wave-left'], [3, 'wave-right'], [5, 'note-left'], [7, 'note-right']]) {
    assert.equal(frames[phase].pointerTarget, target);
    assert.equal(frames[phase].pressedGutter, target);
    assert.notEqual(frames[phase].panOffset, frames[phase - 1].panOffset);
    if (target.startsWith('wave')) {
      assert.equal(frames[phase].selection, frames[phase - 1].selection);
      assert.equal(frames[phase].playhead - frames[phase - 1].playhead, phase === 1 ? -25 : 25);
    } else {
      assert.equal(frames[phase].playhead, frames[phase - 1].playhead);
      assert.equal(frames[phase].overviewPlayhead, frames[phase - 1].overviewPlayhead);
      assert.notEqual(frames[phase].selection, frames[phase - 1].selection);
      assert.equal(frames[phase].selection - frames[phase].panOffset, 25);
    }
  }
});

test('note lesson lists all shortcuts but demonstrates only 1, Backspace, 4 and 0', () => {
  const model = guide({ getItem: () => '1' });
  model.device.value = 'desktop';
  model.step.value = model.steps.value.findIndex(item => item.scene === 'note');
  function frame(index) { model.phase.value = index; return model.demo.value; }
  assert.equal(frame(0).noteSelected, false);
  assert.equal(frame(0).noteValue, '0');
  assert.equal(frame(1).pointer, 37.5);
  assert.equal(frame(1).pressed, false);
  assert.equal(frame(1).noteSelected, false);
  assert.equal(frame(2).pressed, true);
  assert.equal(frame(2).noteSelected, true);
  for (const [phase, key, value] of [[3, '1', '1'], [4, 'Backspace', '0'], [5, '4', '4'], [6, '0', '0']]) {
    assert.equal(frame(phase).key, key);
    assert.equal(frame(phase).noteValue, value);
  }
  assert.equal(frame(7).key, '');
  assert.equal(frame(7).noteValue, '0');
  assert.deepEqual(Array.from(model.steps.value[model.step.value].keys), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace', 'Delete']);
});

test('touch palette follows the overview, lists every note type and keeps presses on the selected type', () => {
  const { descriptor } = parse(readFileSync(new URL('WelcomeGuide.vue', import.meta.url), 'utf8'));
  const template = descriptor.template.content;
  assert.ok(template.indexOf('class="mock-palette"') > template.indexOf('class="mock-overview-section"'));
  assert.ok(template.indexOf('class="mock-palette"') < template.indexOf('class="mock-navigation"'));
  assert.match(template, /v-for="type in NOTE_TYPES"/);
  assert.match(template, /:data-note="type.value"/);
  for (const type of NOTE_TYPES) assert.equal(translations[type.name]?.length, 4);
  const model = guide({ getItem: () => '1' });
  model.device.value = 'touch';
  model.step.value = model.steps.value.findIndex(item => item.scene === 'note');
  for (const [phase, value] of [[3, '1'], [4, '0'], [5, '4'], [6, '0']]) {
    model.phase.value = phase;
    assert.equal(model.demo.value.pointerTarget, 'palette');
    assert.equal(model.demo.value.pressed, true);
    assert.equal(model.demo.value.noteValue, value);
    assert.ok(NOTE_TYPES.some(type => type.value === value));
  }
});

test('desktop wheel demo pans both ways without changing playback, note selection or chart content', () => {
  const model = guide({ getItem: () => '1' });
  model.device.value = 'touch';
  assert.equal(model.steps.value.some(item => item.scene === 'wheel'), false);
  model.device.value = 'desktop';
  model.step.value = model.steps.value.findIndex(item => item.scene === 'wheel');
  const initial = model.demo.value;
  const frames = Array.from({ length: 8 }, (_, phase) => { model.phase.value = phase; return model.demo.value; });
  for (const [phase, direction] of [[1, 'forward'], [2, 'forward'], [4, 'backward'], [5, 'backward']]) {
    const frame = frames[phase], previous = frames[phase - 1];
    assert.equal(frame.wheelDirection, direction);
    assert.equal(Math.sign(frame.panOffset - previous.panOffset), direction === 'forward' ? 1 : -1);
    assert.equal(Math.sign(frame.overviewWindow - previous.overviewWindow), direction === 'forward' ? 1 : -1);
  }
  for (const frame of frames) {
    assert.equal(frame.playhead, initial.playhead);
    assert.equal(frame.overviewPlayhead, initial.overviewPlayhead);
    assert.equal(frame.selection, initial.selection);
    assert.equal(frame.playing, false);
    assert.deepEqual(frame.notes, initial.notes);
    assert.deepEqual(frame.noteTypes, initial.noteTypes);
  }
  assert.equal(frames[7].panOffset, initial.panOffset);
});

test('waveform seek and hold change playback without moving the note selection', () => {
  for (const device of ['desktop', 'touch']) {
    const model = guide({ getItem: () => '1' });
    model.device.value = device;
    model.step.value = model.steps.value.findIndex(item => item.scene === 'wave');
    const selection = model.demo.value.selection;
    model.phase.value = 1;
    assert.equal(model.demo.value.playhead, 30);
    assert.equal(model.demo.value.playhead, model.demo.value.pointer);
    assert.equal(model.demo.value.overviewPlayhead, 8 + 30 * .32);
    assert.equal(model.demo.value.playing, false);
    assert.equal(model.demo.value.pressed, true);
    model.phase.value = 3;
    assert.equal(model.demo.value.playing, true);
    model.phase.value = 4;
    assert.equal(model.demo.value.playhead, 40);
    assert.equal(model.demo.value.selection, selection);
  }
});

test('global waveform drag moves the visible range but preserves playback and note selection', () => {
  for (const device of ['desktop', 'touch']) {
    const model = guide({ getItem: () => '1' });
    model.device.value = device;
    model.step.value = model.steps.value.findIndex(item => item.scene === 'overview');
    assert.equal(model.demo.value.overviewPlayhead, 12);
    model.phase.value = 1;
    assert.equal(model.demo.value.overviewPlayhead, 24);
    assert.equal(model.demo.value.pressed, true);
    const clicked = model.demo.value;
    model.phase.value = 5;
    const dragged = model.demo.value;
    assert.ok(dragged.overviewWindow > clicked.overviewWindow);
    assert.ok(dragged.panOffset > clicked.panOffset);
    assert.equal(dragged.overviewPlayhead, clicked.overviewPlayhead);
    assert.equal(dragged.selection, clicked.selection);
    assert.equal(dragged.playing, false);
  }
});

test('mini notes follow note replacements while viewing and loop selection leave measure backgrounds neutral', () => {
  const model = guide({ getItem: () => '1' });
  model.device.value = 'desktop';
  model.step.value = model.steps.value.findIndex(item => item.scene === 'note');
  assert.equal(model.miniNotes.value[0].length, 3);
  model.phase.value = 5;
  assert.deepEqual(Array.from(model.miniNotes.value[0]), ['1', '4', '1', '2']);
  model.phase.value = 6;
  assert.equal(model.miniNotes.value[0].length, 3);
  const { descriptor } = parse(readFileSync(new URL('WelcomeGuide.vue', import.meta.url), 'utf8'));
  const styles = descriptor.styles.map(item => item.content).join('\n');
  assert.match(styles, /\.mock-measure.in-view \.mock-mini-notes\{background:#e3edf3/);
  assert.match(styles, /\.mock-navigation>\.mock-measure.selected\{box-shadow:inset 0 2px #438d64\}/);
  assert.doesNotMatch(descriptor.template.content, /class="mock-toolbar"|class="mock-measures"/);
});