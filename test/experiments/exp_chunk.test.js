/**
 * Experiment 3: Multi-Gene Chunk Execution
 *
 * Hypothesis: selectMultiGeneChunk selects multiple non-conflicting genes per
 * cycle, increasing throughput without introducing interference. The Jaccard
 * conflict detector correctly prevents co-selection of genes that operate on
 * overlapping signal spaces.
 *
 * Design:
 *   Control   = selectGeneAndCapsule (single gene per cycle)
 *   Treatment = selectMultiGeneChunk (up to 3 genes per cycle)
 *
 * Metrics:
 *   1. Throughput: treatment selects >= 1 gene on average (never fewer than control)
 *   2. Conflict safety: no pair in a chunk has Jaccard >= 0.3
 *   3. Coverage: chunk covers more unique signals than single selection
 *   4. Degradation guard: single-signal input still selects exactly 1 gene
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  selectGene, selectMultiGeneChunk,
} = require('../../src/gep/selector');

const DIVERSE_GENES = [
  {
    type: 'Gene', id: 'gene_error_handler', category: 'repair',
    signals_match: ['log_error', 'exception', 'stack_trace', 'crash'],
  },
  {
    type: 'Gene', id: 'gene_perf_optimizer', category: 'optimize',
    signals_match: ['latency', 'throughput', 'slow_query', 'memory_high'],
  },
  {
    type: 'Gene', id: 'gene_security_patch', category: 'repair',
    signals_match: ['vulnerability', 'cve_detected', 'dependency_audit'],
  },
  {
    type: 'Gene', id: 'gene_error_logger', category: 'repair',
    signals_match: ['log_error', 'exception', 'missing_log', 'crash'],
  },
  {
    type: 'Gene', id: 'gene_feature_builder', category: 'innovate',
    signals_match: ['capability_gap', 'feature_request', 'user_feedback'],
  },
  {
    type: 'Gene', id: 'gene_config_tuner', category: 'optimize',
    execution_mode: 'inplace',
    signals_match: ['timeout', 'config_drift', 'threshold_exceeded'],
  },
];

function computeJaccard(geneA, geneB) {
  const setA = new Set((geneA.signals_match || []).map(s => s.toLowerCase()));
  const setB = new Set((geneB.signals_match || []).map(s => s.toLowerCase()));
  if (setA.size === 0 && setB.size === 0) return 0;
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  return inter / (setA.size + setB.size - inter);
}

const defaultAdvice = { bannedGeneIds: new Set(), preferredGeneId: null, totalAttempts: 0 };

describe('Exp3: Throughput -- chunk selects >= control', () => {
  it('multi-signal input produces multiple genes', () => {
    const signals = ['log_error', 'latency', 'capability_gap', 'timeout'];
    const chunk = selectMultiGeneChunk({
      genes: DIVERSE_GENES, signals, memoryAdvice: defaultAdvice, driftEnabled: false,
    });
    const single = selectGene(DIVERSE_GENES, signals, {});

    assert.ok(chunk.genes.length >= 1, 'chunk must select at least 1 gene');
    assert.ok(chunk.genes.length > 1,
      `chunk should select >1 gene for diverse signals, got ${chunk.genes.length}`);
    assert.ok(single.selected, 'control must select 1 gene');
  });

  it('single-signal input still selects exactly 1 gene', () => {
    const signals = ['vulnerability'];
    const chunk = selectMultiGeneChunk({
      genes: DIVERSE_GENES, signals, memoryAdvice: defaultAdvice, driftEnabled: false,
    });
    assert.strictEqual(chunk.genes.length, 1);
    assert.strictEqual(chunk.genes[0].id, 'gene_security_patch');
  });
});

describe('Exp3: Conflict safety -- no high-overlap pairs in chunk', () => {
  it('gene_error_handler and gene_error_logger are NOT both selected', () => {
    const j = computeJaccard(
      DIVERSE_GENES.find(g => g.id === 'gene_error_handler'),
      DIVERSE_GENES.find(g => g.id === 'gene_error_logger'),
    );
    assert.ok(j >= 0.3, `these genes should conflict (Jaccard=${j.toFixed(3)})`);

    const chunk = selectMultiGeneChunk({
      genes: DIVERSE_GENES,
      signals: ['log_error', 'exception', 'latency', 'capability_gap'],
      memoryAdvice: defaultAdvice, driftEnabled: false,
    });

    const ids = chunk.genes.map(g => g.id);
    const bothPresent = ids.includes('gene_error_handler') && ids.includes('gene_error_logger');
    assert.ok(!bothPresent,
      `conflicting genes should not both appear in chunk: ${ids.join(', ')}`);
  });

  it('every pair in chunk has Jaccard < 0.3', () => {
    const signals = ['log_error', 'latency', 'capability_gap', 'timeout', 'vulnerability'];
    const N = 50;
    for (let trial = 0; trial < N; trial++) {
      const chunk = selectMultiGeneChunk({
        genes: DIVERSE_GENES, signals, memoryAdvice: defaultAdvice, driftEnabled: false,
      });
      for (let i = 0; i < chunk.genes.length; i++) {
        for (let j = i + 1; j < chunk.genes.length; j++) {
          const jac = computeJaccard(chunk.genes[i], chunk.genes[j]);
          assert.ok(jac < 0.3,
            `trial ${trial}: pair (${chunk.genes[i].id}, ${chunk.genes[j].id}) Jaccard=${jac.toFixed(3)} >= 0.3`);
        }
      }
    }
  });
});

describe('Exp3: Coverage -- chunk covers more signal space', () => {
  it('chunk covers more unique signal patterns than single selection', () => {
    const signals = ['log_error', 'latency', 'capability_gap', 'timeout'];
    const chunk = selectMultiGeneChunk({
      genes: DIVERSE_GENES, signals, memoryAdvice: defaultAdvice, driftEnabled: false,
    });
    const single = selectGene(DIVERSE_GENES, signals, {});

    const chunkPatterns = new Set();
    for (const g of chunk.genes) {
      for (const p of (g.signals_match || [])) chunkPatterns.add(p);
    }
    const singlePatterns = new Set(single.selected ? (single.selected.signals_match || []) : []);

    assert.ok(chunkPatterns.size >= singlePatterns.size,
      `chunk patterns (${chunkPatterns.size}) should cover >= single (${singlePatterns.size})`);
  });
});

describe('Exp3: Chunk max cap is respected', () => {
  it('never exceeds 3 genes regardless of input', () => {
    const signals = ['log_error', 'latency', 'capability_gap', 'timeout', 'vulnerability', 'config_drift'];
    const chunk = selectMultiGeneChunk({
      genes: DIVERSE_GENES, signals, memoryAdvice: defaultAdvice, driftEnabled: false,
    });
    assert.ok(chunk.genes.length <= 3, `chunk size ${chunk.genes.length} > 3`);
  });
});
