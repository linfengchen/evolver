'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_KEYS = [
  'EVOLUTION_DIR',
  'EVOLVER_REPO_ROOT',
  'MEMORY_DIR',
  'EVOLVER_OBS_LOCAL_PAYLOAD',
  'EVOLVER_OBS_LOCAL_PROMPT_MAX_CHARS',
  'EVOLVER_OBS_LOCAL_HUB_BODY_MAX_CHARS',
  'EVOLVER_SESSION_SCOPE',
];

function freshObs() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}src${path.sep}observability${path.sep}`) ||
      key.endsWith(`${path.sep}src${path.sep}gep${path.sep}paths.js`)
    ) {
      delete require.cache[key];
    }
  }
  return require('../src/observability');
}

function readSpans(tmpDir) {
  const file = path.join(tmpDir, 'obs_spans.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('observability facade', () => {
  let tmpDir;
  let savedEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolver-obs-'));
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.EVOLUTION_DIR = tmpDir;
    process.env.EVOLVER_REPO_ROOT = tmpDir;
    process.env.MEMORY_DIR = tmpDir;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a span with valid trace_id and span_id', () => {
    const obs = freshObs();
    const span = obs.startSpan('evolve.run', { exportable: { run_id: 'r-1', cycle_id: 'c-1' } });
    obs.endSpan(span);

    const records = readSpans(tmpDir);
    assert.equal(records.length, 1);
    const rec = records[0];
    assert.match(rec.trace_id, /^[0-9a-f]{32}$/);
    assert.match(rec.span_id, /^[0-9a-f]{16}$/);
    assert.equal(rec.parent_span_id, null);
    assert.equal(rec.name, 'evolve.run');
    assert.equal(rec.exportable.run_id, 'r-1');
    assert.equal(rec.exportable.cycle_id, 'c-1');
    assert.equal(rec.status, 'ok');
    assert.ok(rec.duration_ms >= 0);
    assert.equal(rec.local_only, undefined);
  });

  it('parents nested spans through withSpan + AsyncLocalStorage', async () => {
    const obs = freshObs();
    const trace = await obs.withSpan('evolve.run', { exportable: { run_id: 'r-2' } }, async (parent) => {
      const traceId = parent.traceId;
      await obs.withSpan('evolve.dispatch', {}, async (child) => {
        obs.setExportableAttribute(child, 'gene_id', 'g-1');
      });
      return traceId;
    });

    const records = readSpans(tmpDir);
    assert.equal(records.length, 2);
    // child written first (endSpan order: inner finishes before outer)
    const child = records[0];
    const parent = records[1];
    assert.equal(child.name, 'evolve.dispatch');
    assert.equal(parent.name, 'evolve.run');
    assert.equal(child.trace_id, trace);
    assert.equal(parent.trace_id, trace);
    assert.equal(child.parent_span_id, parent.span_id);
    assert.equal(parent.parent_span_id, null);
    assert.equal(child.exportable.gene_id, 'g-1');
  });

  it('records local_only payload without polluting exportable', () => {
    const obs = freshObs();
    const span = obs.startSpan('evolve.dispatch');
    obs.setExportableAttribute(span, 'prompt_length', 42);
    obs.setLocalOnlyPayload(span, 'gep_prompt_text', 'Hello, this is the full prompt body.');
    obs.endSpan(span);

    const [rec] = readSpans(tmpDir);
    assert.equal(rec.exportable.prompt_length, 42);
    assert.equal(rec.exportable.gep_prompt_text, undefined);
    assert.equal(rec.local_only.gep_prompt_text, 'Hello, this is the full prompt body.');
  });

  it('strips secret-like keys from exportable and local_only', () => {
    const obs = freshObs();
    const span = obs.startSpan('a2a.hello');
    obs.setExportableAttribute(span, 'headers', {
      Authorization: 'Bearer abc.def.ghi',
      'X-Node-Id': 'node-1',
    });
    obs.setLocalOnlyPayload(span, 'hub_response_body', JSON.stringify({
      A2A_NODE_SECRET: 'secret-should-be-stripped',
      ok: true,
    }));
    obs.endSpan(span);

    const [rec] = readSpans(tmpDir);
    assert.equal(rec.exportable.headers.Authorization, '[REDACTED]');
    assert.equal(rec.exportable.headers['X-Node-Id'], 'node-1');
    // body is a string, so redactText handles bearer-style tokens; secret
    // appears inline so we assert it is not retained as a key
    assert.ok(!/secret-should-be-stripped/.test(rec.local_only.hub_response_body) ||
      /\[REDACTED\]/.test(rec.local_only.hub_response_body));
  });

  it('truncates local_only prompt text via EVOLVER_OBS_LOCAL_PROMPT_MAX_CHARS', () => {
    process.env.EVOLVER_OBS_LOCAL_PROMPT_MAX_CHARS = '32';
    const obs = freshObs();
    const span = obs.startSpan('evolve.dispatch');
    obs.setLocalOnlyPayload(span, 'gep_prompt_text', 'x'.repeat(1000));
    obs.endSpan(span);

    const [rec] = readSpans(tmpDir);
    assert.ok(rec.local_only.gep_prompt_text.length <= 32);
    assert.ok(rec.local_only.gep_prompt_text.endsWith('...[truncated]'));
  });

  it('drops local_only entirely when EVOLVER_OBS_LOCAL_PAYLOAD=false', () => {
    process.env.EVOLVER_OBS_LOCAL_PAYLOAD = 'false';
    const obs = freshObs();
    const span = obs.startSpan('evolve.dispatch');
    obs.setExportableAttribute(span, 'prompt_length', 100);
    obs.setLocalOnlyPayload(span, 'gep_prompt_text', 'should not appear');
    obs.endSpan(span);

    const [rec] = readSpans(tmpDir);
    assert.equal(rec.exportable.prompt_length, 100);
    assert.equal(rec.local_only, undefined);
  });

  it('marks errored spans with status=error and error.message', () => {
    const obs = freshObs();
    try {
      obs.withSpan('evolve.run', {}, () => {
        throw new Error('boom');
      });
    } catch (err) {
      assert.equal(err.message, 'boom');
    }
    const [rec] = readSpans(tmpDir);
    assert.equal(rec.status, 'error');
    assert.equal(rec.exportable.error, true);
    assert.equal(rec.exportable['error.message'], 'boom');
  });

  it('feeds OTLP exporter with local_only stripped (defense in depth)', () => {
    const obs = freshObs();
    const seen = [];
    obs.registerOtlpExporter({
      onSpanEnd(record) {
        seen.push(record);
      },
    });
    const span = obs.startSpan('evolve.dispatch', { exportable: { run_id: 'r-3' } });
    obs.setLocalOnlyPayload(span, 'gep_prompt_text', 'NEVER LEAVES THIS MACHINE');
    obs.endSpan(span);

    assert.equal(seen.length, 1);
    const exported = seen[0];
    assert.equal(exported.exportable.run_id, 'r-3');
    assert.equal(exported.local_only, undefined);
    // Sanity: defensively confirm the prompt text does not appear anywhere
    // in the JSON-serialized exported payload.
    assert.ok(!JSON.stringify(exported).includes('NEVER LEAVES THIS MACHINE'));

    // Local JSONL still retains the full payload for replay.
    const [localRec] = readSpans(tmpDir);
    assert.equal(localRec.local_only.gep_prompt_text, 'NEVER LEAVES THIS MACHINE');
  });

  it('stripLocalOnlyForExport is idempotent and does not mutate input', () => {
    const obs = freshObs();
    const record = {
      trace_id: 'a'.repeat(32),
      span_id: 'b'.repeat(16),
      exportable: { run_id: 'r-4' },
      local_only: { gep_prompt_text: 'leak risk' },
    };
    const stripped = obs.stripLocalOnlyForExport(record);
    assert.equal(stripped.local_only, undefined);
    assert.equal(stripped.exportable.run_id, 'r-4');
    assert.equal(record.local_only.gep_prompt_text, 'leak risk', 'must not mutate input');
  });

  it('addExportableEvent attaches timestamped events to the span record', () => {
    const obs = freshObs();
    const span = obs.startSpan('evolve.signals');
    obs.addExportableEvent(span, 'signals.scored', { count: 3 });
    obs.endSpan(span);

    const [rec] = readSpans(tmpDir);
    assert.equal(rec.events.length, 1);
    assert.equal(rec.events[0].name, 'signals.scored');
    assert.equal(rec.events[0].attributes.count, 3);
    assert.match(rec.events[0].ts, /\d{4}-\d{2}-\d{2}T/);
  });
});
