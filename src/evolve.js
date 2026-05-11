const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// 10 MB — prevents RangeError on large child process output (e.g. git log/diff
// on large repos). See GHSA reports / issue #451.
const MAX_EXEC_BUFFER = 10 * 1024 * 1024;
const { getRepoRoot, getMemoryDir, getAgentSessionsDir } = require('./gep/paths');
const { ensureAssetFiles } = require('./gep/assetStore');
const _shield = require('./gep/shield');
const _integrity = require('./gep/integrityCheck');
const _obs = require('./observability');

_shield.activate();
_integrity.verify();
_shield.protectModule(require('./gep/hubVerify'));

const REPO_ROOT = getRepoRoot();

// Verbose logging helper. Checks EVOLVER_VERBOSE env const (set by --verbose flag in index.js).
function verbose(...args) {
  if (String(process.env.EVOLVER_VERBOSE || '').toLowerCase() !== 'true') return;
  args.unshift('[Verbose]');
  console.log.apply(console, args);
}

// Idle-cycle gating: tracks the timestamp of the last Hub fetch across cycles.
// Gating logic (shouldSkipHubCalls) lives in pipeline/signals.js; this variable
// is passed in as lastHubFetchMs and updated here after a successful Hub fetch.
let _lastHubFetchMs = 0;

function extractFirstUserMessage(content) {
  if (!content) return null;
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line);
      const msg = data.message || data;
      if (msg.role === 'user' || msg.role === 'USER') {
        const msgContent = msg.content;
        if (Array.isArray(msgContent)) {
          const textParts = msgContent.filter(function(c) { return c.type === 'text'; }).map(function(c) { return c.text; }).join('');
          return textParts.trim();
        } else if (typeof msgContent === 'string') {
          return msgContent.trim();
        }
      }
    } catch (_) {
      // Not JSON, skip
    }
  }
  return null;
}

function getCurrentSessionInitialPrompt() {
  function getCursorPrompt() {
    if (!CURSOR_TRANSCRIPTS_DIR) return null;
    try {
      const files = collectTranscriptFiles(CURSOR_TRANSCRIPTS_DIR, 3);
      if (!files || files.length === 0) return null;
      files.sort(function(a, b) { return b.time - a.time; });
      const headContent = readFileHead(files[0].path, 16384);
      return extractFirstUserMessage(headContent);
    } catch (e) {
      return null;
    }
  }

  function getOpenClawPrompt() {
    try {
      if (!fs.existsSync(AGENT_SESSIONS_DIR)) return null;
      const sessions = fs.readdirSync(AGENT_SESSIONS_DIR)
        .filter(function(f) { return f.endsWith('.jsonl'); })
        .map(function(f) {
          return {
            path: path.join(AGENT_SESSIONS_DIR, f),
            time: fs.statSync(path.join(AGENT_SESSIONS_DIR, f)).mtime.getTime(),
          };
        })
        .sort(function(a, b) { return b.time - a.time; });
      if (!sessions || sessions.length === 0) return null;
      const headContent = readFileHead(sessions[0].path, 16384);
      return extractFirstUserMessage(headContent);
    } catch (e) {
      return null;
    }
  }

  if (SESSION_SOURCE === 'cursor') return getCursorPrompt();
  if (SESSION_SOURCE === 'openclaw') return getOpenClawPrompt();
  if (SESSION_SOURCE === 'merge') return getOpenClawPrompt() || getCursorPrompt();

  // 'auto': detect available sources
  const hasOpenClaw = fs.existsSync(AGENT_SESSIONS_DIR);
  const hasCursor = !!(CURSOR_TRANSCRIPTS_DIR || process.env.CURSOR_TRACE_DIR || process.env.CURSOR_BACKGROUND_TRANSCRIPTS_DIR);

  if (hasOpenClaw && hasCursor) return getOpenClawPrompt() || getCursorPrompt();
  if (hasOpenClaw) return getOpenClawPrompt();
  if (hasCursor) return getCursorPrompt();
  return null;
}

// Load environment variables from repo root
try {
  require('dotenv').config({ path: path.join(REPO_ROOT, '.env'), quiet: true });
} catch (e) {
  // dotenv might not be installed or .env missing, proceed gracefully
}

