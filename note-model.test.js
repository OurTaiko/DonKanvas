import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_TYPES, selectCell, cellValue, setCellNote, longNoteSpans } from './note-model.js';
import { TJAParser } from 'tja';
import { parseChart } from './chart.js';

test('selecting a cell does not change source and reports its current note', () => {
  const notes = '1020';
  const cell = selectCell(notes, .25, 16);
  assert.deepEqual(cell, { numerator: 4, denominator: 16 });
  assert.equal(cellValue(notes, cell), '0');
  assert.equal(notes, '1020');
});
test('choosing a note edits only the selected fraction and preserves off-grid notes', () => {
  const notes = '01' + '0'.repeat(22), cell = selectCell(notes,1/7,7);
  const edited = setCellNote(notes,cell,'7');
  assert.equal(edited.length,168); assert.equal(edited[7],'1'); assert.equal(edited[24],'7');
  assert.equal(cellValue(edited,cell),'7');
  assert.equal(cellValue(setCellNote(edited,cell,'0'),cell),'0');
});
test('existing dense-source note retains its exact fraction', () => {
  const notes = '01' + '0'.repeat(2326);
  const cell = selectCell(notes,1/2328,24,.0001);
  assert.deepEqual(cell,{numerator:1,denominator:2328});
  const edited = setCellNote(notes,cell,'5');
  assert.equal(edited.length,2328); assert.equal(edited[1],'5');
});
test('rolls and balloons have different visual types', () => {
  assert.equal(NOTE_TYPES[5].shape,'roll'); assert.equal(NOTE_TYPES[7].shape,'balloon');
  assert.equal(NOTE_TYPES[8].shape,'end');
});
test('long notes connect across bar boundaries and distinguish unfinished spans', () => {
  const bars = [{notes:'5000',start:0,duration:2,end:2},{notes:'0087',start:2,duration:2,end:4}];
  assert.deepEqual(longNoteSpans(bars),[
    {note:'5',start:0,end:3,complete:true},
    {note:'7',start:3.5,end:4,complete:false}
  ]);
});
test('long note spans follow intrabar tempo and delays rather than a uniform measure', () => {
  const chart = parseChart('TITLE:Test\nBPM:120\n#START\n50\n#BPMCHANGE 60\n#DELAY .5\n80,\n#END', TJAParser);
  assert.deepEqual(longNoteSpans(chart.bars), [{ note: '5', start: 0, end: 1.5, complete: true }]);
});