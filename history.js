export const HISTORY_LIMIT = 50;

export function textDiff(before, after) {
  let start = 0, endBefore = before.length, endAfter = after.length;
  while (start < endBefore && start < endAfter && before[start] === after[start]) start++;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  return { start, removed: before.slice(start, endBefore), inserted: after.slice(start, endAfter) };
}

export function applyDiff(text, diff, reverse = false) {
  if (!diff || !Number.isSafeInteger(diff.start) || diff.start < 0 || typeof diff.removed !== 'string' || typeof diff.inserted !== 'string') throw new Error('编辑历史格式无效。');
  const removed = reverse ? diff.inserted : diff.removed, inserted = reverse ? diff.removed : diff.inserted;
  if (diff.start > text.length || text.slice(diff.start, diff.start + removed.length) !== removed) throw new Error('编辑历史与谱面内容不匹配。');
  return text.slice(0, diff.start) + inserted + text.slice(diff.start + removed.length);
}
