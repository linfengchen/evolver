const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.A2A_NODE_SECRET) {
  process.env.A2A_NODE_SECRET = 'a'.repeat(64);
}

// Rigged require cache: swap the forceUpdate module for a spy BEFORE
// a2aProtocol is required, so _maybeTriggerForceUpdateFromHeartbeat picks up
// the spy instead of spawning npm/degit against the real network.
const forceUpdatePath = require.resolve('../src/forceUpdate');
let executeForceUpdateCalls = [];
let executeForceUpdateReturn = false;
require.cache[forceUpdatePath] = {
  id: forceUpdatePath,
  filename: forceUpdatePath,
  loaded: true,
  exports: {
    executeForceUpdate: function (fu) {
      executeForceUpdateCalls.push(fu);
      return executeForceUpdateReturn;
    },
  },
};

const { sendHeartbeat, _resetForceUpdateStateForTesting } = require('../src/gep/a2aProtocol');

describe('heartbeat-triggered force_update', () => {
  var tmpDir;
  var originalFetch;
  var originalHubUrl;
  var originalLogsDir;
  var originalProcessExit;
  var exitCalls;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolver-fu-test-'));
    originalHubUrl = process.env.A2A_HUB_URL;
    originalLogsDir = process.env.EVOLVER_LOGS_DIR;
    process.env.A2A_HUB_URL = 'http://localhost:19999';
    process.env.EVOLVER_LOGS_DIR = tmpDir;
    originalFetch = global.fetch;
    originalProcessExit = process.exit;
  });

  after(() => {
    global.fetch = originalFetch;
    process.exit = originalProcessExit;
    if (originalHubUrl === undefined) delete process.env.A2A_HUB_URL;
    else process.env.A2A_HUB_URL = originalHubUrl;
    if (originalLogsDir === undefined) delete process.env.EVOLVER_LOGS_DIR;
    else process.env.EVOLVER_LOGS_DIR = originalLogsDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    executeForceUpdateCalls = [];
    executeForceUpdateReturn = false;
    exitCalls = [];
    process.exit = function (code) { exitCalls.push(code); };
    // Default: cooldown 0 so each test starts fresh. The cooldown test
    // overrides to a large value inside its own body.
    process.env.EVOLVER_FORCE_UPDATE_RETRY_COOLDOWN_MS = '0';
    _resetForceUpdateStateForTesting();
  });

  it('calls executeForceUpdate exactly once when Hub returns force_update', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        force_update: {
          required_version: '>=1.74.1',
          reason: 'atp_auto_deliver',
          deadline_ms: 90000,
        },
      }),
      text: async () => '',
    });

    var result = await sendHeartbeat();
    assert.ok(result.ok, 'heartbeat should succeed');
    // Give the microtask a tick to run.
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(executeForceUpdateCalls.length, 1, 'executeForceUpdate called exactly once');
    assert.equal(executeForceUpdateCalls[0].required_version, '>=1.74.1');
    assert.deepEqual(exitCalls, [], 'no process.exit when upgrade fails');
  });

  it('calls process.exit(78) when executeForceUpdate returns true', async () => {
    executeForceUpdateReturn = true;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        force_update: { required_version: '>=1.74.1', reason: 'test' },
      }),
      text: async () => '',
    });

    var result = await sendHeartbeat();
    assert.ok(result.ok);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(exitCalls.length, 1);
    assert.equal(exitCalls[0], 78);
  });

  it('does nothing when heartbeat response has no force_update', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
      text: async () => '',
    });

    var result = await sendHeartbeat();
    assert.ok(result.ok);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(executeForceUpdateCalls.length, 0);
  });

  it('respects cooldown: does not call executeForceUpdate twice back-to-back', async () => {
    // Large cooldown for this test to verify the second call is blocked.
    process.env.EVOLVER_FORCE_UPDATE_RETRY_COOLDOWN_MS = '3600000';
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        force_update: { required_version: '>=1.74.1', reason: 'test' },
      }),
      text: async () => '',
    });

    await sendHeartbeat();
    await new Promise(resolve => setImmediate(resolve));
    // Second heartbeat comes in before cooldown expires.
    await sendHeartbeat();
    await new Promise(resolve => setImmediate(resolve));

    // In beforeEach we reset counters before each `it`, so within this single
    // test we should see at most 1 call (the second one is blocked by
    // in-flight lock / recent-attempt cooldown).
    assert.equal(executeForceUpdateCalls.length, 1,
      'second back-to-back heartbeat must not re-trigger executeForceUpdate');
  });
});
