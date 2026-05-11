'use strict';

// Contract tests for the optional OTLP/HTTP-JSON exporter.
//
// The single most important assertion in this suite is the "no leak"
// guarantee: when a span carries a local_only payload (prompt, hub body)
// AND/OR an attribute key prefixed with `evolver.local.`, the bytes posted
// to the fake OTLP receiver MUST NOT contain those payloads. This pins
// down the plan's hard constraint: prompt / hub_response_body never go
// out over the network.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_KEYS = [
  'EVOLVER_OTEL_ENABLED',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_SERVICE_NAME',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'EVOLUTION_DIR',
  'EVOLVER_REPO_ROOT',
  'MEMORY_DIR',
];

function fresh() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}src${path.sep}observability${path.sep}`) ||
        k.endsWith(`${path.sep}src${path.sep}gep${path.sep}paths.js`)) {
      delete require.cache[k];
    }
  }
  return {
    otlp: require('../src/observability/otlp'),
    facade: require('../src/observability'),
  };
}

function startFakeReceiver({ statusCode = 200 } = {}) {
  let received = null;
  let receivedHeaders = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received = Buffer.concat(chunks).toString('utf8');
      receivedHeaders = req.headers;
      res.statusCode = statusCode;
      res.setHeader('Content-Type', 'application/json');
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}/v1/traces`,
        getReceived: () => received,
        getHeaders: () => receivedHeaders,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe('OTLP exporter', () => {
  let tmpDir;
  let saved;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-otlp-'));
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

  it('isEnabled is false by default and true with OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    const { otlp } = fresh();
    assert.equal(otlp.isEnabled(), false);
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    assert.equal(otlp.isEnabled(), true);
    process.env.EVOLVER_OTEL_ENABLED = 'false';
    assert.equal(otlp.isEnabled(), false);
  });

  it('CONTRACT: posted OTLP payload never contains local_only payloads', async () => {
    const receiver = await startFakeReceiver();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = receiver.url.replace('/v1/traces', '');
    process.env.EVOLVER_OTEL_ENABLED = 'true';
    process.env.OTEL_SERVICE_NAME = 'evolver-test';

    const { otlp, facade } = fresh();
    const exporter = otlp.setupOtlpFromEnv(facade);
    assert.ok(exporter, 'exporter must be created when env is set');

    // Emit a span with a fat local_only payload AND a sneaky `evolver.local.*`
    // exportable key that should be defensively stripped.
    const span = facade.startSpan('evolve.dispatch', {
      exportable: {
        run_id: 'r-1',
        gene_id: 'g-1',
        prompt_length: 21,
        'evolver.local.smuggled': 'THIS SHOULD NEVER LEAVE THE MACHINE',
      },
    });
    facade.setLocalOnlyPayload(span, 'gep_prompt_text', 'TOP_SECRET_PROMPT_BODY');
    facade.setLocalOnlyPayload(span, 'hub_response_body', '{"A2A_NODE_SECRET":"shhh"}');
    facade.endSpan(span);

    await exporter.shutdown();
    await receiver.close();

    const body = receiver.getReceived();
    assert.ok(body, 'fake receiver must have received a body');
    assert.ok(!body.includes('TOP_SECRET_PROMPT_BODY'), 'prompt body must not leak via OTLP');
    assert.ok(!body.includes('A2A_NODE_SECRET'), 'secret must not leak via OTLP');
    assert.ok(!body.includes('gep_prompt_text'), 'local_only key name must not appear');
    assert.ok(!body.includes('hub_response_body'), 'local_only key name must not appear');
    assert.ok(!body.includes('THIS SHOULD NEVER LEAVE THE MACHINE'),
      'evolver.local.* attributes must be stripped defensively');

    // Conversely, exportable metadata SHOULD appear.
    assert.ok(body.includes('r-1'), 'run_id must appear in OTLP body');
    assert.ok(body.includes('g-1'), 'gene_id must appear in OTLP body');
    assert.ok(body.includes('evolver-test'), 'service.name must appear');
  });

  it('builds an OTLP request body with attributes in the spec format', () => {
    const { otlp } = fresh();
    const body = otlp.buildOtlpRequestBody([
      {
        trace_id: 'a'.repeat(32),
        span_id: 'b'.repeat(16),
        parent_span_id: null,
        name: 'evolve.run',
        start: '2026-05-11T00:00:00.000Z',
        end: '2026-05-11T00:00:01.000Z',
        duration_ms: 1000,
        status: 'ok',
        exportable: { cycle_id: 'c1', count: 3, drift: true },
        events: [{ name: 'stage.done', ts: '2026-05-11T00:00:00.500Z', attributes: { duration_ms: 500 } }],
      },
    ], 'evolver-test');

    const span = body.resourceSpans[0].scopeSpans[0].spans[0];
    assert.equal(span.name, 'evolve.run');
    assert.equal(span.traceId, 'a'.repeat(32));
    assert.equal(span.spanId, 'b'.repeat(16));
    const attrMap = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
    assert.equal(attrMap.cycle_id.stringValue, 'c1');
    assert.equal(attrMap.count.intValue, '3');
    assert.equal(attrMap.drift.boolValue, true);
    assert.equal(span.events.length, 1);
    assert.equal(span.events[0].name, 'stage.done');
  });

  it('drops attributes prefixed with evolver.local.* from OTLP attributes list', () => {
    const { otlp } = fresh();
    const attrs = otlp.toOtlpAttributes({
      run_id: 'r-1',
      'evolver.local.hidden': 'should not appear',
      gene_id: 'g-1',
    });
    const keys = attrs.map((a) => a.key);
    assert.ok(keys.includes('run_id'));
    assert.ok(keys.includes('gene_id'));
    assert.ok(!keys.includes('evolver.local.hidden'));
  });

  it('setupOtlpFromEnv returns null when not enabled', () => {
    const { otlp, facade } = fresh();
    const exporter = otlp.setupOtlpFromEnv(facade);
    assert.equal(exporter, null);
  });
});
