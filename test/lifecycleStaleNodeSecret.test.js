'use strict';

// Regression coverage for EvoMap/evolver#529
//   "Proxy: MailboxStore stale node_secret causes infinite auth failure loop"
//
// Two fixes are exercised here:
//   1. nodeSecret getter reconciles A2A_NODE_SECRET env var with the
//      MailboxStore: env wins on conflict and the store is rewritten so the
//      stale value cannot bite again on the next call.
//   2. reAuthenticate, when faced with node_id_already_claimed, drops the
//      cached secret on the way to the second attempt instead of looping.

const test = require('node:test');
const assert = require('node:assert');

const { LifecycleManager } = require('../src/proxy/lifecycle/manager');

const VALID_HEX64_A = 'a'.repeat(64);
const VALID_HEX64_B = 'b'.repeat(64);

function makeStore(initial = {}) {
  const state = { ...initial };
  const inbound = [];
  return {
    getState: (k) => (state[k] !== undefined ? state[k] : null),
    setState: (k, v) => { state[k] = v; },
    countPending: () => 0,
    writeInbound: (event) => { inbound.push(event); },
    writeInboundBatch: () => {},
    _state: state,
    _inbound: inbound,
  };
}

function silentLogger() {
  const calls = { log: [], warn: [], error: [] };
  return {
    log: (...args) => calls.log.push(args.join(' ')),
    warn: (...args) => calls.warn.push(args.join(' ')),
    error: (...args) => calls.error.push(args.join(' ')),
    _calls: calls,
  };
}

function mockFetch(responseFactory) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return responseFactory(calls.length, opts);
  };
  fn.calls = calls;
  return fn;
}

function responseFromJson({ status = 200, json = {}, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] || headers[k] || null },
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

test('nodeSecret getter: env var wins over stale store value and rewrites store', () => {
  const original = process.env.A2A_NODE_SECRET;
  try {
    process.env.A2A_NODE_SECRET = VALID_HEX64_A;
    const store = makeStore({ node_secret: VALID_HEX64_B });
    const logger = silentLogger();
    const mgr = new LifecycleManager({ hubUrl: 'https://example.test', store, logger });

    const resolved = mgr.nodeSecret;

    assert.strictEqual(resolved, VALID_HEX64_A, 'env value should win on conflict');
    assert.strictEqual(store.getState('node_secret'), VALID_HEX64_A, 'store should be re-synced');
    assert.ok(
      logger._calls.warn.some((m) => m.includes('A2A_NODE_SECRET env var differs')),
      'should warn the operator exactly once'
    );

    // Second access must NOT log again -- prevents log flooding on every header build.
    mgr.nodeSecret;
    const warnCount = logger._calls.warn.filter((m) => m.includes('A2A_NODE_SECRET env var differs')).length;
    assert.strictEqual(warnCount, 1, 'override warning should be one-shot');
  } finally {
    if (original === undefined) delete process.env.A2A_NODE_SECRET;
    else process.env.A2A_NODE_SECRET = original;
  }
});

test('nodeSecret getter: malformed env var falls back to store', () => {
  const original = process.env.A2A_NODE_SECRET;
  try {
    process.env.A2A_NODE_SECRET = 'not-a-real-hex64-secret';
    const store = makeStore({ node_secret: VALID_HEX64_B });
    const mgr = new LifecycleManager({ hubUrl: 'https://example.test', store, logger: silentLogger() });

    assert.strictEqual(mgr.nodeSecret, VALID_HEX64_B);
    assert.strictEqual(store.getState('node_secret'), VALID_HEX64_B, 'store untouched on malformed env');
  } finally {
    if (original === undefined) delete process.env.A2A_NODE_SECRET;
    else process.env.A2A_NODE_SECRET = original;
  }
});

