'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const signals = require('../src/evolve/pipeline/signals');

// ---------------------------------------------------------------------------
// shouldSkipHubCalls
// ---------------------------------------------------------------------------
describe('shouldSkipHubCalls', () => {
  it('returns false for empty signals array', () => {
    assert.equal(signals.shouldSkipHubCalls([]), false);
  });

  it('returns false for non-array input', () => {
    assert.equal(signals.shouldSkipHubCalls(null), false);
    assert.equal(signals.shouldSkipHubCalls(undefined), false);
  });

  it('returns false when no saturation signal present', () => {
    assert.equal(signals.shouldSkipHubCalls(['log_error', 'capability_gap']), false);
  });

  it('returns true when only saturation signals', () => {
    assert.equal(signals.shouldSkipHubCalls(['force_steady_state']), true);
    assert.equal(signals.shouldSkipHubCalls(['evolution_saturation']), true);
    assert.equal(signals.shouldSkipHubCalls(['empty_cycle_loop_detected']), true);
  });

  it('returns false when log_error coexists with saturation', () => {
    assert.equal(signals.shouldSkipHubCalls(['evolution_saturation', 'log_error']), false);
  });

  it('returns false when external_task coexists with saturation', () => {
    assert.equal(signals.shouldSkipHubCalls(['evolution_saturation', 'external_task']), false);
  });

  it('returns false when bounty_task coexists with saturation', () => {
    assert.equal(signals.shouldSkipHubCalls(['evolution_saturation', 'bounty_task']), false);
  });

  it('returns false when errsig: prefix present with saturation', () => {
    assert.equal(signals.shouldSkipHubCalls(['force_steady_state', 'errsig:ReferenceError']), false);
  });

  it('returns false when user_feature_request with content coexists with saturation', () => {
    assert.equal(signals.shouldSkipHubCalls(['evolution_saturation', 'user_feature_request:some request']), false);
  });

  it('returns true when user_feature_request is empty (no real content)', () => {
    // string length <= 21 → no real request
    assert.equal(signals.shouldSkipHubCalls(['evolution_saturation', 'user_feature_request:']), true);
  });
});

// ---------------------------------------------------------------------------
// extractSignalsStage
// ---------------------------------------------------------------------------
describe('extractSignalsStage', () => {
  const baseCtx = {
    dormantHypothesis: null,
    recentMasterLog: '',
    todayLog: '',
    memorySnippet: '',
    userSnippet: '',
    lastHubFetchMs: 0,
  };

  it('returns ctx with genes, capsules, recentEvents, signals, skipHubCalls', async () => {
    const result = await signals.extractSignalsStage(baseCtx);
    assert.ok(Array.isArray(result.genes), 'genes should be an array');
    assert.ok(Array.isArray(result.capsules), 'capsules should be an array');
    assert.ok(Array.isArray(result.recentEvents), 'recentEvents should be an array');
    assert.ok(Array.isArray(result.signals), 'signals should be an array');
    assert.equal(typeof result.skipHubCalls, 'boolean');
  });

  it('preserves existing ctx fields', async () => {
    const ctx = { ...baseCtx, cycleNum: 42, someField: 'hello' };
    const result = await signals.extractSignalsStage(ctx);
    assert.equal(result.cycleNum, 42);
    assert.equal(result.someField, 'hello');
  });

  it('injects dormant hypothesis signals into output signals', async () => {
    const ctx = {
      ...baseCtx,
      dormantHypothesis: { signals: ['my_dormant_signal', 'another_dormant'] },
    };
    const result = await signals.extractSignalsStage(ctx);
    assert.ok(result.signals.includes('my_dormant_signal'), 'dormant signal should be injected');
    assert.ok(result.signals.includes('another_dormant'), 'dormant signal should be injected');
  });

  it('does not duplicate dormant signals already present', async () => {
    // extractSignals may or may not produce signals that overlap; the dedup logic
    // should ensure no duplicates from dormant injection.
    const ctx = {
      ...baseCtx,
      dormantHypothesis: { signals: ['dup_signal', 'dup_signal'] },
    };
    const result = await signals.extractSignalsStage(ctx);
    const count = result.signals.filter(s => s === 'dup_signal').length;
    assert.ok(count <= 1, 'dormant signal should not be added twice');
  });

  it('skipHubCalls is false when lastHubFetchMs is 0 (never fetched)', async () => {
    // Even if saturation signal is somehow present, lastHubFetchMs=0 means no gating
    const result = await signals.extractSignalsStage({ ...baseCtx, lastHubFetchMs: 0 });
    assert.equal(result.skipHubCalls, false);
  });
});
