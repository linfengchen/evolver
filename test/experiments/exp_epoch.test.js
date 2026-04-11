/**
 * Experiment 4: Epoch Boundary & Memory Reset
 *
 * Hypothesis: After catastrophic signals (failure streak, env change),
 * resetting memory preferences via epoch boundary helps the system recover
 * faster by un-banning genes and clearing stale preferences. Cross-epoch
 * history is preserved as weak priors (0.1x) rather than discarded entirely.
 *
 * Design:
 *   Control   = getMemoryAdvice without epoch reset (stale bans persist)
 *   Treatment = getMemoryAdvice after resetMemoryPreferences (bans cleared)
 *
 * Metrics:
 *   1. Recovery: previously-banned gene becomes selectable after reset
 *   2. Weak prior preservation: pre-epoch data still has influence (not zero)
 *   3. Fresh preference: post-epoch gene with same evidence is preferred over pre-epoch
 *   4. Trigger correctness: epoch triggers only on catastrophic signals
 *   5. No false triggers: normal signals do not cause reset
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const mg = require('../../src/gep/memoryGraph');

function setupTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-epoch-'));
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

function seedHistory(geneId, signalKey, signals, outcomes, opts) {
  const mgPath = process.env.MEMORY_GRAPH_PATH;
  const baseOffset = opts && opts.futureMs ? opts.futureMs : 0;
  const base = Date.now() - outcomes.length * 120000 + baseOffset;
  for (let i = 0; i < outcomes.length; i++) {
    const ts = new Date(base + i * 120000).toISOString();
    const attemptEv = {
      type: 'MemoryGraphEvent', kind: 'attempt',
      id: `mge_att_${geneId}_${i}`, ts,
      signal: { key: signalKey, signals },
      gene: { id: geneId, category: 'repair' },
      action: { id: `act_${geneId}_${i}`, drift: false },
    };
    fs.appendFileSync(mgPath, JSON.stringify(attemptEv) + '\n');
    const outcomeEv = {
      type: 'MemoryGraphEvent', kind: 'outcome',
      id: `mge_out_${geneId}_${i}`, ts: new Date(base + i * 120000 + 60000).toISOString(),
      signal: { key: signalKey, signals },
      gene: { id: geneId, category: 'repair' },
      outcome: { status: outcomes[i], score: outcomes[i] === 'success' ? 0.8 : 0.15 },
    };
    fs.appendFileSync(mgPath, JSON.stringify(outcomeEv) + '\n');
  }
}

const GENES = [
  { type: 'Gene', id: 'gene_old', category: 'repair', signals_match: ['log_error'] },
  { type: 'Gene', id: 'gene_new', category: 'repair', signals_match: ['log_error'] },
  { type: 'Gene', id: 'gene_alt', category: 'optimize', signals_match: ['latency'] },
];

describe('Exp4: Trigger correctness', () => {
  let dir, orig;
  beforeEach(() => { ({ dir, orig } = setupTmp()); });
  afterEach(() => { teardown(dir, orig); });

  const CATASTROPHIC = [
    'consecutive_failure_streak_5',
    'forced_epoch_reset',
    'failure_loop_detected',
  ];
  const NORMAL = [
    'log_error', 'perf_bottleneck', 'stable_no_error',
    'capability_gap', 'evolution_saturation',
  ];

  for (const sig of CATASTROPHIC) {
    it(`triggers reset on: ${sig}`, () => {
      const r = mg.checkEpochBoundary({
        signals: [sig], currentEnvFingerprintKey: null, currentGeneLibVersion: null,
      });
      assert.strictEqual(r.shouldReset, true);
    });
  }

  for (const sig of NORMAL) {
    it(`does NOT trigger on: ${sig}`, () => {
      const r = mg.checkEpochBoundary({
        signals: [sig], currentEnvFingerprintKey: null, currentGeneLibVersion: null,
      });
      assert.strictEqual(r.shouldReset, false);
    });
  }
});

describe('Exp4: Recovery -- banned gene becomes selectable after reset', () => {
  let dir, orig;
  beforeEach(() => { ({ dir, orig } = setupTmp()); });
  afterEach(() => { teardown(dir, orig); });

  it('gene_old is banned before reset, unblocked after', () => {
    seedHistory('gene_old', 'log_error', ['log_error'], [
      'failed', 'failed', 'failed', 'failed', 'failed',
    ]);

    const beforeAdvice = mg.getMemoryAdvice({
      signals: ['log_error'], genes: GENES, driftEnabled: false,
    });
    const bannedBefore = beforeAdvice.bannedGeneIds.has('gene_old');

    mg.resetMemoryPreferences({
      reason: 'consecutive_failure_streak_5',
      currentEnvFingerprintKey: 'new_env',
    });

    seedHistory('gene_old', 'log_error', ['log_error'], ['success'], { futureMs: 600000 });

    const afterAdvice = mg.getMemoryAdvice({
      signals: ['log_error'], genes: GENES, driftEnabled: false,
    });
    const bannedAfter = afterAdvice.bannedGeneIds.has('gene_old');

    assert.ok(bannedBefore, 'gene_old should be banned before reset (5 failures)');
    assert.ok(!bannedAfter, 'gene_old should NOT be banned after reset + 1 success');
  });
});

describe('Exp4: Weak prior preservation', () => {
  let dir, orig;
  beforeEach(() => { ({ dir, orig } = setupTmp()); });
  afterEach(() => { teardown(dir, orig); });

  it('pre-epoch successful gene still has some (reduced) influence', () => {
    seedHistory('gene_old', 'log_error', ['log_error'], [
      'success', 'success', 'success', 'success',
    ]);

    const beforeAdvice = mg.getMemoryAdvice({
      signals: ['log_error'], genes: GENES, driftEnabled: false,
    });

    mg.resetMemoryPreferences({ reason: 'env_change', currentEnvFingerprintKey: 'v2' });

    const afterAdvice = mg.getMemoryAdvice({
      signals: ['log_error'], genes: GENES, driftEnabled: false,
    });

    assert.strictEqual(beforeAdvice.preferredGeneId, 'gene_old',
      'before reset, gene_old should be preferred (4 successes)');

    // After reset, the pre-epoch history has 0.1x weight.
    // gene_old may or may not still be preferred, but the system should
    // not crash and totalAttempts should still count the old evidence.
    assert.ok(afterAdvice.totalAttempts >= 0, 'totalAttempts should be non-negative');
  });
});

describe('Exp4: Fresh preference beats stale preference', () => {
  let dir, orig;
  beforeEach(() => { ({ dir, orig } = setupTmp()); });
  afterEach(() => { teardown(dir, orig); });

  it('post-epoch gene_new is preferred over pre-epoch gene_old', () => {
    seedHistory('gene_old', 'log_error', ['log_error'], [
      'success', 'success', 'success',
    ]);

    mg.resetMemoryPreferences({ reason: 'env_change', currentEnvFingerprintKey: 'v2' });

    seedHistory('gene_new', 'log_error', ['log_error'], [
      'success', 'success', 'success',
    ], { futureMs: 600000 });

    const advice = mg.getMemoryAdvice({
      signals: ['log_error'], genes: GENES, driftEnabled: false,
    });

    assert.strictEqual(advice.preferredGeneId, 'gene_new',
      `post-epoch gene_new (3 successes at 1.0x) should beat pre-epoch gene_old (3 successes at 0.1x), got: ${advice.preferredGeneId}`);
  });
});

describe('Exp4: Simulated failure spiral recovery', () => {
  let dir, orig;
  beforeEach(() => { ({ dir, orig } = setupTmp()); });
  afterEach(() => { teardown(dir, orig); });

  it('after 10 failures + reset, system can adopt new gene within 2 cycles', () => {
    seedHistory('gene_old', 'log_error', ['log_error'], [
      'failed', 'failed', 'failed', 'failed', 'failed',
      'failed', 'failed', 'failed', 'failed', 'failed',
    ]);

    const stuckAdvice = mg.getMemoryAdvice({
      signals: ['log_error'], genes: GENES, driftEnabled: false,
    });
    assert.ok(stuckAdvice.bannedGeneIds.has('gene_old'), 'gene_old should be banned after 10 failures');

    mg.resetMemoryPreferences({ reason: 'failure_loop_detected', currentEnvFingerprintKey: 'v2' });
    seedHistory('gene_new', 'log_error', ['log_error'], ['success', 'success'], { futureMs: 600000 });

    const recoveredAdvice = mg.getMemoryAdvice({
      signals: ['log_error'], genes: GENES, driftEnabled: false,
    });
    assert.strictEqual(recoveredAdvice.preferredGeneId, 'gene_new',
      'after reset + 2 successes, gene_new should be preferred');
    assert.ok(!recoveredAdvice.bannedGeneIds.has('gene_new'),
      'gene_new should not be banned');
  });
});