// Pipeline modules required AFTER dotenv so their module-level constants
// (AGENT_SESSIONS_DIR, CURSOR_TRANSCRIPTS_DIR, SESSION_SOURCE, etc.) are
// computed with .env values already in process.env.
const _guards = require('./evolve/guards');
const _collect = require('./evolve/pipeline/collect');
const _signals = require('./evolve/pipeline/signals');
const _hub = require('./evolve/pipeline/hub');
const _enrich = require('./evolve/pipeline/enrich');
const _select = require('./evolve/pipeline/select');
const _dispatch = require('./evolve/pipeline/dispatch');
const { collectTranscriptFiles, readFileHead } = require('./evolve/utils');

// Configuration from CLI flags or Env
const ARGS = process.argv.slice(2);
const IS_REVIEW_MODE = ARGS.includes('--review');
const IS_DRY_RUN = ARGS.includes('--dry-run');
let IS_RANDOM_DRIFT = ARGS.includes('--drift') || String(process.env.RANDOM_DRIFT || '').toLowerCase() === 'true';

// Default Configuration
const MEMORY_DIR = getMemoryDir();
const AGENT_NAME = process.env.AGENT_NAME || 'main';
// Honors process.env.AGENT_SESSIONS_DIR and EVOLVER_SESSION_SCOPE.
// Pre-1.78.9 this was a hard-coded `~/.openclaw/agents/<name>/sessions`
// and silently ignored both env vars -- see issue #527.
const AGENT_SESSIONS_DIR = getAgentSessionsDir();
const CURSOR_TRANSCRIPTS_DIR = process.env.EVOLVER_CURSOR_TRANSCRIPTS_DIR || '';
const SESSION_SOURCE = (process.env.EVOLVER_SESSION_SOURCE || 'auto').toLowerCase();

// Ensure memory directory exists so state/cache writes work.
try {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
} catch (e) {
  console.warn('[Evolver] Failed to create MEMORY_DIR (may cause downstream errors):', e && e.message || e);
}


