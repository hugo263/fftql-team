'use strict';

// Authored without executing tests. Tasks and timers are entirely synthetic;
// the gate never contacts upstream APIs or writes site snapshots itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskGate } = require('../refresh-control');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function clock() {
  let time = 1000, nextId = 0;
  const timers = new Map();
  return { timers, now: () => time,
    setTimeoutFn(fn, ms) { const id = ++nextId; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimeoutFn(id) { timers.delete(id); },
    elapse(ms) { time += ms; },
    async fireDue() {
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= time)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        timers.delete(next[0]); next[1].fn(); await flush();
      }
    },
  };
}
function busyError(error) {
  assert.equal(error.status, 503);
  assert.equal(error.retryAfterSeconds, 30);
  return true;
}

test('gate limits cross-task concurrency to two and drains queued tasks in FIFO order', async () => {
  const timer = clock(), gate = createTaskGate(timer), jobs = Array.from({ length: 5 }, deferred);
  const starts = [];
  let active = 0, highWater = 0;
  const results = jobs.map((job, index) => gate.run(async () => {
    starts.push(index); active++; highWater = Math.max(highWater, active);
    try { return await job.promise; } finally { active--; }
  }));
  await flush(); assert.deepEqual(starts, [0, 1]); assert.equal(timer.timers.size, 3);
  jobs[1].resolve('one'); await flush(); assert.deepEqual(starts, [0, 1, 2]);
  jobs[0].resolve('zero'); await flush(); assert.deepEqual(starts, [0, 1, 2, 3]);
  jobs[2].resolve('two'); await flush(); assert.deepEqual(starts, [0, 1, 2, 3, 4]);
  jobs[3].resolve('three'); jobs[4].resolve('four');
  assert.deepEqual(await Promise.all(results), ['zero', 'one', 'two', 'three', 'four']);
  assert.equal(highWater, 2); assert.equal(timer.timers.size, 0);
});

test('queue capacity counts only waiting work; a full queue rejects with retry guidance', async () => {
  const timer = clock(), gate = createTaskGate({ ...timer, concurrency: 1, maxQueued: 1 });
  const running = deferred(), waiting = deferred();
  const starts = [];
  const first = gate.run(() => { starts.push('first'); return running.promise; });
  const second = gate.run(() => { starts.push('second'); return waiting.promise; });
  const overflow = gate.run(() => { starts.push('overflow'); });
  await assert.rejects(overflow, busyError);
  assert.deepEqual(starts, ['first']);
  running.resolve('first'); await flush(); assert.deepEqual(starts, ['first', 'second']);
  waiting.resolve('second'); await Promise.all([first, second]);
  assert.equal(await gate.run(() => 'later'), 'later');
});

test('waiting work times out at its queue deadline and never starts later', async () => {
  const timer = clock(), gate = createTaskGate({ ...timer, concurrency: 1, queueTimeoutMs: 30_000 });
  const running = deferred(); let expiredStarts = 0;
  const first = gate.run(() => running.promise);
  const waiting = gate.run(() => { expiredStarts++; return 'must never run'; });
  const rejected = assert.rejects(waiting, error => { busyError(error); assert.match(error.message, /超时/); return true; });
  timer.elapse(29_999); await timer.fireDue(); assert.equal(expiredStarts, 0); assert.equal(timer.timers.size, 1);
  timer.elapse(1); await timer.fireDue(); await rejected;
  assert.equal(timer.timers.size, 0);
  running.resolve('still finishes'); assert.equal(await first, 'still finishes');
  await flush(); assert.equal(expiredStarts, 0);
});

test('an overdue timer cannot let an expired queued task start when a slot is released first', async () => {
  const timer = clock(), gate = createTaskGate({ ...timer, concurrency: 1, queueTimeoutMs: 30 });
  const running = deferred(); let expiredStarts = 0;
  const first = gate.run(() => running.promise);
  const waiting = gate.run(() => { expiredStarts++; });
  const rejected = assert.rejects(waiting, busyError);
  timer.elapse(30); // Deliberately do not execute the overdue timeout callback.
  running.resolve('done'); await first; await rejected;
  await timer.fireDue();
  assert.equal(expiredStarts, 0); assert.equal(timer.timers.size, 0);
  assert.equal(await gate.run(() => 'recovered'), 'recovered');
});

