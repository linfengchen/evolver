'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const select = require('../src/evolve/pipeline/select');

// ---------------------------------------------------------------------------
// computeAdaptiveStrategyPolicy
// ---------------------------------------------------------------------------
describe('computeAdaptiveStrategyPolicy', () => {
  it('returns an object with expected shape', () => {
    const policy = select.computeAdaptiveStrategyPolicy({ recentEvents: [], selectedGene: null, signals: [] });
    assert.ok(typeof policy.name === 'string');
    assert.ok(typeof policy.forceInnovate === 'boolean');
    assert.ok(typeof policy.cautiousExecution === 'boolean');
    assert.ok(typeof policy.blastRadiusMaxFiles === 'number');
    assert.ok(Array.isArray(policy.directives));
  });

  it('forces innovation after 3+ consecutive repair events', () => {
    const tail = Array.from({ length: 3 }, () => ({ intent: 'repair', outcome: { status: 'failed' } }));
    const policy = select.computeAdaptiveStrategyPolicy({
      recentEvents: tail,
      selectedGene: null,
      signals: [],
    });
    assert.equal(policy.forceInnovate, true);
  });

  it('does not force innovation when log_error present even with repair streak', () => {
    const tail = Array.from({ length: 3 }, () => ({ intent: 'repair', outcome: { status: 'failed' } }));
    const policy = select.computeAdaptiveStrategyPolicy({
      recentEvents: tail,
      selectedGene: null,
      signals: ['log_error'],
    });
    assert.equal(policy.forceInnovate, false);
  });

  it('sets cautiousExecution true after 2+ consecutive failures', () => {
    const tail = [
      { intent: 'optimize', outcome: { status: 'failed' } },
      { intent: 'optimize', outcome: { status: 'failed' } },
    ];
    const policy = select.computeAdaptiveStrategyPolicy({
      recentEvents: tail,
      selectedGene: null,
      signals: [],
    });
    assert.equal(policy.cautiousExecution, true);
  });

  it('caps blastRadiusMaxFiles at 6 when cautiousExecution', () => {
    const tail = Array.from({ length: 3 }, () => ({ intent: 'optimize', outcome: { status: 'failed' } }));
    const policy = select.computeAdaptiveStrategyPolicy({
      recentEvents: tail,
      selectedGene: { constraints: { max_files: 20 } },
      signals: ['log_error'],
    });
    assert.ok(policy.blastRadiusMaxFiles <= 6);
  });

  it('handles empty/null opts gracefully', () => {
    assert.doesNotThrow(() => select.computeAdaptiveStrategyPolicy({}));
    assert.doesNotThrow(() => select.computeAdaptiveStrategyPolicy(null));
    assert.doesNotThrow(() => select.computeAdaptiveStrategyPolicy(undefined));
  });
});

// ---------------------------------------------------------------------------
// selectAndMutate
// ---------------------------------------------------------------------------
describe('selectAndMutate', () => {
  const baseCtx = {
    genes: [],
    capsules: [],
    signals: [],
    recentEvents: [],
    memoryAdvice: null,
    recentFailedCapsules: [],
    heartbeatCapGaps: [],
    heartbeatNovelty: null,
    plateauOverride: null,
    observations: {
      agent: 'test',
      session_scope: null,
      drift_enabled: false,
      review_mode: false,
      dry_run: false,
      system_health: '',
      mood: null,
      scan_ms: 0,
      memory_size_bytes: 0,
      recent_error_count: 0,
      node: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      evidence: {},
    },
    IS_RANDOM_DRIFT: false,
    hubHit: null,
  };

  it('returns ctx with all expected selection fields', async () => {
    const result = await select.selectAndMutate(baseCtx);
    assert.ok('selectedGene' in result);
    assert.ok('strategyPolicy' in result);
    assert.ok('personalitySelection' in result);
    assert.ok('personalityState' in result);
    assert.ok('mutation' in result, 'mutation should be present');
    assert.ok('mutationInnovateMode' in result);
    assert.ok('hypothesisId' in result);
    assert.ok('selectedBy' in result);
    assert.ok(Array.isArray(result.capsulesUsed));
  });

  it('preserves existing ctx fields', async () => {
    const ctx = { ...baseCtx, cycleNum: 7, someField: 'preserved' };
    const result = await select.selectAndMutate(ctx);
    assert.equal(result.cycleNum, 7);
    assert.equal(result.someField, 'preserved');
  });

  it('sets mutationInnovateMode true when IS_RANDOM_DRIFT is true', async () => {
    const result = await select.selectAndMutate({ ...baseCtx, IS_RANDOM_DRIFT: true });
    assert.equal(result.mutationInnovateMode, true);
  });

  it('sets mutationInnovateMode true when FORCE_INNOVATION env is set', async () => {
    const orig = process.env.FORCE_INNOVATION;
    process.env.FORCE_INNOVATION = 'true';
    try {
      const result = await select.selectAndMutate(baseCtx);
      assert.equal(result.mutationInnovateMode, true);
    } finally {
      if (orig === undefined) delete process.env.FORCE_INNOVATION;
      else process.env.FORCE_INNOVATION = orig;
    }
  });

  it('mutation object is always present', async () => {
    const result = await select.selectAndMutate(baseCtx);
    assert.ok(result.mutation !== null && result.mutation !== undefined, 'mutation is mandatory');
  });
});