test('nodeSecret getter: identical env and store values do not log', () => {
  const original = process.env.A2A_NODE_SECRET;
  try {
    process.env.A2A_NODE_SECRET = VALID_HEX64_A;
    const store = makeStore({ node_secret: VALID_HEX64_A });
    const logger = silentLogger();
    const mgr = new LifecycleManager({ hubUrl: 'https://example.test', store, logger });

    assert.strictEqual(mgr.nodeSecret, VALID_HEX64_A);
    assert.strictEqual(logger._calls.warn.length, 0, 'no warning when values agree');
  } finally {
    if (original === undefined) delete process.env.A2A_NODE_SECRET;
    else process.env.A2A_NODE_SECRET = original;
  }
});

test('reAuthenticate: drops cached secret and retries unauthenticated when hub returns node_id_already_claimed', async () => {
  const original = process.env.A2A_NODE_SECRET;
  const originalFetch = global.fetch;
  try {
    delete process.env.A2A_NODE_SECRET;
    const store = makeStore({ node_id: 'node_test', node_secret: VALID_HEX64_A });
    let secondHelloAuthHeader;

    const mf = mockFetch((nthCall, opts) => {
      if (nthCall === 1) {
        // attempt 1: rotate hello with current bearer -> rejected
        return responseFromJson({
          status: 200,
          json: { payload: { status: 'rejected', reason: 'node_id_already_claimed: belongs to another user' } },
        });
      }
      if (nthCall === 2) {
        secondHelloAuthHeader = opts?.headers ? opts.headers.Authorization : 'NO_HEADERS';
        // attempt 2: bearer was dropped, hub still rejects (truly disowned)
        return responseFromJson({
          status: 200,
          json: { payload: { status: 'rejected', reason: 'node_id_already_claimed: belongs to another user' } },
        });
      }
      return responseFromJson({ status: 500, json: { error: 'unexpected_extra_call' } });
    });
    global.fetch = mf;

    const mgr = new LifecycleManager({ hubUrl: 'https://example.test', store, logger: silentLogger() });
    const result = await mgr.reAuthenticate();

    assert.strictEqual(result, false);
    assert.strictEqual(mf.calls.length, 2, 'should attempt twice (once with bearer, once without)');
    assert.ok(
      secondHelloAuthHeader === undefined,
      `second hello must NOT carry an Authorization header (got: ${JSON.stringify(secondHelloAuthHeader)})`
    );
    assert.strictEqual(store.getState('node_secret'), '', 'cached secret must be cleared');
    assert.ok(mgr._reauthBackoffUntil > Date.now(), '30-min backoff still set after manual reset path');
    assert.ok(
      store._inbound.some((e) => e?.payload?.action === 'manual_secret_reset_required'),
      'should emit manual_secret_reset_required system event'
    );
  } finally {
    if (original === undefined) delete process.env.A2A_NODE_SECRET;
    else process.env.A2A_NODE_SECRET = original;
    global.fetch = originalFetch;
  }
});

test('reAuthenticate: no manual_reset event when rotate eventually succeeds', async () => {
  const original = process.env.A2A_NODE_SECRET;
  const originalFetch = global.fetch;
  try {
    delete process.env.A2A_NODE_SECRET;
    const store = makeStore({ node_id: 'node_test', node_secret: VALID_HEX64_A });

    const mf = mockFetch((nthCall) => {
      if (nthCall === 1) {
        // hello rotate succeeds with fresh secret
        return responseFromJson({
          status: 200,
          json: { payload: { status: 'acknowledged', node_secret: VALID_HEX64_B, your_node_id: 'node_test' } },
        });
      }
      // heartbeat OK
      return responseFromJson({ status: 200, json: { status: 'ok' } });
    });
    global.fetch = mf;

    const mgr = new LifecycleManager({ hubUrl: 'https://example.test', store, logger: silentLogger() });
    const result = await mgr.reAuthenticate();

    assert.strictEqual(result, true);
    assert.strictEqual(store.getState('node_secret'), VALID_HEX64_B, 'fresh secret persisted');
    assert.strictEqual(
      store._inbound.filter((e) => e?.payload?.action === 'manual_secret_reset_required').length,
      0,
      'no manual-reset event on happy recovery'
    );
  } finally {
    if (original === undefined) delete process.env.A2A_NODE_SECRET;
    else process.env.A2A_NODE_SECRET = original;
    global.fetch = originalFetch;
  }
});
