import { message, LocalizedError } from './i18n.js';
import { BRANCH_ROUTES } from './chart.js';
export const HISTORY_LIMIT = 50;

export function textDiff(before, after) {
  let start = 0, endBefore = before.length, endAfter = after.length;
  while (start < endBefore && start < endAfter && before[start] === after[start]) start++;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  return { start, removed: before.slice(start, endBefore), inserted: after.slice(start, endAfter) };
}

export function applyDiff(text, diff, reverse = false) {
  if (!diff || !Number.isSafeInteger(diff.start) || diff.start < 0 || typeof diff.removed !== 'string' || typeof diff.inserted !== 'string') throw new LocalizedError(message('编辑历史格式无效。'));
  if (diff.routeState !== undefined) {
    const state = diff.routeState;
    if (!state || !Number.isSafeInteger(state.course) || state.course < 0 ||
        ![state.before, state.after].every(routes => Array.isArray(routes) && routes.every(route => route === null || BRANCH_ROUTES.includes(route)))) throw new LocalizedError(message('编辑历史格式无效。'));
  }
  if (diff.courseState !== undefined && (!diff.courseState || !['before', 'after'].every(key => {
    const selection = diff.courseState[key];
    return selection && Number.isSafeInteger(selection.course) && selection.course >= 0 && Array.isArray(selection.routes) && selection.routes.every(route => route === null || BRANCH_ROUTES.includes(route));
  }))) throw new LocalizedError(message('编辑历史格式无效。'));
  if (diff.measureState !== undefined && (!diff.measureState || !Number.isSafeInteger(diff.measureState.course) || diff.measureState.course < 0 || !['before', 'after'].every(key => {
    const state = diff.measureState[key];
    return state && Number.isSafeInteger(state.selected) && state.selected >= 0 && (state.loop === null || (Array.isArray(state.loop) && state.loop.length === 2 && state.loop.every(value => Number.isSafeInteger(value) && value > 0) && state.loop[0] <= state.loop[1]));
  }))) throw new LocalizedError(message('编辑历史格式无效。'));
  const removed = reverse ? diff.inserted : diff.removed, inserted = reverse ? diff.removed : diff.inserted;
  if (diff.start > text.length || text.slice(diff.start, diff.start + removed.length) !== removed) throw new LocalizedError(message('编辑历史与谱面内容不匹配。'));
  return text.slice(0, diff.start) + inserted + text.slice(diff.start + removed.length);
}
