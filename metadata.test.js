import test from 'node:test';
import assert from 'node:assert/strict';
import { TJAParser as parser } from 'tja';
import { parseChart } from './chart.js';
import { songMetadata, setSongMetadata } from './metadata.js';

const text = 'TITLE:Original\r\nBPM:120\r\nOFFSET:0\r\nCUSTOM:keep me\r\n// Preserve comments\r\nCOURSE:Oni\r\nLEVEL:3\r\n#START\r\n1000,\r\n#END\r\nCOURSE:Easy\r\nLEVEL:1\r\n#START\r\n2000,\r\n#END\r\n';

test('song metadata edits are atomic, preserve CRLF, unknown fields, comments and all course bodies', () => {
  const updated = setSongMetadata(text, { TITLE: '新标题', SUBTITLE: '--副标题', ARTIST: 'Artist', GENRE: 'Original', WAVE: 'music/夜想陽炎.mp3', BPM: '150', OFFSET: '-.825', DEMOSTART: '20.5' });
  assert.equal(updated.slice(updated.indexOf('COURSE:')), text.slice(text.indexOf('COURSE:')));
  assert.ok(updated.includes('CUSTOM:keep me\r\n// Preserve comments\r\n'));
  assert.ok(!updated.replace(/\r\n/g, '').includes('\n'));
  assert.deepEqual(songMetadata(updated), { TITLE: '新标题', SUBTITLE: '--副标题', ARTIST: 'Artist', GENRE: 'Original', WAVE: 'music/夜想陽炎.mp3', BPM: '150', OFFSET: '-.825', DEMOSTART: '20.5' });
  const chart = parseChart(updated, parser);
  assert.equal(chart.title, '新标题'); assert.equal(chart.baseBpm, 150); assert.equal(chart.offset, -.825);
  assert.equal(chart.courses.length, 2);
});

test('unchanged values preserve the source exactly and optional empty values remove only global fields', () => {
  assert.equal(setSongMetadata(text, songMetadata(text)), text);
  const source = 'TITLE:Original\nBPM:120\nWAVE:old.mp3\nDEMOSTART:20\nCOURSE:Oni\nARTIST:course-only\n#START\n1000,\n#END\n';
  const updated = setSongMetadata(source, { WAVE: '', DEMOSTART: '', ARTIST: 'Song artist' });
  assert.ok(!updated.includes('WAVE:')); assert.ok(!updated.includes('DEMOSTART:'));
  assert.ok(updated.includes('ARTIST:Song artist\nCOURSE:Oni\nARTIST:course-only\n'));
});

test('metadata applies validate all fields before modifying any text', () => {
  for (const values of [{ TITLE: 'Changed', BPM: '0' }, { BPM: '' }, { BPM: 'Infinity' }, { OFFSET: 'NaN' }, { DEMOSTART: '-1' }, { TITLE: 'Song\n#END' }, { UNKNOWN: 'value' }]) {
    assert.throws(() => setSongMetadata(text, values));
  }
  assert.ok(setSongMetadata(text, { OFFSET: '-2', DEMOSTART: '0' }).includes('OFFSET:-2'));
});

test('missing headers and duplicate global definitions are updated consistently', () => {
  const source = 'TITLE:Old\nTITLE:Duplicate\nBPM:120\n#START\n1000,\n#END\n';
  const updated = setSongMetadata(source, { TITLE: 'New', ARTIST: 'Artist' });
  assert.equal((updated.match(/^TITLE:New$/gm) || []).length, 2);
  assert.ok(updated.includes('ARTIST:Artist\n#START'));
});
