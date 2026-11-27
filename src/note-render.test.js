import test from 'node:test';
import assert from 'node:assert/strict';
import { drawLongSpan, drawNote, drawNoteSelection, noteHitRadius } from './note-render.js';

function recorder() {
  const calls = [], styles = [];
  const brush = new Proxy({}, {
    get: (target,name) => (...args) => calls.push([name,...args]),
    set: (target,name,value) => { styles.push([name,value]); return true; }
  });
  return { calls, styles, brush };
}
test('balloons have bright flat faces, distinct round and rounded-square bodies, and no realistic string', () => {
  const balloon = recorder(), special = recorder();
  drawNote(balloon.brush,'7',20,30); drawNote(special.brush,'9',20,30);
  assert.ok(balloon.calls.some(call => call[0] === 'ellipse'));
  assert.ok(special.calls.some(call => call[0] === 'roundRect' && call[5] === 7));
  for (const [result, color] of [[balloon, '#ff9c35'], [special, '#ff78ae']]) {
    assert.ok(result.styles.some(([key,value]) => key === 'fillStyle' && value === color));
    assert.equal(result.calls.filter(call => call[0] === 'arc' && call[3] === 1.5).length, 2);
    assert.ok(result.calls.some(call => call[0] === 'arc' && call[3] === 4 && call[5] === Math.PI));
    assert.ok(!result.calls.some(call => call[0] === 'bezierCurveTo'));
    assert.ok(!result.calls.some(call => call[0] === 'fillText'));
  }
});
test('balloon hit counts are centered inside the note and survive selection', () => {
  for (const note of ['7', '9']) for (const count of [1, 24, 999, 123456]) {
    for (const selected of [false, true]) {
      const { brush, calls, styles } = recorder();
      if (selected) drawNoteSelection(brush, note, 100, 60, count);
      else drawNote(brush, note, 100, 60, false, count);
      assert.deepEqual(calls.find(call => call[0] === 'fillText'), ['fillText', String(count), 100, 60, 20]);
      assert.ok(styles.some(([name, value]) => name === 'textAlign' && value === 'center'));
      assert.ok(styles.some(([name, value]) => name === 'textBaseline' && value === 'middle'));
      assert.equal(calls.some(call => call[0] === 'arc' && call[3] === 1.5), false);
    }
  }
  for (const count of [undefined, 0, -1, 1.5, NaN, Infinity]) {
    const { brush, calls } = recorder();
    drawNote(brush, '7', 100, 60, false, count);
    assert.equal(calls.some(call => call[0] === 'fillText'), false);
  }
});

test('roll draws a connected capsule while balloon draws a rounded duration guide', () => {
  const roll = recorder(), balloon = recorder();
  const span = {note:'5',start:0,end:3,complete:true};
  drawLongSpan(roll.brush,span,time => time * 10,30,1,4);
  drawLongSpan(balloon.brush,{...span,note:'7'},time => time * 10,30,1,4);
  assert.ok(roll.calls.some(call => call[0] === 'roundRect' && call[1] === 10 && call[3] === 20));
  assert.ok(!balloon.calls.some(call => call[0] === 'roundRect'));
  assert.ok(balloon.styles.some(([key,value]) => key === 'lineCap' && value === 'round'));
});
test('large rolls have a larger round head and a fully rounded thicker body', () => {
  for (const [note,radius,thickness] of [['5',9,13], ['6',13,23]]) {
    const head = recorder(), body = recorder();
    drawNote(head.brush,note,20,30);
    drawLongSpan(body.brush,{note,start:0,end:3,complete:true},time => time * 10,30,0,4);
    assert.ok(head.calls.some(call => call[0] === 'arc' && call[3] === radius));
    assert.ok(body.calls.some(call => call[0] === 'roundRect' && call[4] === thickness && call[5] === thickness / 2));
  }
});
test('rolls round only real endpoints and keep clipped ends flat', () => {
  for (const [note, radius] of [['5', 6.5], ['6', 11.5]]) {
    for (const [start, end, corners] of [
      [2, 8, [0, 0, 0, 0]],
      [0, 8, [radius, 0, 0, radius]],
      [2, 10, [0, radius, radius, 0]],
      [0, 10, radius]
    ]) {
      const { brush, calls } = recorder();
      drawLongSpan(brush, { note, start: 0, end: 10, complete: true }, time => time * 10, 30, start, end);
      const body = calls.find(call => call[0] === 'roundRect');
      assert.deepEqual(body[5], corners, `${note}: ${start}–${end}`);
      assert.equal(body[1], start * 10);
      assert.equal(body[3], (end - start) * 10);
    }
  }
});

test('unfinished spans are dashed and offscreen spans are skipped', () => {
  const unfinished = recorder(), offscreen = recorder();
  drawLongSpan(unfinished.brush,{note:'5',start:0,end:3,complete:false},time => time,30,0,4);
  assert.ok(unfinished.calls.some(call => call[0] === 'setLineDash' && call[1][0] === 6));
  drawLongSpan(offscreen.brush,{note:'5',start:5,end:6,complete:true},time => time,30,0,4);
  assert.equal(offscreen.calls.length,0);
});
test('selection changes the original border without adding an outer ring', () => {
  for (const note of '123456789AB') {
    const selected = recorder(), normal = recorder();
    drawNoteSelection(selected.brush, note, 100, 60);
    drawNote(normal.brush, note, 100, 60);
    assert.ok(!selected.calls.some(call => ['fillRect', 'strokeRect', 'rect'].includes(call[0])));
    const shapes = calls => calls.filter(call => ['arc', 'ellipse', 'roundRect', 'closePath', 'bezierCurveTo'].includes(call[0]));
    assert.deepEqual(shapes(selected.calls), shapes(normal.calls));
    assert.ok(selected.calls.some(call => call[0] === 'moveTo' && call[1] === 100 && call[2] === 23));
    assert.ok(selected.calls.some(call => call[0] === 'lineTo' && call[1] === 100 && call[2] === 60));
  }
});
test('normal and selected notes differ only in border color', () => {
  for (const note of '123456789AB') {
    const normal = [], selected = [];
    const brush = values => new Proxy({}, { get: () => () => {}, set: (target, key, value) => { values.push([key, value]); return true; } });
    drawNote(brush(normal), note, 100, 60);
    drawNote(brush(selected), note, 100, 60, true);
    assert.equal(selected.find(([key]) => key === 'strokeStyle')[1], '#2457d6');
    assert.deepEqual(selected.map(([key, value], index) => [key, key === 'strokeStyle' && value === '#2457d6' ? normal[index][1] : value]), normal);
  }
});
test('empty positions are dashed and large notes use their full visible hit radius', () => {
  const empty = recorder();
  drawNoteSelection(empty.brush, '0', 100, 60);
  assert.ok(empty.calls.some(call => call[0] === 'setLineDash' && call[1].length === 2));
  assert.equal(noteHitRadius('1'), 10);
  for (const note of '346AB') assert.equal(noteHitRadius(note), 14);
  for (const note of '79') assert.equal(noteHitRadius(note), 16);
});
test('cooperative notes render as large notes with a visible 2P mark', () => {
  for (const note of 'AB') {
    const { brush, calls } = recorder();
    drawNote(brush, note, 100, 60);
    assert.ok(calls.some(call => call[0] === 'arc' && call[3] === 13));
    assert.ok(calls.some(call => call[0] === 'fillText' && call[1] === '2P'));
  }
});