'use strict';

// AsyncLocalStorage-backed trace context for intra-process span parenting.
// Each entry is { traceId, spanId } representing the currently-active span;
// callers wrap async/sync work with runWithContext to inherit parentage.

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function getCurrentContext() {
  return storage.getStore() || null;
}

function getCurrentTraceId() {
  const ctx = storage.getStore();
  return ctx && ctx.traceId ? ctx.traceId : null;
}

function getCurrentSpanId() {
  const ctx = storage.getStore();
  return ctx && ctx.spanId ? ctx.spanId : null;
}

function runWithContext(context, fn) {
  if (!context || typeof context !== 'object') return fn();
  const next = {
    traceId: context.traceId || null,
    spanId: context.spanId || null,
  };
  return storage.run(next, fn);
}

module.exports = {
  getCurrentContext,
  getCurrentTraceId,
  getCurrentSpanId,
  runWithContext,
};
