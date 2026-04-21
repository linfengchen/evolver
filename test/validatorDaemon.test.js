// test/validatorDaemon.test.js
// Tests the independent validator daemon: starts/stops cleanly, honors
// isValidatorEnabled at each tick, and processes tasks via runValidatorCycle.
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

function freshRequire(id) {
  delete require.cache[require.resolve(id)];
  return require(id);
}

function withFakeFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => { global.fetch = original; });
}

function mkRes(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('validator daemon', function () {
  const originalEnv = { ...process.env };
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  let tmpHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-daemon-'));
    process.env.EVOLVER_HOME = tmpHome;
    process.env.A2A_HUB_URL = 'http://hub.local';
    process.env.HUB_NODE_SECRET = 'secret';
    process.env.A2A_NODE_ID = 'node_test_daemon';
    // Tight intervals so tests run fast
    process.env.EVOLVER_VALIDATOR_DAEMON_INTERVAL_MS = '20000';
    process.env.EVOLVER_VALIDATOR_DAEMON_FIRST_DELAY_MS = '0';
    try {
      const sb = freshRequire('../src/gep/validator/stakeBootstrap');
      if (sb && typeof sb._resetStateForTests === 'function') sb._resetStateForTests();
    } catch (_) {}
  });

  afterEach(() => {
    try {
      const v = require('../src/gep/validator');
      if (v.stopValidatorDaemon) v.stopValidatorDaemon();
    } catch (_) {}
    for (const k of Object.keys(process.env)) {
      if (!(k in originalEnv)) delete process.env[k];
    }
    Object.assign(process.env, originalEnv);
    if (tmpHome) {
      try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('startValidatorDaemon is idempotent and reports stats', async function () {
    const v = freshRequire('../src/gep/validator');
    assert.equal(v.startValidatorDaemon(), true);
    assert.equal(v.startValidatorDaemon(), false, 'second call no-ops');
    const stats = v.getValidatorDaemonStats();
    assert.equal(stats.running, true);
    assert.ok(stats.intervalMs > 0);
    v.stopValidatorDaemon();
    assert.equal(v.getValidatorDaemonStats().running, false);
  });

  it('skips ticks when EVOLVER_VALIDATOR_ENABLED=0', async function () {
    process.env.EVOLVER_VALIDATOR_ENABLED = '0';
    let fetchCalls = 0;
    await withFakeFetch(async () => { fetchCalls += 1; return mkRes({ validation_tasks: [] }); }, async () => {
      const v = freshRequire('../src/gep/validator');
      v.startValidatorDaemon();
      await new Promise((r) => setTimeout(r, 50));
      v.stopValidatorDaemon();
    });
    assert.equal(fetchCalls, 0, 'no hub calls when disabled');
  });

  it('processes tasks on tick when enabled', async function () {
    process.env.EVOLVER_VALIDATOR_ENABLED = '1';
    let fetchCount = 0;
    let reportCount = 0;
    const fetchImpl = async (url) => {
      if (url.endsWith('/a2a/validator/stake')) return mkRes({ stake: { stake_amount: 100 } });
      if (url.endsWith('/a2a/fetch')) {
        fetchCount += 1;
        if (fetchCount === 1) {
          return mkRes({
            validation_tasks: [
              {
                task_id: 'vt_daemon_1',
                nonce: 'n1',
                validation_commands: ['echo daemon-ok'],
              },
            ],
          });
        }
        return mkRes({ validation_tasks: [] });
      }
      if (url.endsWith('/a2a/report')) {
        reportCount += 1;
        return mkRes({ status: 'accepted', payload: {} });
      }
      return mkRes({});
    };
    await withFakeFetch(fetchImpl, async () => {
      const v = freshRequire('../src/gep/validator');
      v.startValidatorDaemon();
      // Wait for first tick + sandbox exec; sandbox is real but `echo` is fast.
      await new Promise((r) => setTimeout(r, 1500));
      v.stopValidatorDaemon();
      const stats = v.getValidatorDaemonStats();
      assert.ok(stats.ticks >= 1, 'at least one tick happened: ' + stats.ticks);
    });
    assert.ok(fetchCount >= 1, 'daemon fetched tasks');
    assert.ok(reportCount >= 1, 'daemon submitted at least one report');
  });
});
