const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// 10 MB — prevents RangeError on large child process output (e.g. git log/diff
// on large repos). See GHSA reports / issue #451.
const MAX_EXEC_BUFFER = 10 * 1024 * 1024;
const { getRepoRoot, getMemoryDir, getSessionScope, getAgentSessionsDir } = require('./gep/paths');
const {
  readRecentFailedCapsules,
  ensureAssetFiles,
} = require('./gep/assetStore');
const { hubSearch } = require('./gep/hubSearch');
const { buildCandidatePreviews } = require('./gep/candidateEval');
const memoryAdapter = require('./gep/memoryGraphAdapter');
const {
  getAdvice: getMemoryAdvice,
  recordSignalSnapshot,
  recordOutcome: recordOutcomeFromState,
  memoryGraphPath,
} = memoryAdapter;
const { fetchTasks, selectBestTask, claimTask, taskToSignals, taskToSignalsWithPrivacy, claimWorkerTask, estimateCommitmentDeadline, detectPrivacyTask } = require('./gep/taskReceiver');
const { generateQuestions } = require('./gep/questionGenerator');
const { getEvolutionDir } = require('./gep/paths');
const { shouldReflect, buildReflectionContext, recordReflection, buildSuggestedMutations } = require('./gep/reflection');
const { loadNarrativeSummary } = require('./gep/narrativeMemory');
const { maybeReportIssue } = require('./gep/issueReporter');
const _shield = require('./gep/shield');
const _integrity = require('./gep/integrityCheck');

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

const STATE_FILE = path.join(getEvolutionDir(), 'evolution_state.json');

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

// --- Force Update: triggered by Hub when version is critically outdated ---
// Implementation extracted to src/forceUpdate.js so heartbeat workers (which
// never enter the evolve run() loop) can trigger the same upgrade path.
const { executeForceUpdate } = require('./forceUpdate');

