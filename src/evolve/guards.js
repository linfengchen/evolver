'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { getRepoRoot, getAgentSessionsDir, getEvolutionDir } = require('../gep/paths');
const { readStateForSolidify } = require('../gep/solidify');
const { readAllEvents } = require('../gep/assetStore');
const { collectTranscriptFiles } = require('./utils');

const MAX_EXEC_BUFFER = 10 * 1024 * 1024;

// Minimum assumed CPU count when os.cpus() returns an empty array. This can
// happen on Android/Termux where the Node.js os module cannot read
// /proc/cpuinfo reliably (issue #446). Without a floor, default load max
// collapses to 0.0 and every cycle is permanently backed off.
const MIN_ASSUMED_CPU_COUNT = 4;
const DORMANT_TTL_MS = 3600 * 1000;

const REPO_ROOT = getRepoRoot();
const AGENT_SESSIONS_DIR = getAgentSessionsDir();
const CURSOR_TRANSCRIPTS_DIR = process.env.EVOLVER_CURSOR_TRANSCRIPTS_DIR || '';

const DORMANT_HYPOTHESIS_FILE = path.join(getEvolutionDir(), 'dormant_hypothesis.json');

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

function sleepMs(ms) {
  const t = Number(ms);
  const n = Number.isFinite(t) ? Math.max(0, t) : 0;
  return new Promise(resolve => setTimeout(resolve, n));
}

// ---------------------------------------------------------------------------
// System load helpers
// ---------------------------------------------------------------------------

function detectCpuCount() {
  try {
    const list = os.cpus();
    if (Array.isArray(list) && list.length > 0) return list.length;
  } catch (_) {}
  return MIN_ASSUMED_CPU_COUNT;
}

// Check system load average via os.loadavg().
// Returns { load1m, load5m, load15m }. On platforms where loadavg is not
// meaningful (Windows reports all zeros, some Android/Termux builds report
// process-counter values much larger than the CPU budget), the raw values
// are clamped to at most 2x the assumed CPU count so a single misreported
// sample cannot force a permanent backoff. See issue #446.
function getSystemLoad() {
  try {
    const loadavg = os.loadavg();
    const cores = detectCpuCount();
    const cap = Math.max(1, cores) * 2;
    return {
      load1m:  Math.min(loadavg[0] || 0, cap),
      load5m:  Math.min(loadavg[1] || 0, cap),
      load15m: Math.min(loadavg[2] || 0, cap),
    };
  } catch (e) {
    return { load1m: 0, load5m: 0, load15m: 0 };
  }
}

// Calculate intelligent default load threshold based on CPU cores.
// Rule of thumb:
// - Single-core: 0.8-1.0 (use 0.9)
// - Multi-core: cores x 0.8-1.0 (use 0.9)
// - Production: reserve 20% headroom for burst traffic
// Uses detectCpuCount() so Android/Termux (where os.cpus() may return []) still
// gets a usable default instead of 0.0 (issue #446).
function getDefaultLoadMax() {
  const cpuCount = detectCpuCount();
  return cpuCount <= 1 ? 0.9 : cpuCount * 0.9;
}

// Check how many agent sessions are actively being processed (modified in the last N minutes).
// Counts across both OpenClaw sessions and Cursor/Codex/Manus transcripts.
function getRecentActiveSessionCount(windowMs) {
  let count = 0;
  const now = Date.now();
  const w = Number.isFinite(windowMs) ? windowMs : 10 * 60 * 1000;

  try {
    if (fs.existsSync(AGENT_SESSIONS_DIR)) {
      count += fs.readdirSync(AGENT_SESSIONS_DIR)
        .filter(f => f.endsWith('.jsonl') && !f.includes('.lock') && !f.startsWith('evolver_hand_'))
        .filter(f => {
          try { return (now - fs.statSync(path.join(AGENT_SESSIONS_DIR, f)).mtimeMs) < w; } catch (_) { return false; }
        }).length;
    }
  } catch (_) {}

  try {
    if (CURSOR_TRANSCRIPTS_DIR && fs.existsSync(CURSOR_TRANSCRIPTS_DIR)) {
      const transcriptFiles = collectTranscriptFiles(CURSOR_TRANSCRIPTS_DIR, 3);
      count += transcriptFiles.filter(f => (now - f.time) < w).length;
    }
  } catch (_) {}

  return count;
}

