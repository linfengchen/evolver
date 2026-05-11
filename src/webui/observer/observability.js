'use strict';

// WebUI observer for obs_spans.jsonl. Exposes spans and trace-grouped
// timelines to the local WebUI (which only listens on 127.0.0.1, so it is the
// only consumer allowed to see local_only payloads such as prompt text or
// Hub response bodies).
//
// Network-facing endpoints (Jaeger / OTLP collector) must use the OTLP
// exporter path, not this module. That path strips local_only at the facade
// layer; see src/observability/index.js stripLocalOnlyForExport.

const { readSpanRecords } = require('../../observability/localStore');

function listObservabilitySpans(query = {}) {
  const limit = clampInt(query.limit, 500, 1, 5000);
  const traceFilter = trimOrNull(query.trace_id);
  const phaseFilter = trimOrNull(query.name);
  const records = readSpanRecords({ limit: traceFilter ? 5000 : limit });
  const filtered = records.filter((rec) => {
    if (traceFilter && rec.trace_id !== traceFilter) return false;
    if (phaseFilter && rec.name !== phaseFilter) return false;
    return true;
  });
  return {
    total: filtered.length,
    spans: filtered.map(asListItem),
  };
}

function getObservabilityTrace(traceId) {
  const id = trimOrNull(traceId);
  if (!id) return null;
  // Read the full file so deeply nested spans are not truncated by `limit`.
  const records = readSpanRecords({ limit: 0 }).filter((rec) => rec.trace_id === id);
  if (records.length === 0) return null;
  const spans = records.map(asTraceSpan).sort((a, b) => timeOf(a.start) - timeOf(b.start));
  return {
    trace_id: id,
    span_count: spans.length,
    start: spans[0].start,
    end: spans[spans.length - 1].end,
    spans,
  };
}

function asListItem(rec) {
  return {
    trace_id: rec.trace_id,
    span_id: rec.span_id,
    parent_span_id: rec.parent_span_id,
    name: rec.name,
    start: rec.start,
    end: rec.end,
    duration_ms: rec.duration_ms,
    status: rec.status,
    has_local_only: !!rec.local_only,
    exportable: rec.exportable || {},
  };
}

function asTraceSpan(rec) {
  return {
    trace_id: rec.trace_id,
    span_id: rec.span_id,
    parent_span_id: rec.parent_span_id,
    name: rec.name,
    start: rec.start,
    end: rec.end,
    duration_ms: rec.duration_ms,
    status: rec.status,
    exportable: rec.exportable || {},
    local_only: rec.local_only || null,
    events: rec.events || [],
  };
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function trimOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function timeOf(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : 0;
}

module.exports = {
  listObservabilitySpans,
  getObservabilityTrace,
};