async function run() {
  _shield.check();

  let ctx = await _guards.runGuards({});
  if (ctx.abort) return;

  const { bridgeEnabled } = ctx;

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

  // Maintenance: Clean up old logs to keep directory scan fast
  if (!IS_DRY_RUN) {
    performMaintenance();
  } else {
    console.log('[Maintenance] Skipped (dry-run mode).');
  }

  _guards.checkRepairLoopCircuitBreaker();

  ctx = await _collect.collectContext(ctx);
  const { recentMasterLog, todayLog, memorySnippet, userSnippet, cycleNum, cycleId, mutationDirective, healthReport, fileList, reportingDirective, moodStatus, memorySize, syncDirective, localStateSummary } = ctx;

  const scanTime = Date.now() - startTime;
  const initialUserPrompt = getCurrentSessionInitialPrompt();

  // Stage 3: load GEP assets (genes/capsules/events), extract signals from transcripts,
  // inject dormant-hypothesis / retry-context / curriculum signals, compute idle-gating.
  ctx = await _signals.extractSignalsStage({ ...ctx, lastHubFetchMs: _lastHubFetchMs });
  const { genes, capsules, recentEvents, signals, skipHubCalls } = ctx;

  // --- Hub Task Auto-Claim (with proactive questions) ---
  // Generate questions from current context, piggyback them on the fetch call,
  // then pick the best task and auto-claim it.
  let activeTask = null;
  let proactiveQuestions = [];
  if (!skipHubCalls) {
    try {
      proactiveQuestions = generateQuestions({
        signals,
        recentEvents,
        sessionTranscript: recentMasterLog,
        memorySnippet: memorySnippet,
      });
      if (proactiveQuestions.length > 0) {
        console.log(`[QuestionGenerator] Generated ${proactiveQuestions.length} proactive question(s).`);
      }
    } catch (e) {
      console.log(`[QuestionGenerator] Generation failed (non-fatal): ${e.message}`);
    }

    // --- Auto GitHub Issue Reporter ---
    // When persistent failures are detected, file an issue to the upstream repo
    // with sanitized logs and environment info.
    try {
      await maybeReportIssue({
        signals,
        recentEvents,
        sessionLog: recentMasterLog,
      });
    } catch (e) {
      console.log(`[IssueReporter] Check failed (non-fatal): ${e.message}`);
    }
  }

  // LessonL: lessons received from Hub during fetch
  let hubLessons = [];

  if (!skipHubCalls) {
    _lastHubFetchMs = Date.now();
    try {
      const fetchResult = await fetchTasks({ questions: proactiveQuestions });
      const hubTasks = fetchResult.tasks || [];

      const _debugTasks = process.env.EVOLVER_DEBUG_TASKS === '1';
      if (_debugTasks) {
        const _myNodeId = (function () {
          try { return require('./gep/a2aProtocol').getNodeId() || null; } catch { return null; }
        })();
        const _openCount = hubTasks.filter(function (t) { return t && t.status === 'open'; }).length;
        const _claimedMineCount = hubTasks.filter(function (t) { return t && t.status === 'claimed' && _myNodeId && t.claimed_by === _myNodeId; }).length;
        console.log('[TaskReceiver:debug] fetchTasks returned ' + hubTasks.length + ' task(s) (open=' + _openCount + ', claimed_by_me=' + _claimedMineCount + ')');
      }

      if (fetchResult.questions_created && fetchResult.questions_created.length > 0) {
        const created = fetchResult.questions_created.filter(function(q) { return !q.error; });
        const failed = fetchResult.questions_created.filter(function(q) { return q.error; });
        if (created.length > 0) {
          console.log(`[QuestionGenerator] Hub accepted ${created.length} question(s) as bounties.`);
        }
        if (failed.length > 0) {
          console.log(`[QuestionGenerator] Hub rejected ${failed.length} question(s): ${failed.map(function(q) { return q.error; }).join(', ')}`);
        }
      }

      // LessonL: capture relevant lessons from Hub
      if (Array.isArray(fetchResult.relevant_lessons) && fetchResult.relevant_lessons.length > 0) {
        hubLessons = fetchResult.relevant_lessons;
        console.log(`[LessonBank] Received ${hubLessons.length} lesson(s) from ecosystem.`);
      }

      // Opt-in validator role: process validation tasks assigned to this node.
      // Feature-gated by EVOLVER_VALIDATOR_ENABLED; no-ops when disabled.
      try {
        const { runValidatorCycle, isValidatorEnabled } = require('./gep/validator');
        if (isValidatorEnabled()) {
          const vr = await runValidatorCycle({});
          if (vr && vr.processed > 0) {
            console.log(`[Validator] Processed ${vr.processed}/${vr.tasks} validation task(s).`);
          }
        }
      } catch (e) {
        console.log(`[Validator] Cycle failed (non-fatal): ${e && e.message ? e.message : e}`);
      }

      if (hubTasks.length > 0) {
        let taskMemoryEvents = [];
        try {
          const { tryReadMemoryGraphEvents } = require('./gep/memoryGraph');
          taskMemoryEvents = tryReadMemoryGraphEvents(1000);
        } catch (e) {
          console.warn('[TaskReceiver] MemoryGraph read failed (task selection proceeds without history):', e && e.message || e);
        }
        const best = selectBestTask(hubTasks, taskMemoryEvents);
        if (!best && _debugTasks) {
          console.log('[TaskReceiver:debug] selectBestTask returned null from ' + hubTasks.length + ' task(s); likely no open tasks pass the capability filter (TASK_MIN_CAPABILITY_MATCH=' + (process.env.TASK_MIN_CAPABILITY_MATCH || '0.1') + '). Lower TASK_MIN_CAPABILITY_MATCH=0 or set TASK_STRATEGY=greedy to force claim anyway.');
        }
        if (best) {
          const alreadyClaimed = best.status === 'claimed';
          let claimed = alreadyClaimed;
          if (!alreadyClaimed) {
            const commitDeadline = estimateCommitmentDeadline(best);
            claimed = await claimTask(best.id || best.task_id, commitDeadline ? { commitment_deadline: commitDeadline } : undefined);
            if (_debugTasks && !claimed) {
              console.log('[TaskReceiver:debug] claimTask("' + (best.id || best.task_id) + '") returned false -- Hub rejected the claim (already claimed by another node, task closed, or auth failure). Check Hub /a2a/task/claim response manually to confirm.');
            }
            if (claimed && commitDeadline) {
              best._commitment_deadline = commitDeadline;
              console.log(`[Commitment] Deadline set: ${commitDeadline}`);
            }
          }
          if (claimed) {
            activeTask = best;
            const taskSignals = taskToSignalsWithPrivacy(best);
            for (const sig of taskSignals) {
              if (!signals.includes(sig)) signals.unshift(sig);
            }
            console.log(`[TaskReceiver] ${alreadyClaimed ? 'Resuming' : 'Claimed'} task: "${best.title || best.id}" (${taskSignals.length} signals injected)`);
          }
        }
      } else if (_debugTasks) {
        console.log('[TaskReceiver:debug] Hub returned 0 tasks this cycle. Either no open bounties match your node, or the fetch call hit a non-2xx status (set EVOLVER_DEBUG_A2A=1 for HTTP-level detail).');
      }
    } catch (e) {
      console.log(`[TaskReceiver] Fetch/claim failed (non-fatal): ${e.message}`);
    }
  }

  // --- Commitment: check for overdue tasks from heartbeat ---
  // If Hub reported overdue tasks, prioritize resuming them by injecting their
  // signals at the front. This does not change activeTask selection (the overdue
  // task should already be claimed/active from a previous cycle).
  try {
    const { consumeOverdueTasks } = require('./gep/a2aProtocol');
    const overdueTasks = consumeOverdueTasks();
    if (overdueTasks.length > 0) {
      for (const ot of overdueTasks) {
        const otId = ot.task_id || ot.id;
        if (activeTask && (activeTask.id === otId || activeTask.task_id === otId)) {
          console.warn(`[Commitment] Active task "${activeTask.title || otId}" is OVERDUE -- prioritizing completion.`);
          signals.unshift('overdue_task', 'urgent');
          break;
        }
      }
    }
  } catch (e) {
    console.warn('[Commitment] Overdue task check failed (non-fatal):', e && e.message || e);
  }

  // --- Hub Events: process pending high-priority events from /a2a/events/poll ---
  // Fetched automatically when heartbeat returns has_pending_events: true.
  // Injects event-specific signals and stores event context for LLM awareness.
  try {
    const { consumeHubEvents } = require('./gep/a2aProtocol');
    const hubEvents = consumeHubEvents();
    if (hubEvents.length > 0) {
      const HUB_EVENT_SIGNALS = {
        // ── 对话 ──────────────────────────────────────────────────────
        dialog_message:                ['dialog', 'respond_required'],

        // ── 议会 / 治理 ───────────────────────────────────────────────
        council_invite:                ['council', 'governance', 'respond_required'],
        council_second_request:        ['council', 'governance', 'second_request', 'respond_required'],
        council_vote:                  ['council', 'vote', 'governance', 'respond_required'],
        council_community_vote:        ['council', 'community_vote', 'governance', 'respond_required'],
        council_decision:              ['council', 'decision', 'governance'],
        council_decision_notification: ['council', 'governance'],

        // ── 审议 / 辩论 ───────────────────────────────────────────────
        deliberation_invite:           ['deliberation', 'governance', 'respond_required'],
        deliberation_challenge:        ['deliberation', 'challenge', 'respond_required'],
        deliberation_next_round:       ['deliberation', 'next_round', 'respond_required'],
        deliberation_completed:        ['deliberation', 'governance'],

        // ── 协作 / 会话 ───────────────────────────────────────────────
        collaboration_invite:          ['collaboration', 'respond_required'],
        session_message:               ['collaboration', 'dialog', 'respond_required'],
        session_nudge:                 ['collaboration', 'idle_warning'],
        task_board_update:             ['collaboration', 'task_update'],

        // ── 任务 / 工作池 ─────────────────────────────────────────────
        task_available:                ['task', 'work_available'],
        work_assigned:                 ['task', 'work_assigned'],
        swarm_subtask_available:       ['swarm', 'task', 'work_available'],
        swarm_aggregation_available:   ['swarm', 'aggregation', 'work_available'],
        diverge_task_assigned:         ['swarm', 'task', 'work_assigned'],
        pipeline_step_assigned:        ['pipeline', 'task', 'work_assigned'],
        organism_work:                 ['organism', 'task', 'work_assigned'],

        // ── 蜂群 PDRI 角色事件 ──────────────────────────────────────
        swarm_plan_available:          ['swarm', 'planner', 'work_available'],
        swarm_build_available:         ['swarm', 'builder', 'work_available'],
        swarm_review_available:        ['swarm', 'reviewer', 'work_available', 'respond_required'],
        swarm_aggregate_available:     ['swarm', 'aggregator', 'work_available'],
        swarm_rework_required:         ['swarm', 'rework', 'iterate'],
        subtask_failover:              ['swarm', 'failover', 'urgent'],
        team_formed:                   ['swarm', 'team', 'collaboration'],
        team_dissolved:                ['swarm', 'team'],

        // ── 隐私计算 ────────────────────────────────────────────────
        privacy_task_ready:            ['privacy', 'sealed_tool', 'work_available'],
        privacy_result_available:      ['privacy', 'result'],

        // ── 评审 / 赏金 ───────────────────────────────────────────────
        bounty_review_requested:       ['review', 'bounty', 'respond_required'],
        peer_review_request:           ['review', 'swarm', 'respond_required'],
        supplement_request:            ['supplement', 'respond_required'],

        // ── 成长 / 知识 ───────────────────────────────────────────────
        evolution_circle_formed:       ['evolution_circle', 'collaboration'],
        knowledge_update:              ['knowledge'],
        topic_notification:            ['topic', 'knowledge'],
        reflection_prompt:             ['reflection'],

        // ── 系统 ──────────────────────────────────────────────────────
        task_overdue:                  ['overdue_task', 'urgent'],

        // ── 方案嫁接 ─────────────────────────────────────────────────
        breakthrough_available:        ['swarm', 'breakthrough', 'graft_available'],

        // ── 涌现协作 ─────────────────────────────────────────────────
        emergent_exploration_started:  ['swarm', 'emergent', 'exploration'],
        emergent_convergence_detected: ['swarm', 'emergent', 'convergence'],
      };
      // Configuration handlers: events that mutate local persistent state
      // rather than inject LLM signals. Whitelisted to a small surface so
      // a compromised hub can only flip a known set of flags.
      const FEATURE_FLAG_WHITELIST = new Set(['validator_enabled']);
      const HUB_EVENT_HANDLERS = {
        feature_flag_update: function (ev) {
          try {
            const p = ev && ev.payload || {};
            const key = typeof p.key === 'string' ? p.key : null;
            const value = p.value;
            if (!key || !FEATURE_FLAG_WHITELIST.has(key)) return;
            if (typeof value !== 'boolean') return;
            const { writeFeatureFlag } = require('./gep/featureFlags');
            const ok = writeFeatureFlag(key, value, 'hub_mailbox');
            console.log('[FeatureFlags] hub set ' + key + '=' + value + (ok ? '' : ' (persist failed)'));
          } catch (e) {
            console.warn('[FeatureFlags] handler failed (non-fatal):', e && e.message || e);
          }
        },
      };

      for (const ev of hubEvents) {
        const handler = HUB_EVENT_HANDLERS[ev.type];
        if (handler) {
          handler(ev);
          continue;
        }
        const evSignals = HUB_EVENT_SIGNALS[ev.type] || ['hub_event'];
        for (const sig of evSignals) {
          if (!signals.includes(sig)) signals.unshift(sig);
        }
        console.log('[HubEvents] Event: ' + ev.type +
          (ev.payload && ev.payload.deliberation_id ? ' (deliberation: ' + ev.payload.deliberation_id + ')' : '') +
          ' → signals: ' + evSignals.join(', '));
      }
      // Store events in evidencefor LLM context on next evolve pass
      if (!global._pendingHubEventContext) global._pendingHubEventContext = [];
      global._pendingHubEventContext.push(...hubEvents);
    }
  } catch (e) {
    console.warn('[HubEvents] Processing failed (non-fatal):', e && e.message || e);
  }

  // --- Worker Pool: select task from heartbeat available_work (deferred claim) ---
  // Only remember the best task and inject its signals; actual claim+complete
  // happens atomically in solidify.js after a successful evolution cycle.
  if (!activeTask && process.env.WORKER_ENABLED === '1') {
    try {
      const { consumeAvailableWork } = require('./gep/a2aProtocol');
      const workerTasks = consumeAvailableWork();
      if (workerTasks.length > 0) {
        let taskMemoryEvents = [];
        try {
          const { tryReadMemoryGraphEvents } = require('./gep/memoryGraph');
          taskMemoryEvents = tryReadMemoryGraphEvents(1000);
        } catch (e) {
          console.warn('[WorkerPool] MemoryGraph read failed (task selection proceeds without history):', e && e.message || e);
        }
        const best = selectBestTask(workerTasks, taskMemoryEvents);
        if (best) {
          activeTask = best;
          activeTask._worker_pending = true;
          const taskSignals = taskToSignalsWithPrivacy(best);
          for (const sig of taskSignals) {
            if (!signals.includes(sig)) signals.unshift(sig);
          }
          console.log(`[WorkerPool] Selected worker task (deferred claim): "${best.title || best.id}" (${taskSignals.length} signals injected)`);
        }
      }
    } catch (e) {
      console.log(`[WorkerPool] Task selection failed (non-fatal): ${e.message}`);
    }
  }

  const recentErrorMatches = recentMasterLog.match(/\[ERROR|Error:|Exception:|FAIL|Failed|"isError":true/gi) || [];
  const recentErrorCount = recentErrorMatches.length;

  const evidence = {
    // Keep short; do not store full transcripts in the graph.
    recent_session_tail: String(recentMasterLog || '').slice(-6000),
    today_log_tail: String(todayLog || '').slice(-2500),
  };

  // Inject pending hub events into evidence so LLM sees them in context
  if (global._pendingHubEventContext && global._pendingHubEventContext.length > 0) {
    evidence.hub_events = global._pendingHubEventContext.splice(0, 10);
  }

  const sessionScope = getSessionScope();
  const observations = {
    agent: AGENT_NAME,
    session_scope: sessionScope || null,
    drift_enabled: IS_RANDOM_DRIFT,
    review_mode: IS_REVIEW_MODE,
    dry_run: IS_DRY_RUN,
    system_health: healthReport,
    mood: moodStatus,
    scan_ms: scanTime,
    memory_size_bytes: memorySize,
    recent_error_count: recentErrorCount,
    node: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    evidence,
  };

  if (sessionScope) {
    console.log(`[SessionScope] Active scope: "${sessionScope}". Evolution state and memory graph are isolated.`);
  }

  // Memory Graph: close last action with an inferred outcome (append-only graph, mutable state).
  try {
    recordOutcomeFromState({ signals, observations });
  } catch (e) {
    // If we can't read/write memory graph, refuse to evolve (no "memoryless evolution").
    console.error(`[MemoryGraph] Outcome write failed: ${e.message}`);
    console.error(`[MemoryGraph] Refusing to evolve without causal memory. Target: ${memoryGraphPath()}`);
    throw new Error(`MemoryGraph Outcome write failed: ${e.message}`);
  }

  // Memory Graph: record current signals as a first-class node. If this fails, refuse to evolve.
  try {
    recordSignalSnapshot({ signals, observations });
  } catch (e) {
    console.error(`[MemoryGraph] Signal snapshot write failed: ${e.message}`);
    console.error(`[MemoryGraph] Refusing to evolve without causal memory. Target: ${memoryGraphPath()}`);
    throw new Error(`MemoryGraph Signal snapshot write failed: ${e.message}`);
  }

  // Capability candidates: extract, persist, and build previews.
  const { capabilityCandidatesPreview, externalCandidatesPreview } = buildCandidatePreviews({
    signals,
    recentSessionTranscript: recentMasterLog,
  });

  // Search-First Evolution: query Hub for reusable solutions before local reasoning.
  // When problem-class signals are present, lower the threshold and extend timeout
  // to maximize the chance of finding an ecosystem-proven solution (EvoMap-First).
  let hubHit = null;
  if (!skipHubCalls) {
    try {
      const problemSignals = ['log_error', 'recurring_error', 'capability_gap', 'perf_bottleneck', 'test_failure', 'deployment_issue'];
      const hasProblemSignal = Array.isArray(signals) && signals.some(function (s) {
        for (var pi = 0; pi < problemSignals.length; pi++) {
          if (s === problemSignals[pi] || (typeof s === 'string' && s.startsWith('errsig:'))) return true;
        }
        return false;
      });
      const hubSearchOpts = hasProblemSignal
        ? { timeoutMs: 12000, threshold: 0.55 }
        : { timeoutMs: 8000 };
      if (hasProblemSignal) {
        console.log('[EvoMap-First] Problem signals detected -- expanding Hub search (threshold=0.55, timeout=12s).');
      }
      hubHit = await hubSearch(signals, hubSearchOpts);
      if (hubHit && hubHit.hit) {
        console.log(`[SearchFirst] Hub hit: asset=${hubHit.asset_id}, score=${hubHit.score}, mode=${hubHit.mode}`);
      } else {
        console.log(`[SearchFirst] No hub match (reason: ${hubHit && hubHit.reason ? hubHit.reason : 'unknown'}). Proceeding with local evolution.`);
        if (hasProblemSignal && !signals.includes('hub_search_miss_with_problem')) {
          signals.push('hub_search_miss_with_problem');
        }
      }
    } catch (e) {
      console.log(`[SearchFirst] Hub search failed (non-fatal): ${e.message}`);
      hubHit = { hit: false, reason: 'exception' };
    }
  } else {
    hubHit = { hit: false, reason: 'idle_skip' };
    console.log('[IdleGating] hubSearch skipped (idle cycle).');
  }

  // ATP Auto-Buyer: only trigger when (1) hub search missed, (2) capability_gap is
  // explicitly present, and (3) the auto-buyer was started at boot. Never blocks
  // the evolve loop -- all failures are non-fatal and swallowed.
  try {
    const hasCapabilityGap = Array.isArray(signals) && signals.includes('capability_gap');
    const hubMissed = !(hubHit && hubHit.hit);
    if (hasCapabilityGap && hubMissed) {
      const autoBuyer = require('./atp/autoBuyer');
      if (autoBuyer && autoBuyer.isStarted && autoBuyer.isStarted()) {
        const capsFromSignals = signals
          .filter(function (s) { return typeof s === 'string' && s.startsWith('cap:'); })
          .map(function (s) { return s.slice(4); });
        const capabilities = capsFromSignals.length > 0 ? capsFromSignals : ['code_evolution'];
        let composedQuestion;
        try {
          const qc = require('./atp/questionComposer');
          composedQuestion = qc.compose({ capabilities: capabilities, signals: signals.slice(0, 8) });
        } catch (qcErr) {
          composedQuestion = 'I would like help with ' + capabilities.slice(0, 3).join(', ') + '. Please provide one concrete, actionable answer.';
        }
        autoBuyer.considerOrder({
          capabilities: capabilities,
          question: composedQuestion,
          signals: signals.slice(0, 20),
          routingMode: 'fastest',
          verifyMode: 'auto',
        }).then(function (r) {
          if (r && r.ok) {
            console.log('[ATP-AutoBuyer] Placed order for capability_gap: ' + ((r.data && r.data.order_id) || 'unknown'));
          } else if (r && r.skipped) {
            console.log('[ATP-AutoBuyer] Skipped (' + r.reason + ').');
          } else if (r && r.error) {
            console.log('[ATP-AutoBuyer] Order failed (non-fatal): ' + r.error);
          }
        }).catch(function (abErr) {
          console.log('[ATP-AutoBuyer] considerOrder threw (non-fatal): ' + (abErr && abErr.message || abErr));
        });
      }
    }
  } catch (abOuterErr) {
    console.log('[ATP-AutoBuyer] Hook error (non-fatal): ' + (abOuterErr && abOuterErr.message || abOuterErr));
  }

  // Memory Graph reasoning: prefer high-confidence paths, suppress known low-success paths (unless drift is explicit).
  let memoryAdvice = null;
  try {
    memoryAdvice = getMemoryAdvice({ signals, genes, driftEnabled: IS_RANDOM_DRIFT });
  } catch (e) {
    console.error(`[MemoryGraph] Read failed: ${e.message}`);
    console.error(`[MemoryGraph] Refusing to evolve without causal memory. Target: ${memoryGraphPath()}`);
    throw new Error(`MemoryGraph Read failed: ${e.message}`);
  }

  // Reflection Phase: periodically pause to assess evolution strategy.
  try {
    const cycleState = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
    const cycleCount = cycleState.cycleCount || 0;
    if (shouldReflect({ cycleCount, recentEvents })) {
      const narrativeSummary = loadNarrativeSummary(3000);
      const reflectionCtx = buildReflectionContext({
        recentEvents,
        signals,
        memoryAdvice,
        narrative: narrativeSummary,
      });
      recordReflection({
        cycle_count: cycleCount,
        signals_snapshot: signals.slice(0, 20),
        preferred_gene: memoryAdvice && memoryAdvice.preferredGeneId ? memoryAdvice.preferredGeneId : null,
        banned_genes: memoryAdvice && Array.isArray(memoryAdvice.bannedGeneIds) ? memoryAdvice.bannedGeneIds : [],
        context_preview: reflectionCtx.slice(0, 1000),
        suggested_mutations: buildSuggestedMutations(signals),
      });
      console.log(`[Reflection] Strategic reflection recorded at cycle ${cycleCount}.`);
    }
  } catch (e) {
    console.log('[Reflection] Failed (non-fatal): ' + (e && e.message ? e.message : e));
  }

  let recentFailedCapsules = [];
  try {
    recentFailedCapsules = readRecentFailedCapsules(50);
  } catch (e) {
    console.log('[FailedCapsules] Read failed (non-fatal): ' + e.message);
  }

  // Heartbeat hints: novelty score and capability gaps for diversity-directed drift
  let heartbeatNovelty = null;
  let heartbeatCapGaps = [];
  try {
    const { getNoveltyHint, getCapabilityGaps: getCapGaps } = require('./gep/a2aProtocol');
    heartbeatNovelty = getNoveltyHint();
    heartbeatCapGaps = getCapGaps() || [];
  } catch (e) {}

  // --- Shared Knowledge: consume peer knowledge deltas ---
  let sharedKnowledgeContext = '';
  try {
    const { consumeSharedKnowledgeDelta } = require('./gep/a2aProtocol');
    const skDelta = consumeSharedKnowledgeDelta();
    if (skDelta && Array.isArray(skDelta.entries) && skDelta.entries.length > 0) {
      const peerEntries = skDelta.entries
        .filter(function (e) { return e.node_id !== require('./gep/a2aProtocol').getNodeId(); })
        .slice(0, 10);
      if (peerEntries.length > 0) {
        const lines = peerEntries.map(function (e) {
          if (e.type === 'attempt') return '[Attempt by ' + (e.node_id || '?').slice(0, 8) + '] score=' + (e.score || '?') + ' strategy: ' + (e.strategy || '?');
          if (e.type === 'note') return '[Note by ' + (e.node_id || '?').slice(0, 8) + '] ' + (e.content || '').slice(0, 300);
          if (e.type === 'insight') return '[Insight by ' + (e.node_id || '?').slice(0, 8) + '] ' + (e.content || '').slice(0, 300);
          return '[' + (e.type || 'unknown') + '] ' + JSON.stringify(e).slice(0, 200);
        });
        sharedKnowledgeContext = '\n\n--- Peer Knowledge (shared by collaborating nodes) ---\n' + lines.join('\n') + '\n--- End Peer Knowledge ---\n';
        console.log('[SharedKnowledge] Injecting ' + peerEntries.length + ' peer knowledge entries into context');
      }
    }
  } catch (e) {
    console.warn('[SharedKnowledge] Consumption failed (non-fatal):', e && e.message || e);
  }

  // --- Force Update Check ---
  try {
    const { consumeForceUpdate } = require('./gep/a2aProtocol');
    const forceUpdate = consumeForceUpdate();
    if (forceUpdate) {
      console.log('[ForceUpdate] Hub requires update to ' + (forceUpdate.required_version || 'latest'));
      console.log('[ForceUpdate] Reason: ' + (forceUpdate.reason || 'unspecified'));
      const updated = executeForceUpdate(forceUpdate);
      if (updated) {
        console.log('[ForceUpdate] Update complete. Exiting for restart...');
        process.exit(78);
      } else {
        console.warn('[ForceUpdate] Update failed. Will retry next cycle.');
      }
    }
  } catch (e) {
    console.warn('[ForceUpdate] Check failed (non-fatal):', e && e.message || e);
  }

  // --- Heartbeat Actions: proactive knowledge externalization ---
  let heartbeatActionContext = '';
  let plateauOverride = null;
  try {
    const { consumeHeartbeatActions } = require('./gep/a2aProtocol');
    const hbActions = consumeHeartbeatActions();
    if (hbActions && Array.isArray(hbActions.actions) && hbActions.actions.length > 0) {
      const actionPrompts = hbActions.actions.map(function (a) {
        return '[HeartbeatAction:' + a.type + '] ' + (a.prompt || '');
      });
      heartbeatActionContext = '\n\n--- Hub Heartbeat Directives ---\n' + actionPrompts.join('\n\n') + '\n--- End Heartbeat Directives ---\n';
      const pivotActions = hbActions.actions.filter(function (a) { return a.type === 'pivot_check'; });
      if (pivotActions.length > 0) {
        var hasRequired = pivotActions.some(function (a) { return a.severity === 'required'; });
        var pivotSeverity = hasRequired ? 'required' : 'suggested';
        var rawPivotEvals = Math.max.apply(null, pivotActions.map(function (a) { return a.evals_since_improvement || 0; }));
        var pivotEvals = Number.isFinite(rawPivotEvals) ? rawPivotEvals : 0;
        if (pivotSeverity === 'required') {
          if (!signals.includes('plateau_pivot_required')) signals.unshift('plateau_pivot_required');
          IS_RANDOM_DRIFT = true;
          if (!plateauOverride || plateauOverride.severity !== 'required') {
            plateauOverride = { active: true, severity: 'required', evalsSinceImprovement: pivotEvals, source: 'hub' };
          }
          try {
            var _fp = require('./gep/personality');
            _fp.forcePivot({ severity: 'required', evalsSinceImprovement: pivotEvals });
          } catch (_fpErr) {
            console.warn('[HeartbeatAction] forcePivot failed (non-fatal):', _fpErr && _fpErr.message || _fpErr);
          }
          console.log('[HeartbeatAction] Forced pivot: injecting plateau_pivot_required signal and enabling drift');
        } else {
          if (!signals.includes('plateau_pivot_suggested')) signals.unshift('plateau_pivot_suggested');
          if (!plateauOverride) {
            plateauOverride = { active: true, severity: 'suggested', evalsSinceImprovement: pivotEvals, source: 'hub' };
          }
          try {
            var _fp2 = require('./gep/personality');
            _fp2.forcePivot({ severity: 'suggested', evalsSinceImprovement: pivotEvals });
          } catch (_fpErr2) {
            console.warn('[HeartbeatAction] forcePivot failed (non-fatal):', _fpErr2 && _fpErr2.message || _fpErr2);
          }
          console.log('[HeartbeatAction] Pivot suggested: injecting plateau_pivot_suggested signal');
        }
      }
    }
  } catch (e) {
    console.warn('[HeartbeatAction] Processing failed (non-fatal):', e && e.message || e);
  }

  // --- Local Plateau Detection ---
  // Track consecutive non-improving evals using the evolution event history.
  // Complements Hub-side tracking (which uses Redis) for offline resilience.
  try {
    const PLATEAU_SUGGEST = 5;
    const PLATEAU_FORCE = 10;
    let localEvalsSinceImprovement = 0;
    const recentOutcomes = recentEvents.slice(-PLATEAU_FORCE).filter(function (e) {
      return e && e.outcome && e.outcome.status;
    });
    for (let pi = recentOutcomes.length - 1; pi >= 0; pi--) {
      if (recentOutcomes[pi].outcome.status === 'success') break;
      localEvalsSinceImprovement++;
    }
    if (localEvalsSinceImprovement >= PLATEAU_FORCE) {
      IS_RANDOM_DRIFT = true;
      if (!plateauOverride || plateauOverride.severity !== 'required') {
        plateauOverride = { active: true, severity: 'required', evalsSinceImprovement: localEvalsSinceImprovement, source: 'local' };
        try {
          var _lpf = require('./gep/personality');
          _lpf.forcePivot({ severity: 'required', evalsSinceImprovement: localEvalsSinceImprovement });
        } catch (e) {
          console.warn('[Plateau] forcePivot failed (non-fatal):', e && e.message || e);
        }
      }
      if (!signals.includes('plateau_pivot_required')) signals.unshift('plateau_pivot_required');
      console.log('[Plateau] Local detection: ' + localEvalsSinceImprovement + ' consecutive non-improving evals -> FORCED PIVOT (drift enabled)');
    } else if (localEvalsSinceImprovement >= PLATEAU_SUGGEST && !plateauOverride) {
      plateauOverride = { active: true, severity: 'suggested', evalsSinceImprovement: localEvalsSinceImprovement, source: 'local' };
      if (!signals.includes('plateau_pivot_suggested')) signals.unshift('plateau_pivot_suggested');
      console.log('[Plateau] Local detection: ' + localEvalsSinceImprovement + ' consecutive non-improving evals -> pivot suggested');
      try {
        var _lpf2 = require('./gep/personality');
        _lpf2.forcePivot({ severity: 'suggested', evalsSinceImprovement: localEvalsSinceImprovement });
      } catch (e) {
        console.warn('[Plateau] forcePivot failed (non-fatal):', e && e.message || e);
      }
    }
  } catch (e) {
    console.warn('[Plateau] Detection failed (non-fatal):', e && e.message || e);
  }

  // Stage 6: select gene + capsule, compute strategy policy and personality, build mutation,
  // record hypothesis and attempt in memory graph (both blocking — refuses to evolve on failure).
  ctx = await _select.selectAndMutate({
    ...ctx,
    IS_RANDOM_DRIFT,
    memoryAdvice,
    recentFailedCapsules,
    heartbeatCapGaps,
    heartbeatNovelty,
    plateauOverride,
    observations,
    hubHit,
  });
  const { selectedGene, capsuleCandidates, selector, selectedBy, selectedCapsuleId, strategyPolicy, personalitySelection, personalityState, mutation, forceInnovation } = ctx;

  // Stage 7: write solidify state, build GEP prompt, spawn executor via sessions_spawn (bridge)
  // or print to stdout (loop mode). Returns early without output when idle-gated.
  await _dispatch.dispatch({
    ...ctx,
    IS_RANDOM_DRIFT,
    IS_REVIEW_MODE,
    IS_DRY_RUN,
    AGENT_NAME,
    scanTime,
    initialUserPrompt,
    hubHit,
    activeTask,
    hubLessons,
    heartbeatActionContext,
    sharedKnowledgeContext,
    externalCandidatesPreview,
    capabilityCandidatesPreview,
    recentFailedCapsules,
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

