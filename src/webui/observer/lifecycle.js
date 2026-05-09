'use strict';

const { readLifecycleLog } = require('../../proxy/lifecycle/eventLog');

const SUMMARY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 200;

function getLifecycle(query = {}) {
  const last = parseLast(query.last);
  const kind = typeof query.kind === 'string' ? query.kind : null;
  const events = readLifecycleLog({ kind, last });
  return {
    summary: summarize(events),
    events: events.slice(-RECENT_LIMIT),
  };
}

function parseLast(value) {
  if (value == null) return 500;
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num <= 0) return 500;
  return Math.min(num, 5000);
}

function summarize(events) {
  const now = Date.now();
  const within24h = events.filter((e) => parseTs(e.ts) >= now - SUMMARY_WINDOW_MS);

  const byKind = { hello: 0, heartbeat: 0, fetch: 0 };
  const okByKind = { hello: 0, heartbeat: 0, fetch: 0 };
  let lastHelloOk = null;
  let lastHeartbeatOk = null;
  let lastError = null;
  const latencies = [];

  for (const evt of events) {
    if (byKind[evt.kind] != null) byKind[evt.kind]++;
    if (evt.outcome === 'ok' || evt.outcome === 'recovered') {
      if (okByKind[evt.kind] != null) okByKind[evt.kind]++;
      if (evt.kind === 'hello') lastHelloOk = evt.ts;
      if (evt.kind === 'heartbeat') lastHeartbeatOk = evt.ts;
    } else if (evt.outcome && evt.outcome !== 'ok') {
      lastError = { ts: evt.ts, kind: evt.kind, outcome: evt.outcome, error: evt.error };
    }
    if (typeof evt.latency_ms === 'number') latencies.push(evt.latency_ms);
  }

  const heartbeatTotal = byKind.heartbeat || 0;
  const heartbeatHealthPct = heartbeatTotal === 0 ? null
    : Math.round((okByKind.heartbeat / heartbeatTotal) * 100);

  return {
    total: events.length,
    last24h: within24h.length,
    byKind,
    okByKind,
    heartbeatHealthPct,
    lastHelloOk,
    lastHeartbeatOk,
    lastError,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
  };
}

function parseTs(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : 0;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[idx];
}

module.exports = { getLifecycle };