function performMaintenance() {
  // Auto-update check (rate-limited, non-fatal).
  checkAndAutoUpdate();

  try {
    if (!fs.existsSync(AGENT_SESSIONS_DIR)) return;

    const files = fs.readdirSync(AGENT_SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));

    // Clean up evolver's own hand sessions immediately.
    // These are single-use executor sessions that must not accumulate,
    // otherwise they pollute the agent's context and starve user conversations.
    const evolverFiles = files.filter(f => f.startsWith('evolver_hand_'));
    for (const f of evolverFiles) {
      try {
        fs.unlinkSync(path.join(AGENT_SESSIONS_DIR, f));
      } catch (_) {}
    }
    if (evolverFiles.length > 0) {
      console.log(`[Maintenance] Cleaned ${evolverFiles.length} evolver hand session(s).`);
    }

    // Archive old non-evolver sessions when count exceeds threshold.
    const remaining = files.length - evolverFiles.length;
    if (remaining < 100) return;

    console.log(`[Maintenance] Found ${remaining} session logs. Archiving old ones...`);

    const ARCHIVE_DIR = path.join(AGENT_SESSIONS_DIR, 'archive');
    if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

    const fileStats = files
      .filter(f => !f.startsWith('evolver_hand_'))
      .map(f => {
        try {
          return { name: f, time: fs.statSync(path.join(AGENT_SESSIONS_DIR, f)).mtime.getTime() };
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);

    const toArchive = fileStats.slice(0, fileStats.length - 50);

    for (const file of toArchive) {
      const oldPath = path.join(AGENT_SESSIONS_DIR, file.name);
      const newPath = path.join(ARCHIVE_DIR, file.name);
      fs.renameSync(oldPath, newPath);
    }
    if (toArchive.length > 0) {
      console.log(`[Maintenance] Archived ${toArchive.length} logs to ${ARCHIVE_DIR}`);
    }
  } catch (e) {
    console.error(`[Maintenance] Error: ${e.message}`);
  }
}

// --- Auto-update: check for newer versions of evolver ---
function checkAndAutoUpdate() {
  try {
    let autoUpdate = true;
    let intervalHours = 6;

    // Read config from multiple locations (prioritize evolver's own .env/config)
    const configCandidates = [
      path.join(REPO_ROOT, 'evolver.json'),
      path.join(os.homedir(), '.evomap', 'evolver.json'),
      path.join(os.homedir(), '.openclaw', 'openclaw.json'),
    ];
    for (const configPath of configCandidates) {
      try {
        if (fs.existsSync(configPath)) {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          const evolverCfg = cfg.evolver || cfg;
          if (evolverCfg.autoUpdate === false) autoUpdate = false;
          if (Number.isFinite(Number(evolverCfg.autoUpdateIntervalHours))) {
            intervalHours = Number(evolverCfg.autoUpdateIntervalHours);
          }
          break;
        }
      } catch (_) {}
    }

    if (!autoUpdate) return;

    const stateFile = path.join(MEMORY_DIR, 'evolver_update_check.json');
    const now = Date.now();
    const intervalMs = intervalHours * 60 * 60 * 1000;
    try {
      if (fs.existsSync(stateFile)) {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        if (state.lastCheckedAt && (now - new Date(state.lastCheckedAt).getTime()) < intervalMs) {
          return;
        }
      }
    } catch (_) {}

    // Channel 1: npm (preferred for standalone/Cursor/Claude Code/Codex installs)
    let updated = false;
    try {
      const currentPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
      const currentVersion = currentPkg.version || '0.0.0';
      const npmOut = execSync('npm view @evomap/evolver version 2>/dev/null', {
        encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, maxBuffer: MAX_EXEC_BUFFER
      }).trim();
      if (npmOut && npmOut !== currentVersion) {
        console.log(`[AutoUpdate] New version available: ${currentVersion} -> ${npmOut} (npm: @evomap/evolver)`);
      }
    } catch (_) {}

    // Channel 2: Feishu wrapper auto-bootstrap (only if Feishu env detected)
    if (process.env.FEISHU_APP_ID || process.env.FEISHU_BOT_NAME) {
      const wrapperDir = path.resolve(REPO_ROOT, '..', 'feishu-evolver-wrapper');
      if (!fs.existsSync(wrapperDir)) {
        try {
          console.log('[AutoUpdate] Feishu env detected, downloading feishu-evolver-wrapper...');
          execSync('npx -y degit EvoMap/feishu-evolver-wrapper ' + JSON.stringify(wrapperDir), {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, windowsHide: true, maxBuffer: MAX_EXEC_BUFFER
          });
          console.log('[AutoUpdate] feishu-evolver-wrapper installed to ' + wrapperDir);
        } catch (e) {
          console.log('[AutoUpdate] feishu-evolver-wrapper download failed (non-fatal): ' + (e.message || e));
        }
      }
    }

    try {
      fs.writeFileSync(stateFile, JSON.stringify({ lastCheckedAt: new Date(now).toISOString(), updated }, null, 2) + '\n');
    } catch (_) {}

    if (updated) {
      console.log('[AutoUpdate] Skills updated. Changes will take effect on next restart.');
    }
  } catch (e) {
    console.log(`[AutoUpdate] Check failed (non-fatal): ${e.message}`);
  }
}


async function run() {
  _shield.check();

  return _obs.withSpan('evolve.run', {}, async (span) => {
    let ctx = await _guards.runGuards({});
    if (ctx.abort) {
      _obs.setExportableAttribute(span, 'aborted', true);
      return;
    }

    const { bridgeEnabled } = ctx;
    const cycleId = ctx.cycleId || null;

    _obs.setExportableAttributes(span, {
      cycle_id: cycleId,
      bridge_enabled: !!bridgeEnabled,
      strategy_env: process.env.EVOLVE_STRATEGY || null,
      review_mode: !!IS_REVIEW_MODE,
      dry_run: !!IS_DRY_RUN,
    });

    const startTime = Date.now();
    verbose('--- evolve.run() start ---');
    verbose('Config: EVOLVE_STRATEGY=' + (process.env.EVOLVE_STRATEGY || '(default)') + ' EVOLVE_BRIDGE=' + (process.env.EVOLVE_BRIDGE || '(default)') + ' EVOLVE_LOOP=' + (process.env.EVOLVE_LOOP || 'false'));
    verbose('Config: EVOLVER_IDLE_FETCH_INTERVAL_MS=' + (process.env.EVOLVER_IDLE_FETCH_INTERVAL_MS || '(default 1800000)') + ' RANDOM_DRIFT=' + (process.env.RANDOM_DRIFT || 'false'));
    console.log('Scanning session logs...');

    // Ensure all GEP asset files exist before any operation.
    // This prevents "No such file or directory" errors when external tools
    // (grep, cat, etc.) reference optional append-only files like genes.jsonl.
    try { ensureAssetFiles(); } catch (e) {
      console.error(`[AssetInit] ensureAssetFiles failed (non-fatal): ${e.message}`);
    }

    if (!IS_DRY_RUN) {
      performMaintenance();
    } else {
      console.log('[Maintenance] Skipped (dry-run mode).');
    }

    _guards.checkRepairLoopCircuitBreaker();

    const stageEvent = (name, attrs = {}) => _obs.addExportableEvent(span, name, attrs);

    let stageStart = Date.now();
    ctx = await _collect.collectContext(ctx);
    const initialUserPrompt = getCurrentSessionInitialPrompt();
    ctx = { ...ctx, scanTime: Date.now() - startTime, initialUserPrompt, traceId: span.traceId };
    stageEvent('evolve.collect.done', { duration_ms: Date.now() - stageStart });
    if (initialUserPrompt) {
      _obs.setExportableAttribute(span, 'initial_user_prompt.length', initialUserPrompt.length);
      _obs.setLocalOnlyPayload(span, 'initial_user_prompt', initialUserPrompt);
    }

    stageStart = Date.now();
    ctx = await _signals.extractSignalsStage({ ...ctx, lastHubFetchMs: _lastHubFetchMs });
    stageEvent('evolve.signals.done', {
      duration_ms: Date.now() - stageStart,
      signal_count: Array.isArray(ctx.signals) ? ctx.signals.length : 0,
    });

    stageStart = Date.now();
    ctx = await _hub.hubCoordinate(ctx);
    if (ctx.lastHubFetchMs > _lastHubFetchMs) _lastHubFetchMs = ctx.lastHubFetchMs;
    stageEvent('evolve.hub.done', {
      duration_ms: Date.now() - stageStart,
      hub_hit: !!(ctx.hubHit && ctx.hubHit.hit),
      active_task: !!ctx.activeTask,
    });

    stageStart = Date.now();
    ctx = await _enrich.enrich({ ...ctx, IS_RANDOM_DRIFT, IS_REVIEW_MODE, IS_DRY_RUN, AGENT_NAME });
    IS_RANDOM_DRIFT = !!ctx.IS_RANDOM_DRIFT;
    stageEvent('evolve.enrich.done', {
      duration_ms: Date.now() - stageStart,
      random_drift: !!IS_RANDOM_DRIFT,
    });

    stageStart = Date.now();
    ctx = await _select.selectAndMutate(ctx);
    stageEvent('evolve.select.done', {
      duration_ms: Date.now() - stageStart,
      selected_gene_id: ctx.selectedGene && ctx.selectedGene.id ? ctx.selectedGene.id : null,
      selector: ctx.selector || null,
    });

    stageStart = Date.now();
    await _dispatch.dispatch(ctx);
    stageEvent('evolve.dispatch.done', { duration_ms: Date.now() - stageStart });
  });
}

module.exports = {
  run,
  verbose,
  // Delegate to canonical implementations in pipeline modules so tests and
  // production always exercise the same code path (fixes duplicate-copy drift).
  computeAdaptiveStrategyPolicy: _select.computeAdaptiveStrategyPolicy,
  shouldSkipHubCalls: _signals.shouldSkipHubCalls,
  determineBridgeEnabled: _guards.determineBridgeEnabled,
  detectCpuCount: _guards.detectCpuCount,
  getDefaultLoadMax: _guards.getDefaultLoadMax,
  getSystemLoad: _guards.getSystemLoad,
  formatSessionLog: _collect.formatSessionLog,
  formatCursorTranscript: _collect.formatCursorTranscript,
  diagnoseSessionSourceEmpty: _collect.diagnoseSessionSourceEmpty,
  resetSessionSourceWarning: _collect.resetSessionSourceWarning,
};

