import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_DIVISIONS, editGridNote } from './grid.js';
test('display grid always has sixteen divisions', () => assert.equal(GRID_DIVISIONS,16));
test('placing a sixteenth preserves twenty-fourth positions', () => {
  const notes = '001' + '0'.repeat(21);
  const edited = editGridNote(notes,1/16,'2');
  assert.equal(edited.length,48);
  assert.equal(edited[3],'2');
  assert.equal(edited[4],'1');
});
test('existing off-grid notes can be edited directly without resampling', () => {
  const notes = '001' + '0'.repeat(21);
  assert.equal(editGridNote(notes,2/24,'2',.01), '002' + '0'.repeat(21));
  assert.equal(editGridNote(notes,2/24,'0',.01), '0'.repeat(24));
});
test('erase on an empty grid position does not change source subdivision', () => {
  assert.equal(editGridNote('0'.repeat(24),1/16,'0'),'0'.repeat(24));
});
for (const divisions of [3,5,7,12,24,32,48,96,192,768]) test(`mouse placement and erase on ${divisions} divisions`, () => {
  const edited = editGridNote('0',1/divisions,'2',0,divisions);
  assert.equal(edited.length,divisions);
  assert.equal(edited[1],'2');
  assert.equal(editGridNote(edited,1/divisions,'0',0,divisions),'0'.repeat(divisions));
});
test('arbitrary subdivision preserves existing notes across export', async () => {
  const { replaceBar, parseChart } = await import('./chart.js');
  const { TJAParser } = await import('tja');
  const notes = '01' + '0'.repeat(22);
  const edited = editGridNote(notes,1/7,'2',0,7);
  assert.equal(edited.length,168); assert.equal(edited[7],'1'); assert.equal(edited[24],'2');
  const source = `TITLE:Test\nBPM:120\nCOURSE:Oni\n#START\n${notes},\n#END`;
  const parsed = parseChart(source,TJAParser);
  const output = replaceBar(source,parsed.bars[0],edited);
  assert.equal(parseChart(output,TJAParser).bars[0].notes,edited);
});
test('high resolution mixed divisions are retained within source capacity', () => {
  const notes = '01' + '0'.repeat(766);
  const edited = editGridNote(notes,1/64,'2',0,64);
  assert.equal(edited.length,768); assert.equal(edited[1],'1'); assert.equal(edited[12],'2');
});
test('mixed custom divisions can exceed the old 768-slot source limit', async () => {
  const { replaceBar, parseChart } = await import('./chart.js');
  const { TJAParser } = await import('tja');
  const notes = '01' + '0'.repeat(22);
  const edited = editGridNote(notes,1/97,'2',0,97);
  assert.equal(edited.length,2328); assert.equal(edited[97],'1'); assert.equal(edited[24],'2');
  const source = `TITLE:Test\nBPM:120\nCOURSE:Oni\n#START\n${notes},\n#END`;
  const parsed = parseChart(source,TJAParser);
  assert.equal(parseChart(replaceBar(source,parsed.bars[0],edited),TJAParser).bars[0].notes,edited);
});
test('invalid divisions and excessive source expansion are rejected', () => {
  for (const divisions of [0,-1,1.5,769,NaN]) assert.throws(()=>editGridNote('1000',.1,'1',0,divisions));
  assert.throws(()=>editGridNote('01'+'0'.repeat(766),1/767,'2',0,767),/65536/);
});