// ---------------------------------------------------------------------------
// Dormant hypothesis (partial-state persistence across backoffs)
// ---------------------------------------------------------------------------

function writeDormantHypothesis(data) {
  try {
    const dir = getEvolutionDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj = Object.assign({}, data, { created_at: new Date().toISOString(), ttl_ms: DORMANT_TTL_MS });
    const tmp = DORMANT_HYPOTHESIS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, DORMANT_HYPOTHESIS_FILE);
    console.log('[DormantHypothesis] Saved partial state before backoff: ' + (data.backoff_reason || 'unknown'));
  } catch (e) {
    console.log('[DormantHypothesis] Write failed (non-fatal): ' + (e && e.message ? e.message : e));
  }
}

function readDormantHypothesis() {
  try {
    if (!fs.existsSync(DORMANT_HYPOTHESIS_FILE)) return null;
    const raw = fs.readFileSync(DORMANT_HYPOTHESIS_FILE, 'utf8');
    if (!raw.trim()) return null;
    const obj = JSON.parse(raw);
    const createdAt = obj.created_at ? new Date(obj.created_at).getTime() : 0;
    const ttl = Number.isFinite(Number(obj.ttl_ms)) ? Number(obj.ttl_ms) : DORMANT_TTL_MS;
    if (Date.now() - createdAt > ttl) {
      clearDormantHypothesis();
      console.log('[DormantHypothesis] Expired (age: ' + Math.round((Date.now() - createdAt) / 1000) + 's). Discarded.');
      return null;
    }
    return obj;
  } catch (e) {
    return null;
  }
}

