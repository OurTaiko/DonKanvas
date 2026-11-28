import { shallowReactive } from 'vue';

export function createNotifications() {
  const state = shallowReactive({ items: [] }), timers = new Map();
  let nextId = 1, disposed = false;
  function dismiss(id) {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer.handle);
    timers.delete(id);
    state.items = state.items.filter(item => item.id !== id);
  }
  function resume(id) {
    const timer = timers.get(id);
    if (!timer || timer.handle !== null) return;
    timer.started = Date.now();
    timer.handle = setTimeout(() => dismiss(id), timer.remaining);
  }
  function pause(id) {
    const timer = timers.get(id);
    if (!timer || timer.handle === null) return;
    clearTimeout(timer.handle);
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.started));
    timer.handle = null;
  }
  function push(message, error = false, { duration = 8000, action = null } = {}) {
    if (disposed) throw new Error('Notification queue is disposed.');
    if (!Number.isFinite(duration) || duration < 0 || duration > 2147483647) throw new RangeError('Notification duration must be between 0 and 2147483647 milliseconds.');
    const id = nextId++;
    state.items = [...state.items, { id, message, error, action }];
    if (duration > 0) {
      timers.set(id, { handle: null, remaining: duration, started: 0 });
      resume(id);
    }
    return id;
  }
  function dispose() {
    for (const timer of timers.values()) clearTimeout(timer.handle);
    timers.clear(); state.items = []; disposed = true;
  }
  return { get items() { return state.items; }, push, dismiss, pause, resume, dispose };
}
