import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_TYPES, selectCell, cellValue, setCellNote, longNoteSpans } from './note-model.js';
import { TJAParser } from 'tja';
import { parseChart } from './chart.js';

test('note choices use compact names while keeping TJA codes and shape distinctions', () => {
  assert.deepEqual(NOTE_TYPES.filter(type => '5679AB'.includes(type.value)).map(({ value, name }) => [value, name]), [
    ['5', '连打'], ['6', '大连打'], ['7', '气球连打'], ['9', '特殊连打'], ['A', '双人咚'], ['B', '双人咔']
  ]);
  assert.equal(NOTE_TYPES.find(type => type.value === '6').shape, 'roll large');
  assert.equal(NOTE_TYPES.find(type => type.value === '9').shape, 'balloon special');
  assert.deepEqual(NOTE_TYPES.map(type => type.shortcut ?? type.value), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '=']);
});

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
test('cooperative notes participate in exact selection and off-grid editing', () => {
  assert.deepEqual(NOTE_TYPES.slice(-2).map(type => type.value), ['A', 'B']);
  const edited = setCellNote('A0B0', { numerator: 1, denominator: 3 }, 'A');
  assert.equal(edited.length, 12);
  assert.equal(edited[0], 'A'); assert.equal(edited[4], 'A'); assert.equal(edited[6], 'B');
  assert.deepEqual(selectCell(edited, .5, 16, .01), { numerator: 6, denominator: 12 });
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