'use strict';

const { generateQuestions } = require('../../gep/questionGenerator');
const { maybeReportIssue } = require('../../gep/issueReporter');
const { fetchTasks, selectBestTask, claimTask, taskToSignalsWithPrivacy, estimateCommitmentDeadline } = require('../../gep/taskReceiver');

// ---------------------------------------------------------------------------
// Stage 4 — Hub Coordination
// ---------------------------------------------------------------------------
// Input ctx fields: signals, recentEvents, recentMasterLog, memorySnippet,
//                   genes, skipHubCalls
// Output ctx additions: activeTask, hubLessons
// Side-effect: signals[] is mutated in-place (task / overdue / hub-event signals)
// Returns lastHubFetchMs (set to Date.now() when fetch starts) so evolve.js can
// persist it as module-level _lastHubFetchMs across cycles.

async function hubCoordinate(ctx) {
  const { signals, recentEvents, recentMasterLog, memorySnippet, skipHubCalls } = ctx;

  let activeTask = null;
  let proactiveQuestions = [];
  let lastHubFetchMs = ctx.lastHubFetchMs || 0;

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
    lastHubFetchMs = Date.now();
    try {
      const fetchResult = await fetchTasks({ questions: proactiveQuestions });
      const hubTasks = fetchResult.tasks || [];

      const _debugTasks = process.env.EVOLVER_DEBUG_TASKS === '1';
      if (_debugTasks) {
        const _myNodeId = (function () {
          try { return require('../../gep/a2aProtocol').getNodeId() || null; } catch { return null; }
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
        const { runValidatorCycle, isValidatorEnabled } = require('../../gep/validator');
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
          const { tryReadMemoryGraphEvents } = require('../../gep/memoryGraph');
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
    const { consumeOverdueTasks } = require('../../gep/a2aProtocol');
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
    const { consumeHubEvents } = require('../../gep/a2aProtocol');
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
            const { writeFeatureFlag } = require('../../gep/featureFlags');
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
      // Store events in evidence for LLM context on next evolve pass
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
      const { consumeAvailableWork } = require('../../gep/a2aProtocol');
      const workerTasks = consumeAvailableWork();
      if (workerTasks.length > 0) {
        let taskMemoryEvents = [];
        try {
          const { tryReadMemoryGraphEvents } = require('../../gep/memoryGraph');
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

  return { ...ctx, signals, activeTask, hubLessons, lastHubFetchMs };
}

module.exports = { hubCoordinate };
