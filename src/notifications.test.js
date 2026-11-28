import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotifications } from './notifications.js';

test('messages and repeated errors stack independently and expire at the eight-second boundary', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const queue = createNotifications();
  queue.push('saved');
  t.mock.timers.tick(1000);
  const first = queue.push('failed', true), second = queue.push('failed', true);
  assert.deepEqual(queue.items.map(item => item.message), ['saved', 'failed', 'failed']);
  assert.notEqual(first, second);
  t.mock.timers.tick(6999);
  assert.equal(queue.items.length, 3);
  t.mock.timers.tick(1);
  assert.deepEqual(queue.items.map(item => item.id), [first, second]);
  t.mock.timers.tick(999);
  assert.equal(queue.items.length, 2);
  t.mock.timers.tick(1);
  assert.equal(queue.items.length, 0);
});

test('per-message durations, persistent messages and manual dismissal do not affect other timers', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const queue = createNotifications();
  const persistent = queue.push('keep', true, { duration: 0 });
  const dismissed = queue.push('close', false, { duration: 1000 });
  queue.push('later', false, { duration: 12000 });
  queue.dismiss(dismissed);
  t.mock.timers.tick(11999);
  assert.deepEqual(queue.items.map(item => item.message), ['keep', 'later']);
  t.mock.timers.tick(1);
  assert.deepEqual(queue.items.map(item => item.id), [persistent]);
  for (const duration of [-1, NaN, Infinity, 2147483648]) assert.throws(() => queue.push('invalid', false, { duration }), RangeError);
  queue.dispose();
});

test('interaction pauses remaining time and disposal cancels pending notifications', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const queue = createNotifications(), id = queue.push('read me');
  t.mock.timers.tick(2000);
  queue.pause(id); queue.pause(id);
  t.mock.timers.tick(10000);
  assert.equal(queue.items.length, 1);
  queue.resume(id); queue.resume(id);
  t.mock.timers.tick(5999);
  assert.equal(queue.items.length, 1);
  t.mock.timers.tick(1);
  assert.equal(queue.items.length, 0);
  queue.push('dispose');
  queue.dispose();
  t.mock.timers.tick(8000);
  assert.equal(queue.items.length, 0);
  assert.throws(() => queue.push('too late'), /disposed/);
});
