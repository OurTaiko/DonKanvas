import test from 'node:test';
import assert from 'node:assert/strict';
import { textDiff, applyDiff } from './history.js';

test('text diffs round-trip insertions, deletions, replacements and Unicode', () => {
  const texts = ['', 'abc', 'ab', 'ababc', 'a\nb\r\n', '谱面🥁', '谱🥁面'];
  for (const before of texts) for (const after of texts) {
    const diff = textDiff(before, after);
    assert.equal(applyDiff(before, diff), after);
    assert.equal(applyDiff(after, diff, true), before);
  }
  assert.deepEqual(textDiff('TITLE:Song\n1000,', 'TITLE:Song\n2000,'), { start: 11, removed: '1', inserted: '2' });
});

test('invalid or mismatched diffs fail explicitly', () => {
  for (const diff of [null, {}, { start: -1, removed: '', inserted: '' }, { start: 1.5, removed: '', inserted: '' }, { start: 4, removed: '', inserted: '' }, { start: 0, removed: 'z', inserted: '' }]) {
    assert.throws(() => applyDiff('abc', diff));
  }
});
