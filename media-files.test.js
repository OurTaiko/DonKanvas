import test from 'node:test';
import assert from 'node:assert/strict';
import { waveSegments, indexMediaFiles, findWaveFile } from './media-files.js';

const entry = (path, name = path.split('/').at(-1)) => ({ name, webkitRelativePath: path });

test('WAVE resolves Unicode names, spaces, separators and parent paths within the authorized root', () => {
  assert.deepEqual(waveSegments('"夜想陽炎 - short ver.mp3"'), ['夜想陽炎 - short ver.mp3']);
  assert.deepEqual(waveSegments('music\\song.ogg', 'pack/chart.tja'), ['pack', 'music', 'song.ogg']);
  assert.deepEqual(waveSegments('../music/./song.ogg', 'pack/chart.tja'), ['music', 'song.ogg']);
  for (const wave of ['', '../song.mp3', 'audio/../../song.mp3', '/song.mp3', '\\\\server\\song.mp3', 'C:\\song.mp3', 'https://example.com/song.mp3', '.', 'audio/..', 'audio/']) {
    assert.throws(() => waveSegments(wave));
  }
});

test('directory handles resolve relative to the chart without creating files or directories', async () => {
  const audio = entry('Songs/music/song.mp3'), chartHandle = {};
  const music = { async getFileHandle(name, options) { assert.equal(name, 'song.mp3'); assert.equal(options, undefined); return { getFile: async () => audio }; } };
  const directory = {
    async resolve(handle) { assert.equal(handle, chartHandle); return ['charts', 'fixture.tja']; },
    async getDirectoryHandle(name, options) { assert.equal(name, 'music'); assert.equal(options, undefined); return music; }
  };
  assert.equal(await findWaveFile('../music/song.mp3', { directory, chartHandle }), audio);
});

test('directory selection indexes files and finds a nested chart and its WAVE counterpart', async () => {
  const chart = entry('Songs/pack/fixture.tja'), audio = entry('Songs/pack/夜想陽炎 - short ver.mp3');
  const indexed = indexMediaFiles([chart, audio]);
  assert.equal(indexed.name, 'Songs');
  assert.equal(await findWaveFile('夜想陽炎 - short ver.mp3', { files: indexed.files, chartName: 'fixture.tja' }), audio);
  assert.throws(() => indexMediaFiles([{ name: 'flat.mp3' }]));
  assert.throws(() => indexMediaFiles([audio, entry('Other/file.mp3')]));
  assert.throws(() => indexMediaFiles([audio, audio]));
});

test('case-insensitive fallback refuses ambiguous filenames and never guesses a chart directory', async () => {
  const lower = entry('Songs/song.mp3'), upper = entry('Songs/SONG.MP3');
  const { files } = indexMediaFiles([lower, upper]);
  assert.equal(await findWaveFile('song.mp3', { files, chartName: 'fixture.tja' }), lower);
  await assert.rejects(findWaveFile('Song.Mp3', { files, chartName: 'fixture.tja' }), /歧义/);
  await assert.rejects(findWaveFile('missing.mp3', { files, chartName: 'fixture.tja' }), /找不到/);
  const nested = indexMediaFiles([entry('Songs/a/same.tja'), entry('Songs/b/same.tja')]);
  await assert.rejects(findWaveFile('song.mp3', { files: nested.files, chartName: 'same.tja' }), /同名谱面/);
});
