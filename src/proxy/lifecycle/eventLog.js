'use strict';

// Append-only lifecycle event log for hello / heartbeat / fetch interactions
// with the Hub. Stored at ~/.evomap/lifecycle_log.jsonl so the WebUI can show
// connection health.
//
// Retention is bounded on three axes (any one of which can disable the log):
//   EVOLVER_LIFECYCLE_LOG=off            -> disable entirely
//   EVOLVER_LIFECYCLE_LOG_MAX_LINES=N    -> hard cap on entries (default 5000)
//   EVOLVER_LIFECYCLE_LOG_MAX_DAYS=D     -> drop entries older than D days
//                                          (default 30; 0 = no TTL)
//
// Trimming is amortized: only ~2% of writes (1/50) trigger a sweep, so the
// hot path stays a single appendFileSync.

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_MAX_LINES = 5000;
const DEFAULT_MAX_DAYS = 30;
const TRIM_PROBABILITY = 0.02;

function getLogPath() {
  return path.join(os.homedir(), '.evomap', 'lifecycle_log.jsonl');
}

function isEnabled() {
  // Auto-disable under node:test so unit tests don't pollute the user's
  // real ~/.evomap. Tests that exercise this module set HOME explicitly
  // and re-evaluate isEnabled, which is fine because they also unset the
  // disable flag (or call recordLifecycleEvent indirectly through paths
  // that already tolerate IO errors).
  if (process.env.NODE_TEST_CONTEXT && !process.env.EVOLVER_LIFECYCLE_LOG_FORCE) return false;
  const flag = (process.env.EVOLVER_LIFECYCLE_LOG || '').toLowerCase();
  return flag !== 'off' && flag !== '0' && flag !== 'false';
}

function readEnvInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const num = parseInt(raw, 10);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function recordLifecycleEvent(entry) {
  if (!isEnabled() || !entry || typeof entry !== 'object' || !entry.kind) return;
  try {
    const logPath = getLogPath();
    ensureDir(logPath);
    const record = {
      ts: new Date().toISOString(),
      kind: entry.kind,
      outcome: entry.outcome || 'unknown',
      latency_ms: typeof entry.latency_ms === 'number' ? entry.latency_ms : null,
      status_code: typeof entry.status_code === 'number' ? entry.status_code : null,
      error: entry.error || null,
      node_id: entry.node_id || null,
      extra: entry.extra || null,
    };
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');

    if (Math.random() < TRIM_PROBABILITY) trimLog(logPath);
  } catch (_err) {
    // Logging is non-fatal: never block lifecycle for IO errors.
  }
}

function trimLog(logPath) {
  const maxLines = readEnvInt('EVOLVER_LIFECYCLE_LOG_MAX_LINES', DEFAULT_MAX_LINES);
  const maxDays = readEnvInt('EVOLVER_LIFECYCLE_LOG_MAX_DAYS', DEFAULT_MAX_DAYS);
  if (!fs.existsSync(logPath)) return;

  const raw = fs.readFileSync(logPath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  if (!lines.length) return;

  const filtered = applyRetention(lines, maxDays, maxLines);
  if (filtered.length === lines.length) return;

  const tmp = logPath + '.tmp';
  const payload = filtered.length ? filtered.join('\n') + '\n' : '';
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, logPath);
}

function applyRetention(lines, maxDays, maxLines) {
  let kept = lines;
  if (maxDays > 0) {
    const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
    kept = kept.filter((line) => {
      const ts = parseTs(line);
      return ts == null || ts >= cutoff;
    });
  }
  if (maxLines > 0 && kept.length > maxLines) {
    kept = kept.slice(kept.length - maxLines);
  }
  return kept;
}

function parseTs(line) {
  const match = line.match(/"ts":"([^"]+)"/);
  if (!match) return null;
  const t = Date.parse(match[1]);
  return Number.isFinite(t) ? t : null;
}

function readLifecycleLog(opts) {
  const o = opts || {};
  const logPath = getLogPath();
  if (!fs.existsSync(logPath)) return [];

  const raw = fs.readFileSync(logPath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);

  let entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch (_e) { /* skip corrupt */ }
  }

  if (o.kind) entries = entries.filter((e) => e.kind === o.kind);
  if (o.since) {
    const sinceTs = Date.parse(o.since);
    if (Number.isFinite(sinceTs)) entries = entries.filter((e) => Date.parse(e.ts) >= sinceTs);
  }
  if (o.last && Number.isFinite(o.last) && o.last > 0) entries = entries.slice(-o.last);
  return entries;
}

module.exports = {
  recordLifecycleEvent,
  readLifecycleLog,
  trimLog,
  getLogPath,
  isEnabled,
  // exported for tests
  applyRetention,
};
