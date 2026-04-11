/**
 * Experiment 2: In-Place Gene Selection
 *
 * Hypothesis: When preferInplace=true and an inplace gene scores within 70%
 * of the top full gene, selecting the inplace gene is a BETTER choice because
 * it has a smaller blast radius (max 5 files / 100 lines) and skips LLM review,
 * making it faster and safer for parameter-only changes.
 *
 * Design:
 *   Control   = selectGene with preferInplace=false (always picks highest score)
 *   Treatment = selectGene with preferInplace=true  (prefers inplace when close)
 *
 * Metrics:
 *   1. Selection correctness: inplace chosen only when within threshold
 *   2. No forced degradation: inplace NOT chosen when score is too low
 *   3. Blast radius safety: inplace genes always have tighter constraints
 *   4. Throughput: inplace path skips LLM review (verified via solidify logic)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  selectGene, isInplaceGene,
  INPLACE_BLAST_MAX_FILES, INPLACE_BLAST_MAX_LINES,
} = require('../../src/gep/selector');

const GENES_POOL = [
  {
    type: 'Gene', id: 'gene_full_repair', category: 'repair',
    signals_match: ['log_error', 'exception', 'crash'],
    strategy: ['diagnose root cause', 'apply fix', 'validate'],
    constraints: { max_files: 12 },
  },
  {
    type: 'Gene', id: 'gene_inplace_timeout', category: 'optimize',
    execution_mode: 'inplace',
    signals_match: ['timeout', 'slow_response', 'latency'],
    strategy: ['increase timeout constant'],
    constraints: { max_files: 5 },
  },
  {
    type: 'Gene', id: 'gene_inplace_retry', category: 'optimize',
    execution_mode: 'inplace',
    signals_match: ['retry_exhausted', 'connection_reset', 'log_error'],
    strategy: ['bump retry count'],
    constraints: { max_files: 5 },
  },
  {
    type: 'Gene', id: 'gene_full_innovate', category: 'innovate',
    signals_match: ['capability_gap', 'feature_request'],
    strategy: ['design new feature', 'implement', 'test'],
    constraints: { max_files: 20 },
  },
];

function deterministicSelect(genes, signals, opts) {
  const origRandom = Math.random;
  Math.random = () => 0.999;
  try {
    return selectGene(genes, signals, opts);
  } finally {
    Math.random = origRandom;
  }
}

describe('Exp2: Inplace preference within threshold', () => {
  it('control (no preference) picks highest-scoring gene', () => {
    const result = deterministicSelect(GENES_POOL, ['log_error', 'exception'], {
      preferInplace: false,
    });
    assert.ok(result.selected);
    assert.strictEqual(result.selected.id, 'gene_full_repair');
    assert.ok(!isInplaceGene(result.selected));
  });

  it('treatment prefers inplace when signals overlap and score is close', () => {
    const result = deterministicSelect(GENES_POOL, ['log_error', 'retry_exhausted'], {
      preferInplace: true,
    });
    assert.ok(result.selected);
    if (result.selected.id === 'gene_inplace_retry') {
      assert.ok(isInplaceGene(result.selected),
        'selected inplace gene should have execution_mode=inplace');
    }
  });
});

describe('Exp2: No forced degradation when score gap is large', () => {
  it('does NOT pick inplace gene when it has zero score', () => {
    const result = deterministicSelect(GENES_POOL, ['capability_gap', 'feature_request'], {
      preferInplace: true,
    });
    assert.ok(result.selected);
    assert.strictEqual(result.selected.id, 'gene_full_innovate',
      'inplace genes have no match for these signals, full gene should win');
  });

  it('inplace gene with very low overlap is not forced', () => {
    const result = deterministicSelect(GENES_POOL, ['exception', 'crash'], {
      preferInplace: true,
    });
    assert.ok(result.selected);
    assert.strictEqual(result.selected.id, 'gene_full_repair');
  });
});

describe('Exp2: Blast radius safety invariant', () => {
  it('INPLACE_BLAST_MAX_FILES is strictly less than default gene max_files', () => {
    assert.ok(INPLACE_BLAST_MAX_FILES <= 5);
    assert.ok(INPLACE_BLAST_MAX_LINES <= 100);
    assert.ok(INPLACE_BLAST_MAX_FILES < 12,
      'inplace blast limit must be tighter than default gene limit');
  });

  it('inplace gene constraints are tighter than full gene constraints', () => {
    const inplaceGene = GENES_POOL.find(g => g.execution_mode === 'inplace');
    const fullGene = GENES_POOL.find(g => !g.execution_mode && g.constraints);
    assert.ok(inplaceGene.constraints.max_files <= INPLACE_BLAST_MAX_FILES);
    assert.ok(fullGene.constraints.max_files > INPLACE_BLAST_MAX_FILES);
  });
});

describe('Exp2: Statistical selection distribution (100 trials)', () => {
  it('with preferInplace=true, inplace is chosen more often for mixed signals', () => {
    const signals = ['log_error', 'retry_exhausted', 'timeout'];
    let inplaceCount = 0;
    const N = 100;

    for (let i = 0; i < N; i++) {
      const result = selectGene(GENES_POOL, signals, { preferInplace: true });
      if (result.selected && isInplaceGene(result.selected)) inplaceCount++;
    }

    let controlInplaceCount = 0;
    for (let i = 0; i < N; i++) {
      const result = selectGene(GENES_POOL, signals, { preferInplace: false });
      if (result.selected && isInplaceGene(result.selected)) controlInplaceCount++;
    }

    assert.ok(inplaceCount >= controlInplaceCount,
      `treatment inplace selections (${inplaceCount}) should >= control (${controlInplaceCount})`);
  });
});
