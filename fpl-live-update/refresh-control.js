'use strict';

// A process-local gate for whole-league builds. Source/API caches and same-league
// promise deduplication stay with their existing owners; tasks are opaque here.
function createTaskGate({ concurrency = 2, maxQueued = 24, queueTimeoutMs = 30_000,
  now = Date.now, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1
    || !Number.isSafeInteger(maxQueued) || maxQueued < 0
    || !Number.isFinite(queueTimeoutMs) || queueTimeoutMs < 0
    || typeof now !== 'function' || typeof setTimeoutFn !== 'function' || typeof clearTimeoutFn !== 'function') {
    throw new TypeError('Invalid task gate configuration');
  }
  const queue = [];
  let running = 0;
  function unavailable(message) {
    const error = new Error(message);
    error.status = 503;
    error.retryAfterSeconds = 30;
    return error;
  }
  function clearTimer(entry) {
    if (entry.timer !== null) { clearTimeoutFn(entry.timer); entry.timer = null; }
  }
  function expire(entry) {
    if (entry.state !== 'queued') return;
    entry.state = 'settled';
    clearTimer(entry);
    const index = queue.indexOf(entry);
    if (index !== -1) queue.splice(index, 1);
    entry.reject(unavailable('联赛加载排队超时，请稍后重试'));
  }
  function drain() {
    while (running < concurrency && queue.length) {
      const entry = queue[0];
      // Timers can run late under load. The deadline must still be enforced if
      // a slot opens before the overdue timeout callback reaches the event loop.
      if (now() >= entry.deadline) { expire(entry); continue; }
      queue.shift();
      start(entry);
    }
  }
  function start(entry) {
    clearTimer(entry);
    entry.state = 'running';
    running++;
    const finish = (ok, value) => {
      entry.state = 'settled';
      running--;
      if (ok) entry.resolve(value); else entry.reject(value);
      drain();
    };
    // Reserve the slot before invoking any user task. Synchronous throws and
    // thenables follow the same release path, without cancelling running work.
    Promise.resolve().then(entry.task).then(value => finish(true, value), error => finish(false, error));
  }
  function run(task) {
    if (typeof task !== 'function') return Promise.reject(new TypeError('Task must be a function'));
    return new Promise((resolve, reject) => {
      const entry = { task, resolve, reject, state: 'queued', timer: null, deadline: null };
      if (running < concurrency && !queue.length) { start(entry); return; }
      if (queue.length >= maxQueued) { reject(unavailable('联赛加载请求较多，请稍后重试')); return; }
      if (queueTimeoutMs === 0) { reject(unavailable('联赛加载排队超时，请稍后重试')); return; }
      entry.deadline = now() + queueTimeoutMs;
      queue.push(entry);
      entry.timer = setTimeoutFn(() => expire(entry), queueTimeoutMs);
    });
  }
  return { run };
}

module.exports = { createTaskGate };
