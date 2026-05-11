'use strict';

// WebUI-side observer for obs_spans.jsonl: confirms the local API surfaces
// full local_only payloads (since the WebUI listens only on 127.0.0.1) while
// filtering and grouping correctly by trace_id / name.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_KEYS = ['EVOLUTION_DIR', 'EVOLVER_REPO_ROOT', 'MEMORY_DIR'];

function freshObserverModule() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}src${path.sep}webui${path.sep}observer${path.sep}`) ||
        k.includes(`${path.sep}src${path.sep}observability${path.sep}`) ||
        k.endsWith(`${path.sep}src${path.sep}gep${path.sep}paths.js`)) {
      delete require.cache[k];
    }
  }
  return require('../src/webui/observer');
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

describe('webui observability API', () => {
  let tmpDir;
  let saved;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-obs-api-'));
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.EVOLUTION_DIR = tmpDir;
    process.env.EVOLVER_REPO_ROOT = tmpDir;
    process.env.MEMORY_DIR = tmpDir;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  const traceA = 'a'.repeat(32);
  const traceB = 'b'.repeat(32);

  function seed(spans) {
    writeJsonl(path.join(tmpDir, 'obs_spans.jsonl'), spans);
  }

  it('lists spans newest-first and reports has_local_only flag', () => {
    seed([
      {
        trace_id: traceA, span_id: '1'.repeat(16), parent_span_id: null,
        name: 'evolve.run', start: '2026-05-11T00:00:00.000Z', end: '2026-05-11T00:00:01.000Z',
        duration_ms: 1000, status: 'ok',
        exportable: { cycle_id: 'c1' },
        local_only: { initial_user_prompt: 'do the thing' },
      },
      {
        trace_id: traceA, span_id: '2'.repeat(16), parent_span_id: '1'.repeat(16),
        name: 'evolve.dispatch', start: '2026-05-11T00:00:00.500Z', end: '2026-05-11T00:00:00.900Z',
        duration_ms: 400, status: 'ok',
        exportable: { prompt_length: 12 },
      },
    ]);

    const observer = freshObserverModule();
    const result = observer.listObservabilitySpans({});
    assert.equal(result.total, 2);
    const names = result.spans.map((s) => s.name);
    assert.deepEqual(names.sort(), ['evolve.dispatch', 'evolve.run']);
    const runSpan = result.spans.find((s) => s.name === 'evolve.run');
    assert.equal(runSpan.has_local_only, true);
    // The list view exposes exportable but not local_only directly, to keep
    // payloads small. Full local_only is fetched via the trace endpoint.
    assert.equal(runSpan.local_only, undefined);
    assert.equal(runSpan.exportable.cycle_id, 'c1');
  });

  it('filters by trace_id', () => {
    seed([
      { trace_id: traceA, span_id: '1'.repeat(16), name: 'evolve.run', start: '2026-05-11T00:00:00.000Z', exportable: {} },
      { trace_id: traceB, span_id: '2'.repeat(16), name: 'evolve.run', start: '2026-05-11T00:01:00.000Z', exportable: {} },
    ]);
    const observer = freshObserverModule();
    const result = observer.listObservabilitySpans({ trace_id: traceB });
    assert.equal(result.total, 1);
    assert.equal(result.spans[0].trace_id, traceB);
  });

  it('filters by span name', () => {
    seed([
      { trace_id: traceA, span_id: '1'.repeat(16), name: 'evolve.run', start: '2026-05-11T00:00:00.000Z', exportable: {} },
      { trace_id: traceA, span_id: '2'.repeat(16), name: 'evolve.dispatch', start: '2026-05-11T00:00:01.000Z', exportable: {} },
    ]);
    const observer = freshObserverModule();
    const result = observer.listObservabilitySpans({ name: 'evolve.dispatch' });
    assert.equal(result.total, 1);
    assert.equal(result.spans[0].name, 'evolve.dispatch');
  });

  it('returns a full timeline with local_only included for a single trace', () => {
    seed([
      {
        trace_id: traceA, span_id: '1'.repeat(16), parent_span_id: null,
        name: 'evolve.run', start: '2026-05-11T00:00:00.000Z', end: '2026-05-11T00:00:02.000Z',
        duration_ms: 2000, status: 'ok',
        exportable: { cycle_id: 'c1' },
        local_only: { initial_user_prompt: 'do the thing' },
      },
      {
        trace_id: traceA, span_id: '2'.repeat(16), parent_span_id: '1'.repeat(16),
        name: 'evolve.dispatch', start: '2026-05-11T00:00:00.500Z', end: '2026-05-11T00:00:01.500Z',
        duration_ms: 1000, status: 'ok',
        exportable: { gene_id: 'g1', prompt_length: 12 },
        local_only: { gep_prompt_text: 'FULL PROMPT TEXT BODY' },
      },
    ]);
    const observer = freshObserverModule();
    const trace = observer.getObservabilityTrace(traceA);
    assert.ok(trace);
    assert.equal(trace.trace_id, traceA);
    assert.equal(trace.span_count, 2);
    assert.equal(trace.spans[0].name, 'evolve.run');
    assert.equal(trace.spans[1].name, 'evolve.dispatch');
    assert.equal(trace.spans[1].local_only.gep_prompt_text, 'FULL PROMPT TEXT BODY');
    assert.equal(trace.spans[0].local_only.initial_user_prompt, 'do the thing');
  });

  it('returns null for unknown trace_id', () => {
    seed([
      { trace_id: traceA, span_id: '1'.repeat(16), name: 'evolve.run', start: '2026-05-11T00:00:00.000Z', exportable: {} },
    ]);
    const observer = freshObserverModule();
    assert.equal(observer.getObservabilityTrace(traceB), null);
    assert.equal(observer.getObservabilityTrace(''), null);
    assert.equal(observer.getObservabilityTrace(null), null);
  });
});
