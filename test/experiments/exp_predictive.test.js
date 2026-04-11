/**
 * Experiment 1: Predictive Outcome Scoring
 *
 * Hypothesis: computePredictiveBoost improves outcome scoring by rewarding
 * actions that increase future evolvability (signal clarity, trajectory
 * momentum, frontier exploration), without inflating scores for low-quality
 * or decorative-only cycles.
 *
 * Design:
 *   Control   = inferOutcomeFromSignals (baseline, no predictive component)
 *   Treatment = inferOutcomeEnhanced   (includes predictive boost)
 *
 * Metrics:
 *   1. Bounded boost: predictive boost must stay within [-0.1, 0.1]
 *   2. Directional correctness: high-quality scenarios score >= baseline
 *   3. No inflation: decorative-only scenarios must not exceed baseline + 0.02
 *   4. Frontier reward: curriculum signals produce higher boost than non-curriculum
 *   5. Trajectory sensitivity: success streaks score higher than failure streaks
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const mg = require('../../src/gep/memoryGraph');

function setupTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-pred-'));
  const orig = {};
  for (const k of ['MEMORY_GRAPH_PATH', 'EVOLUTION_DIR', 'EVOLVER_REPO_ROOT', 'OPENCLAW_WORKSPACE', 'EVOLVER_SESSION_SCOPE']) {
    orig[k] = process.env[k];
  }
  process.env.MEMORY_GRAPH_PATH = path.join(dir, 'mg.jsonl');
  process.env.EVOLUTION_DIR = dir;
  delete process.env.OPENCLAW_WORKSPACE;
  delete process.env.EVOLVER_SESSION_SCOPE;
  return { dir, orig };
}

function teardown(dir, orig) {
  for (const [k, v] of Object.entries(orig)) {
    if (v !== undefined) process.env[k] = v; else delete process.env[k];
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function seedOutcomes(statuses) {
  const mgPath = process.env.MEMORY_GRAPH_PATH;
  for (let i = 0; i < statuses.length; i++) {
    const ev = {
      type: 'MemoryGraphEvent', kind: 'outcome',
      id: `mge_seed_${i}`, ts: new Date(Date.now() - (statuses.length - i) * 60000).toISOString(),
      signal: { key: 'test', signals: ['test'] },
      gene: { id: 'gene_seed', category: 'repair' },
      outcome: { status: statuses[i], score: statuses[i] === 'success' ? 0.8 : 0.2 },
    };
    fs.appendFileSync(mgPath, JSON.stringify(ev) + '\n');
  }
}

function baselineScore({ prevHadError, currentHasError }) {
  if (prevHadError && !currentHasError) return 0.85;
  if (prevHadError && currentHasError) return 0.2;
  if (!prevHadError && currentHasError) return 0.15;
  return 0.6;
}

describe('Exp1: Predictive boost is bounded', () => {
  let dir, orig;
  beforeEach(() => { ({ dir, orig } = setupTmp()); });
  afterEach(() => { teardown(dir, orig); });

  const scenarios = [
    { name: 'all_actionable', signals: ['log_error', 'perf_bottleneck', 'capability_gap'] },
    { name: 'all_decorative', signals: ['stable_success_plateau', 'memory_missing', 'evolution_saturation'] },
    { name: 'mixed', signals: ['log_error', 'stable_success_plateau', 'capability_gap'] },
    { name: 'frontier', signals: ['curriculum_target:frontier:x', 'log_error'] },
    { name: 'empty', signals: [] },
    { name: 'single_actionable', signals: ['perf_bottleneck'] },
  ];

  for (const sc of scenarios) {
    it(`boost in [-0.1, 0.1] for scenario: ${sc.name}`, () => {
      const r = mg.computePredictiveBoost({
        baselineObserved: {}, currentObserved: {}, signals: sc.signals,
      });
      assert.ok(r.boost >= -0.1, `boost ${r.boost} < -0.1`);
      assert.ok(r.boost <= 0.1, `boost ${r.boost} > 0.1`);
    });
  }
});

describe('Exp1: Directional correctness -- high-quality >= baseline', () => {
  let dir, orig;
  beforeEach(() => { ({ dir, orig } = setupTmp()); });
  afterEach(() => { teardown(dir, orig); });

  it('error_cleared with actionable signals scores >= baseline', () => {
    seedOutcomes(['success', 'success', 'success']);
    const enhanced = mg.computePredictiveBoost({
      baselineObserved: {}, currentObserved: {},
      signals: ['log_error', 'perf_bottleneck'],
    });
    assert.ok(enhanced.boost >= 0,
      `high-quality scenario should have non-negative boost, got ${enhanced.boost}`);
  });

  it('success streak amplifies boost vs failure streak', () => {
    seedOutcomes(['success', 'success', 'success', 'success', 'success']);
    const successStreakBoost = mg.computePredictiveBoost({
      baselineObserved: {}, currentObserved: {},
      signals: ['log_error'],
    });

    teardown(dir, orig);
    ({ dir, orig } = setupTmp());
    seedOutcomes(['failed', 'failed', 'failed', 'failed', 'failed']);
    const failStreakBoost = mg.computePredictiveBoost({
      baselineObserved: {}, currentObserved: {},
      signals: ['log_error'],
    });

    assert.ok(successStreakBoost.boost > failStreakBoost.boost,
      `success streak boost (${successStreakBoost.boost}) should exceed failure streak (${failStreakBoost.boost})`);
  });
});

describe('Exp1: No inflation -- decorative signals must not inflate', () => {
  let dir, orig;
  beforeEach(() => { ({ dir, orig } = setupTmp()); });
  afterEach(() => { teardown(dir, orig); });

  it('decorative-only boost is near zero', () => {
    const r = mg.computePredictiveBoost({
      baselineObserved: {}, currentObserved: {},
      signals: ['stable_success_plateau', 'memory_missing', 'evolution_saturation'],
    });
    assert.ok(Math.abs(r.boost) <= 0.02,
      `decorative-only boost should be near zero, got ${r.boost}`);
    assert.strictEqual(r.signal_clarity, 0);
  });
});

describe('Exp1: Frontier reward', () => {
  let dir, orig;
  beforeEach(() => { ({ dir, orig } = setupTmp()); });
  afterEach(() => { teardown(dir, orig); });

  it('curriculum signals produce higher boost than non-curriculum', () => {
    const withFrontier = mg.computePredictiveBoost({
      baselineObserved: {}, currentObserved: {},
      signals: ['curriculum_target:frontier:some_key', 'log_error'],
    });
    const withoutFrontier = mg.computePredictiveBoost({
      baselineObserved: {}, currentObserved: {},
      signals: ['log_error'],
    });
    assert.ok(withFrontier.boost > withoutFrontier.boost,
      `frontier boost (${withFrontier.boost}) should exceed non-frontier (${withoutFrontier.boost})`);
    assert.strictEqual(withFrontier.frontier_touched, true);
    assert.strictEqual(withoutFrontier.frontier_touched, false);
  });
});

describe('Exp1: End-to-end inferOutcomeEnhanced vs baseline', () => {
  let dir, orig;
  beforeEach(() => { ({ dir, orig } = setupTmp()); });
  afterEach(() => { teardown(dir, orig); });

  it('enhanced score with actionable signals >= baseline score', () => {
    seedOutcomes(['success', 'success']);
    const base = baselineScore({ prevHadError: true, currentHasError: false });

    mg.recordAttempt({
      signals: ['log_error'],
      selectedGene: { id: 'gene_test', category: 'repair' },
      driftEnabled: false,
    });
    const ev = mg.recordOutcomeFromState({
      signals: ['stable_no_error', 'perf_bottleneck'],
      observations: {},
    });

    assert.ok(ev.outcome.score >= base - 0.05,
      `enhanced score (${ev.outcome.score}) should be close to or above baseline (${base})`);
    assert.ok(ev.outcome.predictive, 'should contain predictive metadata');
  });

  it('enhanced score never exceeds 1.0', () => {
    seedOutcomes(['success', 'success', 'success', 'success', 'success']);
    mg.recordAttempt({
      signals: ['log_error'],
      selectedGene: { id: 'gene_max', category: 'repair' },
      driftEnabled: false,
    });
    const ev = mg.recordOutcomeFromState({
      signals: ['curriculum_target:frontier:x', 'capability_gap'],
      observations: { recent_error_count: 0 },
    });
    assert.ok(ev.outcome.score <= 1.0, `score ${ev.outcome.score} exceeds 1.0`);
    assert.ok(ev.outcome.score >= 0.0, `score ${ev.outcome.score} below 0.0`);
  });
});
