'use strict';

// Verifies that the pipeline event schema preserves the optional trace_id,
// span_id, parent_span_id, duration_ms fields end-to-end (write + read).

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_KEYS = ['EVOLUTION_DIR', 'EVOLVER_REPO_ROOT', 'MEMORY_DIR'];

function freshModule() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}src${path.sep}webui${path.sep}observer${path.sep}`) ||
        k.endsWith(`${path.sep}src${path.sep}gep${path.sep}paths.js`)) {
      delete require.cache[k];
    }
  }
  return require('../src/webui/observer/pipelineEvents');
}

describe('pipelineEvents schema (trace fields)', () => {
  let tmpDir;
  let saved;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-trace-'));
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

  it('round-trips trace_id / span_id / parent_span_id / duration_ms', () => {
    const { logPipelineEvent, readPipelineEvents } = freshModule();
    const traceId = 'a'.repeat(32);
    const spanId = 'b'.repeat(16);
    const parent = 'c'.repeat(16);

    logPipelineEvent({
      run_id: 'run-1',
      cycle_id: 'cycle-1',
      phase: 'evolve.signals',
      status: 'success',
      started_at: '2026-05-11T00:00:00.000Z',
      finished_at: '2026-05-11T00:00:01.000Z',
      duration_ms: 1000,
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parent,
      summary: 'signals=3',
    });

    const events = readPipelineEvents();
    assert.equal(events.length, 1);
    const ev = events[0];
    assert.equal(ev.phase, 'evolve.signals');
    assert.equal(ev.status, 'success');
    assert.equal(ev.trace_id, traceId);
    assert.equal(ev.span_id, spanId);
    assert.equal(ev.parent_span_id, parent);
    assert.equal(ev.duration_ms, 1000);
    assert.equal(ev.summary, 'signals=3');
  });

  it('coerces invalid trace/span identifiers to null', () => {
    const { logPipelineEvent, readPipelineEvents } = freshModule();
    logPipelineEvent({
      phase: 'evolve.hub',
      status: 'success',
      trace_id: 'not-hex',
      span_id: 'tooShort',
      parent_span_id: '0123456789abcdefg',
    });
    const [ev] = readPipelineEvents();
    assert.equal(ev.trace_id, null);
    assert.equal(ev.span_id, null);
    assert.equal(ev.parent_span_id, null);
  });

  it('omitted optional fields default to null/[]', () => {
    const { logPipelineEvent, readPipelineEvents } = freshModule();
    logPipelineEvent({ phase: 'evolve.collect', status: 'running' });
    const [ev] = readPipelineEvents();
    assert.equal(ev.trace_id, null);
    assert.equal(ev.span_id, null);
    assert.equal(ev.duration_ms, null);
    assert.deepEqual(ev.evidence_refs, []);
  });
});
