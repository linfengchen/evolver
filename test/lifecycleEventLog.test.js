'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_KEYS = [
  'HOME',
  'EVOLVER_LIFECYCLE_LOG',
  'EVOLVER_LIFECYCLE_LOG_FORCE',
  'EVOLVER_LIFECYCLE_LOG_MAX_LINES',
  'EVOLVER_LIFECYCLE_LOG_MAX_DAYS',
];

function freshModule() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/proxy/lifecycle/eventLog')) delete require.cache[key];
  }
  return require('../src/proxy/lifecycle/eventLog');
}

describe('lifecycle eventLog', () => {
  let tmpHome;
  let savedEnv;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'evolver-lifecycle-'));
    savedEnv = {};
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.HOME = tmpHome;
    process.env.EVOLVER_LIFECYCLE_LOG_FORCE = '1';
    delete process.env.EVOLVER_LIFECYCLE_LOG;
    delete process.env.EVOLVER_LIFECYCLE_LOG_MAX_LINES;
    delete process.env.EVOLVER_LIFECYCLE_LOG_MAX_DAYS;
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('records a hello event with required fields', () => {
    const mod = freshModule();
    mod.recordLifecycleEvent({ kind: 'hello', outcome: 'ok', latency_ms: 42, status_code: 200, node_id: 'node_x' });
    const entries = mod.readLifecycleLog();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'hello');
    assert.equal(entries[0].outcome, 'ok');
    assert.equal(entries[0].latency_ms, 42);
    assert.equal(entries[0].status_code, 200);
    assert.equal(entries[0].node_id, 'node_x');
    assert.ok(entries[0].ts);
  });

  it('skips writes when EVOLVER_LIFECYCLE_LOG=off', () => {
    process.env.EVOLVER_LIFECYCLE_LOG = 'off';
    const mod = freshModule();
    mod.recordLifecycleEvent({ kind: 'heartbeat', outcome: 'ok' });
    assert.equal(mod.readLifecycleLog().length, 0);
  });

  it('auto-disables under node:test unless force-enabled', () => {
    delete process.env.EVOLVER_LIFECYCLE_LOG_FORCE;
    const mod = freshModule();
    mod.recordLifecycleEvent({ kind: 'hello', outcome: 'ok' });
    assert.equal(mod.readLifecycleLog().length, 0);
  });

  it('applyRetention drops entries beyond maxLines', () => {
    const mod = freshModule();
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ ts: new Date(Date.now() - i * 1000).toISOString(), kind: 'heartbeat', outcome: 'ok' })
    );
    const kept = mod.applyRetention(lines, 0, 4);
    assert.equal(kept.length, 4);
    assert.equal(kept[0], lines[lines.length - 4]);
    assert.equal(kept[3], lines[lines.length - 1]);
  });

  it('applyRetention drops entries older than maxDays', () => {
    const mod = freshModule();
    const oldTs = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const newTs = new Date().toISOString();
    const lines = [
      JSON.stringify({ ts: oldTs, kind: 'hello', outcome: 'ok' }),
      JSON.stringify({ ts: newTs, kind: 'heartbeat', outcome: 'ok' }),
    ];
    const kept = mod.applyRetention(lines, 30, 0);
    assert.equal(kept.length, 1);
    assert.match(kept[0], /heartbeat/);
  });

  it('trimLog rewrites file when over maxLines', () => {
    process.env.EVOLVER_LIFECYCLE_LOG_MAX_LINES = '3';
    const mod = freshModule();
    for (let i = 0; i < 8; i++) {
      mod.recordLifecycleEvent({ kind: 'heartbeat', outcome: 'ok', latency_ms: i });
    }
    mod.trimLog(mod.getLogPath());
    const remaining = mod.readLifecycleLog();
    assert.equal(remaining.length, 3);
    assert.deepEqual(remaining.map((e) => e.latency_ms), [5, 6, 7]);
  });

  it('readLifecycleLog filters by kind and last', () => {
    const mod = freshModule();
    mod.recordLifecycleEvent({ kind: 'hello', outcome: 'ok' });
    mod.recordLifecycleEvent({ kind: 'heartbeat', outcome: 'ok', latency_ms: 1 });
    mod.recordLifecycleEvent({ kind: 'heartbeat', outcome: 'ok', latency_ms: 2 });
    mod.recordLifecycleEvent({ kind: 'fetch', outcome: 'fail', error: 'boom' });

    const heartbeats = mod.readLifecycleLog({ kind: 'heartbeat' });
    assert.equal(heartbeats.length, 2);

    const lastTwo = mod.readLifecycleLog({ last: 2 });
    assert.equal(lastTwo.length, 2);
    assert.equal(lastTwo[1].kind, 'fetch');
  });
});