function clearDormantHypothesis() {
  try {
    if (fs.existsSync(DORMANT_HYPOTHESIS_FILE)) fs.unlinkSync(DORMANT_HYPOTHESIS_FILE);
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Bridge mode detection
// ---------------------------------------------------------------------------

function determineBridgeEnabled() {
  const bridgeExplicit = process.env.EVOLVE_BRIDGE;
  if (bridgeExplicit !== undefined && bridgeExplicit !== '') {
    return String(bridgeExplicit).toLowerCase() !== 'false';
  }
  return Boolean(process.env.OPENCLAW_WORKSPACE);
}

// ---------------------------------------------------------------------------
// Pre-flight safeguards: race detection, queue limits, system load, loop gating.
// Returns { abort: true } if the cycle should be skipped.
// ---------------------------------------------------------------------------

async function runPreflightChecks(bridgeEnabled, loopMode) {
  // SAFEGUARD: If another evolver Hand Agent is already running, back off.
  if (process.platform !== 'win32') {
    try {
      const _psRace = require('child_process').execSync(
        'ps aux | grep "evolver_hand_" | grep -v grep',
        { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_EXEC_BUFFER }
      ).trim();
      if (_psRace && _psRace.length > 0) {
        console.log('[Evolver] Another evolver Hand Agent is already running. Yielding this cycle.');
        return { abort: true };
      }
    } catch (_) {}
  }

  // SAFEGUARD: If the agent has too many active user sessions, back off.
  const QUEUE_MAX = Number.parseInt(process.env.EVOLVE_AGENT_QUEUE_MAX || '10', 10);
  const QUEUE_BACKOFF_MS = Number.parseInt(process.env.EVOLVE_AGENT_QUEUE_BACKOFF_MS || '60000', 10);
  const activeUserSessions = getRecentActiveSessionCount(10 * 60 * 1000);
  if (activeUserSessions > QUEUE_MAX) {
    console.log(`[Evolver] Agent has ${activeUserSessions} active user sessions (max ${QUEUE_MAX}). Backing off ${QUEUE_BACKOFF_MS}ms to avoid starving user conversations.`);
    writeDormantHypothesis({ backoff_reason: 'active_sessions_exceeded', active_sessions: activeUserSessions, queue_max: QUEUE_MAX });
    await sleepMs(QUEUE_BACKOFF_MS);
    return { abort: true };
  }

  // SAFEGUARD: System load awareness.
  const LOAD_MAX = parseFloat(process.env.EVOLVE_LOAD_MAX || String(getDefaultLoadMax()));
  const sysLoad = getSystemLoad();
  if (sysLoad.load1m > LOAD_MAX) {
    console.log(`[Evolver] System load ${sysLoad.load1m.toFixed(2)} exceeds max ${LOAD_MAX.toFixed(1)} (auto-calculated for ${detectCpuCount()} cores). Backing off ${QUEUE_BACKOFF_MS}ms.`);
    writeDormantHypothesis({ backoff_reason: 'system_load_exceeded', system_load: { load1m: sysLoad.load1m, load5m: sysLoad.load5m, load15m: sysLoad.load15m }, load_max: LOAD_MAX, cpu_cores: detectCpuCount() });
    await sleepMs(QUEUE_BACKOFF_MS);
    return { abort: true };
  }

  // Loop gating: do not start a new cycle until the previous one is solidified.
  if (bridgeEnabled && loopMode) {
    try {
      const st = readStateForSolidify();
      const lastRun = st && st.last_run ? st.last_run : null;
      const lastSolid = st && st.last_solidify ? st.last_solidify : null;
      if (lastRun && lastRun.run_id) {
        const pending = !lastSolid || !lastSolid.run_id || String(lastSolid.run_id) !== String(lastRun.run_id);
        if (pending) {
          writeDormantHypothesis({ backoff_reason: 'loop_gating_pending_solidify', signals: lastRun && Array.isArray(lastRun.signals) ? lastRun.signals : [], selected_gene_id: lastRun && lastRun.selected_gene_id ? lastRun.selected_gene_id : null, mutation: lastRun && lastRun.mutation ? lastRun.mutation : null, personality_state: lastRun && lastRun.personality_state ? lastRun.personality_state : null, run_id: lastRun.run_id });
          const raw = process.env.EVOLVE_PENDING_SLEEP_MS || process.env.EVOLVE_MIN_INTERVAL || '120000';
          const n = parseInt(String(raw), 10);
          const waitMs = Number.isFinite(n) ? Math.max(0, n) : 120000;
          await sleepMs(waitMs);
          return { abort: true };
        }
      }
    } catch (e) {
      // Cannot read state → proceed (fail-open) to avoid deadlock.
    }
  }

  return { abort: false };
}

// ---------------------------------------------------------------------------
// Repair loop circuit breaker: detect stuck repair→fail→repair cycles.
// ---------------------------------------------------------------------------

function checkRepairLoopCircuitBreaker() {
  const threshold = require('../config').REPAIR_LOOP_THRESHOLD;
  try {
    const allEvents = readAllEvents();
    const recent = Array.isArray(allEvents) ? allEvents.slice(-threshold) : [];
    if (recent.length >= threshold) {
      const allRepairFailed = recent.every(e =>
        e && e.intent === 'repair' &&
        e.outcome && e.outcome.status === 'failed'
      );
      if (allRepairFailed) {
        const geneIds = recent.map(e => (e.genes_used && e.genes_used[0]) || 'unknown');
        const sameGene = geneIds.every(id => id === geneIds[0]);
        console.warn(`[CircuitBreaker] Detected ${threshold} consecutive failed repairs${sameGene ? ` (gene: ${geneIds[0]})` : ''}. Forcing innovation intent to break the loop.`);
        process.env.FORCE_INNOVATION = 'true';
      }
    }
  } catch (e) {
    console.error(`[CircuitBreaker] Check failed (non-fatal): ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// ATP task pickup: yield cycle to a pre-claimed merchant task when present.
// Returns true if the cycle should be aborted (pickup was emitted).
// ---------------------------------------------------------------------------

async function checkAtpTaskPickup(bridgeEnabled) {
  if (!bridgeEnabled) return false;
  try {
    const atpTaskPickup = require('../atp/atpTaskPickup');
    if (atpTaskPickup && typeof atpTaskPickup.pickOne === 'function') {
      const pick = await atpTaskPickup.pickOne({ limit: 5 });
      if (pick && pick.spawnCall) {
        console.log('\n[ATP-Pickup] Yielding cycle to ATP task ' + pick.task.id + ' (order=' + pick.task.atp_order_id + ')');
        console.log(pick.spawnCall);
        return true;
      }
    }
  } catch (e) {
    console.log('[ATP-Pickup] check failed (non-fatal): ' + (e && e.message || e));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Environment sanity: CWD recovery + git repo check.
// Returns { abort: true } if the repo is not a git repo (fatal).
// ---------------------------------------------------------------------------

function checkEnvironment() {
  // CWD Recovery: process.cwd() throws ENOENT if the working directory was
  // deleted during a previous cycle (e.g. by git reset/restore). Recover by
  // chdir to REPO_ROOT so subsequent operations don't all fail.
  try {
    process.cwd();
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      console.warn('[Evolver] CWD lost (ENOENT). Recovering to REPO_ROOT: ' + REPO_ROOT);
      try { process.chdir(REPO_ROOT); } catch (e2) {
        console.error('[Evolver] CWD recovery failed: ' + (e2 && e2.message ? e2.message : e2));
        throw e;
      }
    } else {
      throw e;
    }
  }

  // Reset per-cycle env flags. In --loop mode process.env persists; the
  // circuit breaker below will re-set FORCE_INNOVATION if still warranted.
  delete process.env.FORCE_INNOVATION;

  // SAFEGUARD: Git repository check.
  // Solidify, rollback, and blast radius all depend on git.
  try {
    execSync('git rev-parse --git-dir', { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, maxBuffer: MAX_EXEC_BUFFER });
  } catch (_) {
    console.error('[Evolver] FATAL: Not a git repository (' + REPO_ROOT + ').');
    console.error('[Evolver] Evolver requires git for rollback, blast radius calculation, and solidify.');
    console.error('[Evolver] Run "git init && git add -A && git commit -m init" in your project root, then try again.');
    process.exitCode = 1;
    return { abort: true };
  }

  return { abort: false };
}

// ---------------------------------------------------------------------------
// Main Stage 1 orchestrator
// Returns ctx enriched with: { abort, bridgeEnabled, loopMode, isDryRun,
//   isReviewMode, dormantHypothesis }
// ---------------------------------------------------------------------------

async function runGuards(ctx) {
  const ARGS = process.argv.slice(2);
  const bridgeEnabled = determineBridgeEnabled();
  const loopMode = ARGS.includes('--loop') || ARGS.includes('--mad-dog') || String(process.env.EVOLVE_LOOP || '').toLowerCase() === 'true';
  const isDryRun = ARGS.includes('--dry-run');
  const isReviewMode = ARGS.includes('--review');

  // Preflight first — if system is overloaded or loop-gated, abort before
  // starting any background daemons (restores original safeguard order).
  const preflight = await runPreflightChecks(bridgeEnabled, loopMode);
  if (preflight.abort) return Object.assign({}, ctx, { abort: true, bridgeEnabled, loopMode, isDryRun, isReviewMode, dormantHypothesis: null });

  // Bootstrap ATP daemons only after preflight passes (idempotent — no-ops on repeat calls).
  try {
    const autoBuyer = require('../atp/autoBuyer');
    if (autoBuyer && typeof autoBuyer.start === 'function') autoBuyer.start();
  } catch (e) {
    console.log('[ATP-AutoBuyer] start failed (non-fatal): ' + (e && e.message || e));
  }
  try {
    const autoDeliver = require('../atp/autoDeliver');
    if (autoDeliver && typeof autoDeliver.start === 'function') autoDeliver.start();
  } catch (e) {
    console.log('[ATP-AutoDeliver] start failed (non-fatal): ' + (e && e.message || e));
  }

  const atpAbort = await checkAtpTaskPickup(bridgeEnabled);
  if (atpAbort) return Object.assign({}, ctx, { abort: true, bridgeEnabled, loopMode, isDryRun, isReviewMode, dormantHypothesis: null });

  const envCheck = checkEnvironment();
  if (envCheck.abort) return Object.assign({}, ctx, { abort: true, bridgeEnabled, loopMode, isDryRun, isReviewMode, dormantHypothesis: null });

  const dormantHypothesis = readDormantHypothesis();
  if (dormantHypothesis) {
    console.log('[DormantHypothesis] Recovered partial state from previous backoff: ' + (dormantHypothesis.backoff_reason || 'unknown'));
    clearDormantHypothesis();
  }

  // checkRepairLoopCircuitBreaker is intentionally NOT called here.
  // It must run in run() after ensureAssetFiles() + performMaintenance() to preserve original sequencing.

  return Object.assign({}, ctx, {
    abort: false,
    bridgeEnabled,
    loopMode,
    isDryRun,
    isReviewMode,
    dormantHypothesis,
  });
}

module.exports = {
  runGuards,
  // Exported for direct use by evolve.js (backward compat) and tests.
  determineBridgeEnabled,
  writeDormantHypothesis,
  readDormantHypothesis,
  clearDormantHypothesis,
  runPreflightChecks,
  checkRepairLoopCircuitBreaker,
  sleepMs,
  detectCpuCount,
  getSystemLoad,
  getDefaultLoadMax,
  getRecentActiveSessionCount,
};
