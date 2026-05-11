'use strict';

// Observability facade — single entry point for span/event recording across
// the evolve pipeline, dispatch, solidify, proxy lifecycle, and a2a calls.
//
// Design contract:
//   - exportable attributes/events are eligible for OTLP export.
//   - local_only payloads (prompt text, hub response body) are written to the
//     local JSONL only and MUST never appear in any OTLP-bound serialization.
//   - The facade owns sanitization of both buckets at write time so callers
//     cannot accidentally smuggle secrets through unguarded paths.
//   - All write paths are best-effort: failures are logged and swallowed so
//     observability never breaks the evolve pipeline (Rule c4 §1 exception:
//     observability infra is explicitly allowed to safe-ignore with comment).

const {
  newTraceId,
  newSpanId,
  isValidTraceId,
  isValidSpanId,
} = require('./ids');
const { runWithContext, getCurrentContext, getCurrentTraceId, getCurrentSpanId } = require('./context');
const { sanitizeExportable, sanitizeLocalOnlyValue, getLocalOnlyEnabled } = require('./sanitize');
const { appendSpanRecord } = require('./localStore');

function logFacadeError(action, err) {
  // Observability MUST NOT throw into the evolve pipeline. Best-effort log.
  // [observability] prefix per rule c4 §2 for grep.
  const message = err && err.message ? err.message : String(err);
  try {
    process.stderr.write(`[observability] ${action} failed: ${message}\n`);
  } catch {
    // Even stderr can fail (closed handle); intentionally swallow.
  }
}

function resolveParent(context) {
  if (context && isValidTraceId(context.traceId) && isValidSpanId(context.spanId)) {
    return { traceId: context.traceId, parentSpanId: context.spanId };
  }
  const current = getCurrentContext();
  if (current && current.traceId) {
    return { traceId: current.traceId, parentSpanId: current.spanId || null };
  }
  return { traceId: newTraceId(), parentSpanId: null };
}

function buildSpanHandle(name, options = {}) {
  const { traceId, parentSpanId } = resolveParent(options.context);
  const spanId = newSpanId();
  const startTs = Date.now();
  return {
    traceId,
    spanId,
    parentSpanId,
    name: String(name || 'unnamed'),
    startTs,
    exportable: {},
    localOnly: {},
    events: [],
    closed: false,
  };
}

function setExportableAttribute(handle, key, value) {
  if (!handle || handle.closed) return;
  if (typeof key !== 'string' || !key) return;
  try {
    const sanitized = sanitizeExportable(value);
    handle.exportable[key] = sanitized;
  } catch (err) {
    logFacadeError('setExportableAttribute', err);
  }
}

function setExportableAttributes(handle, kv) {
  if (!kv || typeof kv !== 'object') return;
  for (const [k, v] of Object.entries(kv)) setExportableAttribute(handle, k, v);
}

function setLocalOnlyPayload(handle, key, value) {
  if (!handle || handle.closed) return;
  if (typeof key !== 'string' || !key) return;
  if (!getLocalOnlyEnabled()) return;
  try {
    const sanitized = sanitizeLocalOnlyValue(key, value);
    if (sanitized === undefined) return;
    handle.localOnly[key] = sanitized;
  } catch (err) {
    logFacadeError('setLocalOnlyPayload', err);
  }
}

function addExportableEvent(handle, name, attributes) {
  if (!handle || handle.closed) return;
  if (typeof name !== 'string' || !name) return;
  try {
    const sanitized = attributes && typeof attributes === 'object'
      ? sanitizeExportable(attributes)
      : undefined;
    handle.events.push({
      name,
      ts: new Date().toISOString(),
      ...(sanitized ? { attributes: sanitized } : {}),
    });
  } catch (err) {
    logFacadeError('addExportableEvent', err);
  }
}

function endSpan(handle, options = {}) {
  if (!handle || handle.closed) return null;
  const endTs = Date.now();
  const durationMs = Math.max(0, endTs - handle.startTs);
  const status = options.status || (options.error ? 'error' : 'ok');
  // Error attributes must be set BEFORE flipping `closed`, otherwise the
  // setExportableAttribute guard short-circuits silently.
  if (options.error) {
    setExportableAttribute(handle, 'error', true);
    const message = options.error && options.error.message ? options.error.message : String(options.error);
    setExportableAttribute(handle, 'error.message', message);
  }
  handle.closed = true;
  const record = {
    trace_id: handle.traceId,
    span_id: handle.spanId,
    parent_span_id: handle.parentSpanId,
    name: handle.name,
    start: new Date(handle.startTs).toISOString(),
    end: new Date(endTs).toISOString(),
    duration_ms: durationMs,
    status,
    exportable: handle.exportable,
    ...(Object.keys(handle.localOnly).length ? { local_only: handle.localOnly } : {}),
    ...(handle.events.length ? { events: handle.events } : {}),
  };
  try {
    appendSpanRecord(record);
  } catch (err) {
    logFacadeError('appendSpanRecord', err);
  }
  try {
    const exporter = getOtlpExporter();
    if (exporter && typeof exporter.onSpanEnd === 'function') {
      // Defensive strip layer 1: the OTLP exporter never sees local_only.
      // The exporter MUST also strip on its own (defense in depth), but
      // removing here means a buggy exporter cannot leak prompt/body even
      // accidentally.
      exporter.onSpanEnd(stripLocalOnlyForExport(record));
    }
  } catch (err) {
    logFacadeError('otlp.onSpanEnd', err);
  }
  return record;
}

function stripLocalOnlyForExport(record) {
  if (!record || typeof record !== 'object') return record;
  const { local_only: _ignored, ...rest } = record;
  return rest;
}

function startSpan(name, options = {}) {
  const handle = buildSpanHandle(name, options);
  if (options.exportable) setExportableAttributes(handle, options.exportable);
  if (options.localOnly) {
    for (const [k, v] of Object.entries(options.localOnly)) {
      setLocalOnlyPayload(handle, k, v);
    }
  }
  return handle;
}

function withSpan(name, options, fn) {
  if (typeof options === 'function') {
    fn = options;
    options = {};
  }
  const handle = startSpan(name, options);
  const run = () => fn(handle);
  const context = { traceId: handle.traceId, spanId: handle.spanId };
  let result;
  try {
    result = runWithContext(context, run);
  } catch (err) {
    endSpan(handle, { error: err });
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result
      .then((value) => {
        endSpan(handle);
        return value;
      })
      .catch((err) => {
        endSpan(handle, { error: err });
        throw err;
      });
  }
  endSpan(handle);
  return result;
}

// OTLP exporter is injected by the optional sdk module; absent by default.
let otlpExporter = null;
function registerOtlpExporter(exporter) {
  otlpExporter = exporter || null;
}
function getOtlpExporter() {
  return otlpExporter;
}

async function shutdown() {
  const exporter = getOtlpExporter();
  if (exporter && typeof exporter.shutdown === 'function') {
    try {
      await exporter.shutdown();
    } catch (err) {
      logFacadeError('otlp.shutdown', err);
    }
  }
}

module.exports = {
  startSpan,
  endSpan,
  withSpan,
  setExportableAttribute,
  setExportableAttributes,
  setLocalOnlyPayload,
  addExportableEvent,
  getCurrentTraceId,
  getCurrentSpanId,
  registerOtlpExporter,
  stripLocalOnlyForExport,
  shutdown,
};
