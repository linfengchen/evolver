'use strict';

const fs = require('fs');
const path = require('path');
const { getObserverPaths } = require('./paths');
const { readJsonl } = require('./jsonl');
const { redactValue } = require('./redact');

const VALID_PHASE_STATUSES = new Set(['pending', 'running', 'success', 'failed', 'skipped', 'blocked']);

function readPipelineEvents(opts = {}) {
  return readJsonl(getObserverPaths().pipelineEventsPath, opts).map(normalizePipelineEvent);
}

function logPipelineEvent(event) {
  const normalized = normalizePipelineEvent(event);
  const target = getObserverPaths().pipelineEventsPath;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, JSON.stringify(normalized) + '\n', 'utf8');
  return normalized;
}

function normalizePipelineEvent(event) {
  const input = event && typeof event === 'object' ? event : {};
  const status = VALID_PHASE_STATUSES.has(input.status) ? input.status : 'running';
  return redactValue({
    run_id: stringOrNull(input.run_id),
    cycle_id: stringOrNull(input.cycle_id),
    phase: stringOrDefault(input.phase, 'unknown'),
    status,
    started_at: stringOrNull(input.started_at),
    finished_at: stringOrNull(input.finished_at),
    summary: stringOrDefault(input.summary, ''),
    evidence_refs: arrayOfObjects(input.evidence_refs),
    asset_refs: arrayOfObjects(input.asset_refs),
    validation_refs: arrayOfObjects(input.validation_refs),
    requires_confirmation: Boolean(input.requires_confirmation),
    // Optional W3C-style trace identifiers for cross-referencing with
    // obs_spans.jsonl. Older rows that pre-date observability wiring will
    // simply have these fields absent (null), which the WebUI tolerates.
    trace_id: traceIdOrNull(input.trace_id),
    span_id: spanIdOrNull(input.span_id),
    parent_span_id: spanIdOrNull(input.parent_span_id),
    duration_ms: Number.isFinite(input.duration_ms) ? Math.max(0, Math.round(input.duration_ms)) : null,
    timestamp: input.timestamp || new Date().toISOString(),
  });
}

function traceIdOrNull(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) ? value : null;
}

function spanIdOrNull(value) {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value) ? value : null;
}

function stringOrNull(value) {
  return typeof value === 'string' && value ? value : null;
}

function stringOrDefault(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function arrayOfObjects(value) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') : [];
}

module.exports = {
  readPipelineEvents,
  logPipelineEvent,
  normalizePipelineEvent,
};
