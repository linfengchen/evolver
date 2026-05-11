'use strict';

// Append-only JSONL writer for finished spans. Lives next to pipeline_events
// in the evolution dir so all local observability artifacts are colocated.
// One line per span; payload shape:
//   { trace_id, span_id, parent_span_id, name, start, end, duration_ms,
//     status, exportable: {...}, local_only?: {...} }
// Callers MUST have already sanitized `exportable` and `local_only`; this
// module performs only structural normalization and disk I/O.

const fs = require('fs');
const path = require('path');
const { getEvolutionDir } = require('../gep/paths');

const FILE_NAME = 'obs_spans.jsonl';

function getObsSpansPath() {
  return path.join(getEvolutionDir(), FILE_NAME);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function appendSpanRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const normalized = normalizeRecord(record);
  if (!normalized) return null;
  const filePath = getObsSpansPath();
  ensureDir(filePath);
  fs.appendFileSync(filePath, JSON.stringify(normalized) + '\n', 'utf8');
  return normalized;
}

function readSpanRecords({ limit = 500 } = {}) {
  const filePath = getObsSpansPath();
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const slice = limit && limit > 0 ? lines.slice(-limit) : lines;
  const out = [];
  for (const raw of slice) {
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Skip malformed lines silently to avoid breaking the observability UI;
      // the source-of-truth recovery path is to drop and replay from pipeline events.
    }
  }
  return out;
}

function normalizeRecord(input) {
  if (!input.trace_id || !input.span_id || !input.name) return null;
  const start = input.start ? new Date(input.start).toISOString() : new Date().toISOString();
  const end = input.end ? new Date(input.end).toISOString() : null;
  const duration = Number.isFinite(input.duration_ms)
    ? Math.max(0, Math.round(input.duration_ms))
    : null;
  return {
    trace_id: String(input.trace_id),
    span_id: String(input.span_id),
    parent_span_id: input.parent_span_id ? String(input.parent_span_id) : null,
    name: String(input.name),
    start,
    end,
    duration_ms: duration,
    status: input.status || 'unset',
    exportable: input.exportable && typeof input.exportable === 'object' ? input.exportable : {},
    ...(input.local_only && typeof input.local_only === 'object'
      ? { local_only: input.local_only }
      : {}),
    ...(Array.isArray(input.events) && input.events.length ? { events: input.events } : {}),
  };
}

module.exports = {
  appendSpanRecord,
  readSpanRecords,
  getObsSpansPath,
  FILE_NAME,
};
