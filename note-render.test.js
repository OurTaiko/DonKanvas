import test from 'node:test';
import assert from 'node:assert/strict';
import { drawLongSpan, drawNote, drawNoteSelection, noteHitRadius } from './note-render.js';

function recorder() {
  const calls = [];
  const brush = new Proxy({}, { get: (target,name) => (...args) => calls.push([name,...args]) });
  return { calls, brush };
}
test('balloon is an ellipse with a tied string; roll has a round head', () => {
  const balloon = recorder(), roll = recorder();
  drawNote(balloon.brush,'7',20,30); drawNote(roll.brush,'5',20,30);
  assert.ok(balloon.calls.some(call => call[0] === 'ellipse'));
  assert.ok(balloon.calls.some(call => call[0] === 'bezierCurveTo'));
  assert.ok(roll.calls.some(call => call[0] === 'arc'));
  assert.ok(!roll.calls.some(call => call[0] === 'ellipse'));
});
test('roll draws a connected bar while balloon draws a string', () => {
  const roll = recorder(), balloon = recorder();
  const span = {note:'5',start:0,end:3,complete:true};
  drawLongSpan(roll.brush,span,time => time * 10,30,1,4);
  drawLongSpan(balloon.brush,{...span,note:'7'},time => time * 10,30,1,4);
  assert.ok(roll.calls.some(call => call[0] === 'roundRect' && call[1] === 10 && call[3] === 20));
  assert.ok(!balloon.calls.some(call => call[0] === 'roundRect'));
});
test('unfinished spans are dashed and offscreen spans are skipped', () => {
  const unfinished = recorder(), offscreen = recorder();
  drawLongSpan(unfinished.brush,{note:'5',start:0,end:3,complete:false},time => time,30,0,4);
  assert.ok(unfinished.calls.some(call => call[0] === 'setLineDash' && call[1][0] === 6));
  drawLongSpan(offscreen.brush,{note:'5',start:5,end:6,complete:true},time => time,30,0,4);
  assert.equal(offscreen.calls.length,0);
});
test('selection changes the original border without adding an outer ring', () => {
  for (const note of '123456789') {
    const selected = recorder(), normal = recorder();
    drawNoteSelection(selected.brush, note, 100, 60);
    drawNote(normal.brush, note, 100, 60);
    assert.ok(!selected.calls.some(call => ['fillRect', 'strokeRect', 'rect'].includes(call[0])));
    const shapes = calls => calls.filter(call => ['arc', 'ellipse', 'closePath', 'bezierCurveTo'].includes(call[0]));
    assert.deepEqual(shapes(selected.calls), shapes(normal.calls));
    assert.ok(selected.calls.some(call => call[0] === 'moveTo' && call[1] === 100 && call[2] === 23));
    assert.ok(selected.calls.some(call => call[0] === 'lineTo' && call[1] === 100 && call[2] === 60));
  }
});
test('normal and selected notes differ only in border color', () => {
  for (const note of '123456789') {
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
  for (const note of '346') assert.equal(noteHitRadius(note), 14);
  for (const note of '79') assert.equal(noteHitRadius(note), 13);
});