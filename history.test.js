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

test('structure route snapshots survive serialization and reject malformed history', () => {
  const diff = { ...textDiff('abc', 'abcd'), routeState: { course: 0, before: ['M'], after: ['N', 'M'] } };
  assert.equal(applyDiff('abcd', JSON.parse(JSON.stringify(diff)), true), 'abc');
  for (const routeState of [null, {}, { course: -1, before: [], after: [] }, { course: 0, before: ['bad'], after: [] }, { course: 0, before: [], after: 'N' }]) {
    assert.throws(() => applyDiff('abc', { ...diff, routeState }), /历史格式/);
  }
});
test('difficulty selection snapshots validate player and route restoration data', () => {
  const diff = { ...textDiff('abc', 'abcd'), courseState: { before: { course: 3, routes: ['E'] }, after: { course: 0, routes: [] } } };
  assert.equal(applyDiff('abcd', JSON.parse(JSON.stringify(diff)), true), 'abc');
  for (const courseState of [null, {}, { before: { course: -1, routes: [] }, after: { course: 0, routes: [] } }, { before: { course: 0, routes: ['bad'] }, after: { course: 1, routes: [] } }]) assert.throws(() => applyDiff('abc', { ...diff, courseState }), /历史格式/);
});

test('measure insertion snapshots survive serialization and reject invalid selection and loop data', () => {
  const selection = { selected: 1, loop: [2, 4] };
  const measureState = { course: 0, before: selection, after: { selected: 2, loop: [3, 5] } };
  const diff = { ...textDiff('abc', 'abcd'), measureState };
  assert.equal(applyDiff('abcd', JSON.parse(JSON.stringify(diff)), true), 'abc');
  for (const invalid of [
    null, {}, { ...measureState, course: -1 }, { ...measureState, before: null },
    ...[{ selected: -1, loop: null }, { selected: 1.5, loop: null }, { selected: 0 }, { selected: 0, loop: [0, 1] }, { selected: 0, loop: [3, 2] }, { selected: 0, loop: [1, 2, 3] }].map(after => ({ ...measureState, after }))
  ]) assert.throws(() => applyDiff('abc', { ...diff, measureState: invalid }), /历史格式/);
});
