// test/stakeBootstrap.test.js
// Unit tests for src/gep/validator/stakeBootstrap.js: retry state machine,
// failure classification, and backoff behavior. Mocks global.fetch and the
// a2aProtocol node-id/hub-url resolvers.
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

function freshRequire(id) {
  delete require.cache[require.resolve(id)];
  return require(id);
}

function installA2aProtocolStub(nodeId, hubUrl) {
  const target = require.resolve('../src/gep/a2aProtocol');
  const sbPath = require.resolve('../src/gep/validator/stakeBootstrap');
  delete require.cache[target];
  delete require.cache[sbPath];
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_) {}
    if (resolved === target) {
      return {
        buildHubHeaders: () => ({ 'content-type': 'application/json' }),
        getHubUrl: () => hubUrl,
        getNodeId: () => nodeId,
      };
    }
    return origLoad.apply(this, arguments);
  };
  return () => {
    Module._load = origLoad;
    delete require.cache[target];
    delete require.cache[sbPath];
  };
}

describe('stakeBootstrap retry state machine', function () {
  let restoreFetch;
  let restoreA2a;

  beforeEach(() => {
    restoreA2a = installA2aProtocolStub('node-test-stake', 'https://hub.example.com');
  });

  afterEach(() => {
    if (restoreA2a) restoreA2a();
    if (restoreFetch) restoreFetch();
    restoreFetch = null;
    restoreA2a = null;
  });

  function stubFetch(responder) {
    const original = global.fetch;
    global.fetch = async (url, init) => responder(url, init);
    return () => { global.fetch = original; };
  }

  it('success resets backoff and schedules next attempt ~24h away', async () => {
    const sb = freshRequire('../src/gep/validator/stakeBootstrap');
    sb._resetStateForTests();
    restoreFetch = stubFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'ok', stake: { stake_amount: 100, status: 'active', node_id: 'node-test-stake' } }),
    }));

    const result = await sb.ensureValidatorStake({});
    assert.equal(result.ok, true);
    const state = sb._getStateForTests();
    assert.equal(state.transientFailures, 0);
    assert.equal(state.fundsFailures, 0);
    assert.ok(state.nextAttemptAt > Date.now() + (23 * 60 * 60 * 1000), 'next attempt should be ~24h from now');
  });

  it('network error increments transient failures and schedules first backoff (5min)', async () => {
    const sb = freshRequire('../src/gep/validator/stakeBootstrap');
    sb._resetStateForTests();
    restoreFetch = stubFetch(async () => { throw new Error('network down'); });

    const r = await sb.ensureValidatorStake({});
    assert.equal(r.ok, false);
    const state = sb._getStateForTests();
    assert.equal(state.transientFailures, 1);
    const delay = state.nextAttemptAt - Date.now();
    assert.ok(delay >= 4 * 60 * 1000 && delay <= 6 * 60 * 1000, `first transient delay should be ~5min, got ${delay}`);
  });

  it('402 insufficient_credits classified as funds and uses funds backoff (~60min first)', async () => {
    const sb = freshRequire('../src/gep/validator/stakeBootstrap');
    sb._resetStateForTests();
    restoreFetch = stubFetch(async () => ({
      ok: false,
      status: 402,
      text: async () => JSON.stringify({ error: 'insufficient_credits: need 100, have 42' }),
    }));

    const r = await sb.ensureValidatorStake({});
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'funds');
    const state = sb._getStateForTests();
    assert.equal(state.fundsFailures, 1);
    assert.equal(state.transientFailures, 0);
    const delay = state.nextAttemptAt - Date.now();
    assert.ok(delay >= 59 * 60 * 1000 && delay <= 61 * 60 * 1000, `first funds delay should be ~60min, got ${delay}`);
  });

  it('400 stake_amount_must_be_at_least_100 classified as permanent (disabled_until_restart)', async () => {
    const sb = freshRequire('../src/gep/validator/stakeBootstrap');
    sb._resetStateForTests();
    restoreFetch = stubFetch(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'stake_amount_must_be_at_least_100' }),
    }));

    const r1 = await sb.ensureValidatorStake({});
    assert.equal(r1.ok, false);
    assert.equal(r1.kind, 'permanent');

    const r2 = await sb.ensureValidatorStake({});
    assert.equal(r2.ok, false);
    assert.equal(r2.skipped, 'disabled_until_restart');
  });

  it('backoff skip short-circuits until nextAttemptAt, then allows retry after force', async () => {
    const sb = freshRequire('../src/gep/validator/stakeBootstrap');
    sb._resetStateForTests();
    let calls = 0;
    restoreFetch = stubFetch(async () => {
      calls += 1;
      throw new Error('boom');
    });

    await sb.ensureValidatorStake({});
    const skipped = await sb.ensureValidatorStake({});
    assert.equal(skipped.skipped, 'backoff');
    assert.equal(calls, 1);

    const forced = await sb.ensureValidatorStake({ force: true });
    assert.equal(forced.ok, false);
    assert.equal(calls, 2);
    const state = sb._getStateForTests();
    assert.equal(state.transientFailures, 2);
    const delay = state.nextAttemptAt - Date.now();
    assert.ok(delay >= 14 * 60 * 1000 && delay <= 16 * 60 * 1000, `second transient delay should be ~15min, got ${delay}`);
  });

  it('exports DEFAULT_STAKE_AMOUNT = 100', function () {
    const sb = freshRequire('../src/gep/validator/stakeBootstrap');
    assert.equal(sb.DEFAULT_STAKE_AMOUNT, 100);
  });
});
