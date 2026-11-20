import test from 'node:test';
import assert from 'node:assert/strict';
import { TJAParser as parser } from 'tja';
import { parseChart } from './chart.js';
import { SONG_FIELDS, songMetadata, setSongMetadata } from './metadata.js';

const text = 'TITLE:Original\r\nBPM:120\r\nOFFSET:0\r\nCUSTOM:keep me\r\n// Preserve comments\r\nCOURSE:Oni\r\nLEVEL:3\r\n#START\r\n1000,\r\n#END\r\nCOURSE:Easy\r\nLEVEL:1\r\n#START\r\n2000,\r\n#END\r\n';

test('song metadata edits are atomic, preserve CRLF, unknown fields, comments and all course bodies', () => {
  const updated = setSongMetadata(text, { TITLE: '新标题', SUBTITLE: '--副标题', ARTIST: 'Artist', GENRE: 'Original', WAVE: 'music/夜想陽炎.mp3', BPM: '150', OFFSET: '-.825', DEMOSTART: '20.5' });
  assert.equal(updated.slice(updated.indexOf('COURSE:')), text.slice(text.indexOf('COURSE:')));
  assert.ok(updated.includes('CUSTOM:keep me\r\n// Preserve comments\r\n'));
  assert.ok(!updated.replace(/\r\n/g, '').includes('\n'));
  assert.deepEqual(songMetadata(updated), { TITLE: '新标题', SUBTITLE: '--副标题', TITLEZH: '', SUBTITLEZH: '', TITLEEN: '', SUBTITLEEN: '', TITLEJA: '', SUBTITLEJA: '', TITLEKO: '', SUBTITLEKO: '', ARTIST: 'Artist', GENRE: 'Original', WAVE: 'music/夜想陽炎.mp3', BPM: '150', OFFSET: '-.825', DEMOSTART: '20.5' });
  const chart = parseChart(updated, parser);
  assert.equal(chart.title, '新标题'); assert.equal(chart.baseBpm, 150); assert.equal(chart.offset, -.825);
  assert.equal(chart.courses.length, 2);
});

test('all localized titles and subtitles round trip independently without changing base fields or chart bodies', () => {
  const values = { TITLEZH: '中文曲名', SUBTITLEZH: '--中文副标题', TITLEEN: 'English title', SUBTITLEEN: '++English subtitle', TITLEJA: '日本語の曲名', SUBTITLEJA: '--日本語の副題', TITLEKO: '한국어 곡명', SUBTITLEKO: '++한국어 부제' };
  assert.deepEqual(SONG_FIELDS.filter(field => field.localized).map(field => field.key), Object.keys(values));
  const source = text.replace('COURSE:Oni', 'SUBTITLE:--Base subtitle\r\nCOURSE:Oni').replace('LEVEL:3', 'TITLEJA:Chart-local title\r\nLEVEL:3');
  const updated = setSongMetadata(source, values), metadata = songMetadata(updated);
  for (const [key, value] of Object.entries(values)) assert.equal(metadata[key], value);
  assert.equal(metadata.TITLE, 'Original'); assert.equal(metadata.SUBTITLE, '--Base subtitle');
  assert.equal(updated.slice(updated.indexOf('COURSE:')), source.slice(source.indexOf('COURSE:')));
  assert.ok(updated.includes('CUSTOM:keep me\r\n// Preserve comments\r\n'));
  assert.ok(!updated.replace(/\r\n/g, '').includes('\n'));
  assert.equal(setSongMetadata(updated, songMetadata(updated)), updated);
  assert.equal(parseChart(updated, parser).title, 'Original');
  const cleared = setSongMetadata(updated, Object.fromEntries(Object.keys(values).map(key => [key, ''])));
  assert.equal(cleared, source);
  assert.equal(songMetadata(cleared).TITLEJA, '');
  for (const key of Object.keys(values)) {
    for (const invalid of ['Title\n#END', 'Title\r#START', 'Title\0hidden']) assert.throws(() => setSongMetadata(updated, { TITLE: 'Must not apply', [key]: invalid }));
  }
});

test('duplicate localized global definitions update and clear without touching inherited chart fields', () => {
  const source = text.replace('COURSE:Oni', 'TITLEEN:First\r\nTITLEEN:Second\r\nCOURSE:Oni').replace('LEVEL:3', 'TITLEEN:Course-only\r\nLEVEL:3');
  const updated = setSongMetadata(source, { TITLEEN: 'New' });
  assert.equal((updated.match(/^TITLEEN:New\r?$/gm) || []).length, 2);
  assert.equal(songMetadata(updated).TITLEEN, 'New');
  assert.ok(setSongMetadata(updated, { TITLEEN: '' }).includes('TITLEEN:Course-only\r\n'));
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