test('expired queue entries free capacity without cancelling a running task', async () => {
  const timer = clock(), gate = createTaskGate({ ...timer, concurrency: 1, maxQueued: 1, queueTimeoutMs: 10 });
  const running = deferred(); let expiredStarts = 0, replacementStarts = 0;
  const first = gate.run(() => running.promise);
  const expired = gate.run(() => { expiredStarts++; });
  const rejected = assert.rejects(expired, busyError);
  timer.elapse(10); await timer.fireDue(); await rejected;
  const replacement = gate.run(() => { replacementStarts++; return 'replacement'; });
  assert.equal(replacementStarts, 0);
  running.resolve('running'); assert.equal(await first, 'running');
  assert.equal(await replacement, 'replacement');
  assert.equal(expiredStarts, 0); assert.equal(replacementStarts, 1);
});

test('starting a queued task removes its queue timer and does not apply a runtime timeout', async () => {
  const timer = clock(), gate = createTaskGate({ ...timer, concurrency: 1, queueTimeoutMs: 10 });
  const running = deferred(), secondJob = deferred();
  const first = gate.run(() => running.promise);
  const second = gate.run(() => secondJob.promise);
  assert.equal(timer.timers.size, 1);
  running.resolve('first'); await first; await flush(); assert.equal(timer.timers.size, 0);
  timer.elapse(100_000); await timer.fireDue();
  secondJob.resolve('completed long task'); assert.equal(await second, 'completed long task');
});

test('synchronous throws and asynchronous rejections release slots without changing the original errors', async () => {
  const timer = clock(), gate = createTaskGate({ ...timer, concurrency: 1 });
  const syncError = new Error('sync failure'), asyncError = new Error('async failure');
  const seen = [];
  const sync = gate.run(() => { seen.push('sync'); throw syncError; });
  const asynchronous = gate.run(() => { seen.push('async'); return Promise.reject(asyncError); });
  const last = gate.run(() => { seen.push('last'); return 42; });
  const syncRejected = assert.rejects(sync, error => error === syncError);
  const asyncRejected = assert.rejects(asynchronous, error => error === asyncError);
  await Promise.all([syncRejected, asyncRejected]); assert.equal(await last, 42);
  assert.deepEqual(seen, ['sync', 'async', 'last']); assert.equal(timer.timers.size, 0);
});

test('zero queue capacity or zero wait still permits available slots but never queues work', async () => {
  for (const options of [{ maxQueued: 0 }, { queueTimeoutMs: 0 }]) {
    const timer = clock(), gate = createTaskGate({ ...timer, concurrency: 1, ...options });
    const running = deferred();
    const first = gate.run(() => running.promise);
    await assert.rejects(gate.run(() => 'must not run'), busyError);
    assert.equal(timer.timers.size, 0);
    running.resolve('done'); assert.equal(await first, 'done');
    assert.equal(await gate.run(() => 'next'), 'next');
  }
});

test('gate validates configuration and rejects non-functions without consuming capacity', async () => {
  for (const options of [{ concurrency: 0 }, { concurrency: 1.5 }, { concurrency: Infinity },
    { maxQueued: -1 }, { maxQueued: 1.5 }, { queueTimeoutMs: -1 }, { queueTimeoutMs: NaN },
    { now: 7 }, { setTimeoutFn: null }, { clearTimeoutFn: null }]) {
    assert.throws(() => createTaskGate(options), TypeError);
  }
  const gate = createTaskGate(clock());
  await assert.rejects(gate.run(null), TypeError);
  assert.equal(await gate.run(() => 'available'), 'available');
});
