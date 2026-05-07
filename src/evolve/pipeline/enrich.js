'use strict';

const fs = require('fs');
const path = require('path');
const { hubSearch } = require('../../gep/hubSearch');
const { buildCandidatePreviews } = require('../../gep/candidateEval');
const memoryAdapter = require('../../gep/memoryGraphAdapter');
const {
  getAdvice: getMemoryAdvice,
  recordSignalSnapshot,
  recordOutcome: recordOutcomeFromState,
  memoryGraphPath,
} = memoryAdapter;
const { shouldReflect, buildReflectionContext, recordReflection, buildSuggestedMutations } = require('../../gep/reflection');
const { loadNarrativeSummary } = require('../../gep/narrativeMemory');
const { readRecentFailedCapsules } = require('../../gep/assetStore');
const { getSessionScope, getEvolutionDir } = require('../../gep/paths');
const { executeForceUpdate } = require('../../forceUpdate');

// ---------------------------------------------------------------------------
// Stage 5 — Enrichment
// ---------------------------------------------------------------------------
// Input ctx fields: signals, recentEvents, recentMasterLog, todayLog, genes,
//   capsules, skipHubCalls, activeTask, hubLessons,
//   IS_RANDOM_DRIFT, IS_REVIEW_MODE, IS_DRY_RUN, AGENT_NAME,
//   scanTime, memorySize, healthReport, moodStatus
// Output ctx additions: observations, capabilityCandidatesPreview,
//   externalCandidatesPreview, hubHit, memoryAdvice, recentFailedCapsules,
//   heartbeatNovelty, heartbeatCapGaps, sharedKnowledgeContext,
//   heartbeatActionContext, plateauOverride
// Side-effects: signals[] mutated; IS_RANDOM_DRIFT may be set to true
//   (returned in ctx.IS_RANDOM_DRIFT so evolve.js can sync its module var)

async function enrich(ctx) {
  let {
    signals, recentEvents, recentMasterLog, todayLog, genes,
    skipHubCalls, activeTask,
    IS_RANDOM_DRIFT, IS_REVIEW_MODE, IS_DRY_RUN, AGENT_NAME,
    scanTime, memorySize, healthReport, moodStatus,
  } = ctx;

  const STATE_FILE = path.join(getEvolutionDir(), 'evolution_state.json');

  // Build observations object (used by memory graph and passed to Stage 6)
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
      const autoBuyer = require('../../atp/autoBuyer');
      if (autoBuyer && autoBuyer.isStarted && autoBuyer.isStarted()) {
        const capsFromSignals = signals
          .filter(function (s) { return typeof s === 'string' && s.startsWith('cap:'); })
          .map(function (s) { return s.slice(4); });
        const capabilities = capsFromSignals.length > 0 ? capsFromSignals : ['code_evolution'];
        let composedQuestion;
        try {
          const qc = require('../../atp/questionComposer');
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
    const { getNoveltyHint, getCapabilityGaps: getCapGaps } = require('../../gep/a2aProtocol');
    heartbeatNovelty = getNoveltyHint();
    heartbeatCapGaps = getCapGaps() || [];
  } catch (e) {}

  // --- Shared Knowledge: consume peer knowledge deltas ---
  let sharedKnowledgeContext = '';
  try {
    const { consumeSharedKnowledgeDelta } = require('../../gep/a2aProtocol');
    const skDelta = consumeSharedKnowledgeDelta();
    if (skDelta && Array.isArray(skDelta.entries) && skDelta.entries.length > 0) {
      const peerEntries = skDelta.entries
        .filter(function (e) { return e.node_id !== require('../../gep/a2aProtocol').getNodeId(); })
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
    const { consumeForceUpdate } = require('../../gep/a2aProtocol');
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
    const { consumeHeartbeatActions } = require('../../gep/a2aProtocol');
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
            var _fp = require('../../gep/personality');
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
            var _fp2 = require('../../gep/personality');
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
          var _lpf = require('../../gep/personality');
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
        var _lpf2 = require('../../gep/personality');
        _lpf2.forcePivot({ severity: 'suggested', evalsSinceImprovement: localEvalsSinceImprovement });
      } catch (e) {
        console.warn('[Plateau] forcePivot failed (non-fatal):', e && e.message || e);
      }
    }
  } catch (e) {
    console.warn('[Plateau] Detection failed (non-fatal):', e && e.message || e);
  }

  return {
    ...ctx,
    signals,
    observations,
    capabilityCandidatesPreview,
    externalCandidatesPreview,
    hubHit,
    memoryAdvice,
    recentFailedCapsules,
    heartbeatNovelty,
    heartbeatCapGaps,
    sharedKnowledgeContext,
    heartbeatActionContext,
    plateauOverride,
    IS_RANDOM_DRIFT,
  };
}

module.exports = { enrich };
