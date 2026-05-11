'use strict';

// Minimal OTLP/HTTP-JSON exporter. We deliberately implement a thin client
// rather than pull in @opentelemetry/sdk-node so the production binary stays
// lean (rule c5 §3). Spec reference:
//   https://opentelemetry.io/docs/specs/otlp/#otlphttp
//
// HARD CONTRACT (verified by the contract test):
//   - This exporter receives records that have already been stripped of
//     local_only at the facade layer (defense in depth layer 1).
//   - It additionally drops every attribute prefixed with `evolver.local.`
//     before serializing, in case a future caller sets one (layer 2).
//   - The serialized OTLP body MUST NOT contain prompt or Hub-response
//     strings. The contract test boots a fake receiver and asserts on the
//     raw request body bytes.

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_BATCH_LIMIT = 256;
const SERVICE_NAME_DEFAULT = 'evolver';

function isEnabled() {
  const flag = String(process.env.EVOLVER_OTEL_ENABLED || '').toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on') return true;
  // Allow auto-enable when the endpoint is set, per OTel conventions.
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT && flag !== 'false' && flag !== '0') return true;
  return false;
}

function getEndpoint() {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (!raw) return null;
  // OTel conventions: if user gives a base URL, traces are at /v1/traces.
  if (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) return raw.replace(/\/+$/, '');
  return raw.replace(/\/+$/, '') + '/v1/traces';
}

function getServiceName() {
  return process.env.OTEL_SERVICE_NAME || SERVICE_NAME_DEFAULT;
}

function parseHeaders() {
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (!raw) return {};
  const out = {};
  for (const pair of raw.split(',')) {
    const [k, ...rest] = pair.split('=');
    if (!k) continue;
    out[k.trim()] = rest.join('=').trim();
  }
  return out;
}

function isoToUnixNano(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '0';
  // Use BigInt so the string representation has no scientific notation.
  return (BigInt(ms) * 1000000n).toString();
}

function toOtlpAttributeValue(value) {
  if (value === null || value === undefined) return { stringValue: '' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  // Arrays / objects are flattened to JSON strings — sufficient for the
  // exportable attributes we emit today.
  try {
    return { stringValue: JSON.stringify(value) };
  } catch {
    return { stringValue: String(value) };
  }
}

function toOtlpAttributes(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    // Defense-in-depth layer 2: any caller-set `evolver.local.*` attribute
    // is dropped before reaching the OTLP wire format.
    if (typeof key === 'string' && key.startsWith('evolver.local.')) continue;
    out.push({ key, value: toOtlpAttributeValue(value) });
  }
  return out;
}

function toOtlpSpan(record) {
  return {
    traceId: record.trace_id,
    spanId: record.span_id,
    parentSpanId: record.parent_span_id || undefined,
    name: record.name,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: isoToUnixNano(record.start),
    endTimeUnixNano: isoToUnixNano(record.end),
    attributes: toOtlpAttributes(record.exportable),
    events: Array.isArray(record.events) ? record.events.map((evt) => ({
      timeUnixNano: isoToUnixNano(evt.ts),
      name: evt.name,
      attributes: toOtlpAttributes(evt.attributes),
    })) : [],
    status: record.status === 'error' ? { code: 2, message: record.exportable && record.exportable['error.message'] || '' } : { code: 1 },
  };
}

function buildOtlpRequestBody(records, serviceName) {
  return {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: serviceName } },
        ],
      },
      scopeSpans: [{
        scope: { name: 'evolver-observability', version: '0.1.0' },
        spans: records.map(toOtlpSpan),
      }],
    }],
  };
}

function postJson(endpoint, headers, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(endpoint);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = lib.request({
      method: 'POST',
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: text });
        } else {
          reject(new Error(`OTLP exporter HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('OTLP exporter request timed out')));
    req.write(body);
    req.end();
  });
}

function createOtlpExporter(options = {}) {
  const endpoint = options.endpoint || getEndpoint();
  if (!endpoint) return null;
  const serviceName = options.serviceName || getServiceName();
  const headers = options.headers || parseHeaders();
  const flushIntervalMs = options.flushIntervalMs || DEFAULT_FLUSH_INTERVAL_MS;
  const batchLimit = options.batchLimit || DEFAULT_BATCH_LIMIT;
  const timeoutMs = options.timeoutMs || 10000;

  const queue = [];
  let timer = null;
  let stopped = false;

  function scheduleFlush() {
    if (stopped) return;
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, flushIntervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  async function flush() {
    if (queue.length === 0) return;
    const drained = queue.splice(0, queue.length);
    const body = buildOtlpRequestBody(drained, serviceName);
    try {
      await postJson(endpoint, headers, body, timeoutMs);
    } catch (err) {
      // [observability] prefix per c4 §2; failures are best-effort.
      process.stderr.write(`[observability] otlp flush failed: ${err && err.message ? err.message : err}\n`);
    }
  }

  function onSpanEnd(record) {
    if (stopped || !record) return;
    queue.push(record);
    if (queue.length >= batchLimit) {
      flush().catch(() => {});
    } else {
      scheduleFlush();
    }
  }

  async function shutdown() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await flush();
  }

  return { onSpanEnd, shutdown, _internal: { buildOtlpRequestBody: () => buildOtlpRequestBody(queue.slice(), serviceName), queue } };
}

function setupOtlpFromEnv(facade) {
  if (!isEnabled()) return null;
  const exporter = createOtlpExporter();
  if (!exporter) return null;
  if (facade && typeof facade.registerOtlpExporter === 'function') {
    facade.registerOtlpExporter(exporter);
  }
  return exporter;
}

module.exports = {
  isEnabled,
  getEndpoint,
  getServiceName,
  createOtlpExporter,
  setupOtlpFromEnv,
  buildOtlpRequestBody,
  toOtlpAttributes,
};
