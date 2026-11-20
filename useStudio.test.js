import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, nextTick } from 'vue';
import { useStudio } from './useStudio.js';

const chart = 'TITLE:Vue session\nBPM:120\nOFFSET:0\nCOURSE:Oni\nLEVEL:1\n#START\n1000,\n2000,\n#END\n';

test('Vue session preserves editing, command positions, history, drafts and lifecycle cleanup', async () => {
  const saved = new Map(), listeners = new Set(), originals = new Map();
  const mock = (name, value) => { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  const addEventListener = name => listeners.add(name), removeEventListener = name => listeners.delete(name);
  mock('localStorage', { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) });
  mock('window', { addEventListener, removeEventListener });
  mock('document', { addEventListener, removeEventListener, activeElement: null });
  mock('requestAnimationFrame', () => 1); mock('cancelAnimationFrame', () => {});
  mock('fetch', async url => ({ ok: true, json: async () => ['fixture.tja'], arrayBuffer: async () => new TextEncoder().encode(chart).buffer }));
  mock('confirm', () => true);
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  let studio;
  const app = renderer.createApp({ setup() { studio = useStudio(); return () => null; } });
  try {
    app.mount({});
    await new Promise(resolve => setImmediate(resolve));
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
    assert.equal(JSON.parse(saved.get('tja-wave-draft')).text, edited);
    studio.history(); assert.notEqual(studio.state.text, edited);
    studio.history(true); assert.equal(studio.state.text, edited);
    studio.select(1); assert.equal(studio.state.selectedCell, null); assert.equal(studio.command.value.numerator, 0);
    studio.restore(); assert.equal(studio.state.text, edited); assert.equal(studio.state.selected, 0);
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
    assert.equal(studio.visible.value.start, -2);
    assert.equal(studio.visible.value.end, 4);
    studio.controls.view = 1;
    assert.equal(studio.visible.value.start, -2);
    assert.equal(studio.visible.value.end, 1);
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
    app.unmount();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});