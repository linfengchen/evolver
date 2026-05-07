'use strict';

const { extractSignals } = require('../../gep/signals');
const { loadGenes, loadCapsules, readAllEvents } = require('../../gep/assetStore');
const { readStateForSolidify } = require('../../gep/solidify');

function _verbose(...args) {
  if (String(process.env.EVOLVER_VERBOSE || '').toLowerCase() !== 'true') return;
  args.unshift('[Verbose]');
  console.log.apply(console, args);
}

// ---------------------------------------------------------------------------
// Idle-cycle gating
// ---------------------------------------------------------------------------
// When evolver is saturated (no actionable signals), Hub calls are throttled to at most
// once per EVOLVER_IDLE_FETCH_INTERVAL_MS (default 30 min) instead of every cycle.

function shouldSkipHubCalls(signals) {
  if (!Array.isArray(signals)) return false;
  const saturationIndicators = ['force_steady_state', 'evolution_saturation', 'empty_cycle_loop_detected'];
  let hasSaturation = false;
  for (let si = 0; si < saturationIndicators.length; si++) {
    if (signals.indexOf(saturationIndicators[si]) !== -1) { hasSaturation = true; break; }
  }
  if (!hasSaturation) return false;

  const actionablePatterns = [
    'log_error', 'recurring_error', 'capability_gap', 'perf_bottleneck',
    'external_task', 'bounty_task', 'overdue_task', 'urgent',
    'unsupported_input_type',
  ];
  for (let ai = 0; ai < signals.length; ai++) {
    const s = signals[ai];
    if (actionablePatterns.indexOf(s) !== -1) return false;
    if (s.indexOf('errsig:') === 0) return false;
    if (s.indexOf('user_feature_request:') === 0 && s.length > 21) return false;
    if (s.indexOf('user_improvement_suggestion:') === 0 && s.length > 28) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Stage 3 — Signal Extraction
// ---------------------------------------------------------------------------
// Input ctx fields: dormantHypothesis, recentMasterLog, todayLog, memorySnippet,
//                   userSnippet, lastHubFetchMs
// Output ctx additions: genes, capsules, recentEvents, signals, skipHubCalls

async function extractSignalsStage(ctx) {
  const { dormantHypothesis, recentMasterLog, todayLog, memorySnippet, userSnippet } = ctx;
  const lastHubFetchMs = ctx.lastHubFetchMs || 0;

  const genes = loadGenes();
  const capsules = loadCapsules();
  const recentEvents = (() => {
    try {
      const all = readAllEvents();
      return Array.isArray(all) ? all.filter(e => e && e.type === 'EvolutionEvent').slice(-80) : [];
    } catch (e) {
      return [];
    }
  })();

  const signals = extractSignals({
    recentSessionTranscript: recentMasterLog,
    todayLog,
    memorySnippet,
    userSnippet,
    recentEvents,
  });

  _verbose('Signals extracted (' + signals.length + '):', signals.join(', '));
  _verbose('Recent events: ' + recentEvents.length + ', session log size: ' + recentMasterLog.length + ' chars');

  // Inject signals from dormant hypothesis (previous interrupted cycle).
  if (dormantHypothesis && Array.isArray(dormantHypothesis.signals) && dormantHypothesis.signals.length > 0) {
    const dormantSignals = dormantHypothesis.signals;
    let injected = 0;
    for (let dsi = 0; dsi < dormantSignals.length; dsi++) {
      if (!signals.includes(dormantSignals[dsi])) {
        signals.push(dormantSignals[dsi]);
        injected++;
      }
    }
    if (injected > 0) {
      console.log('[DormantHypothesis] Injected ' + injected + ' signal(s) from previous interrupted cycle.');
    }
  }

  // --- Idle-cycle gating: skip Hub API calls during saturation to save credits ---
  let _idleFetchInterval = parseInt(String(process.env.EVOLVER_IDLE_FETCH_INTERVAL_MS || ''), 10);
  if (!Number.isFinite(_idleFetchInterval) || _idleFetchInterval <= 0) _idleFetchInterval = 600000;
  let skipHubCalls = false;

  if (shouldSkipHubCalls(signals)) {
    const _elapsed = Date.now() - lastHubFetchMs;
    if (lastHubFetchMs > 0 && _elapsed < _idleFetchInterval) {
      skipHubCalls = true;
      console.log('[IdleGating] Saturated with no actionable signals. Skipping Hub API calls (last fetch ' + Math.round(_elapsed / 1000) + 's ago, threshold ' + Math.round(_idleFetchInterval / 1000) + 's).');
      if (process.env.EVOLVER_DEBUG_TASKS === '1') {
        console.log('[IdleGating:debug] Task fetch/claim is skipped this cycle because of idle gating. To force Hub fetches on every cycle, lower EVOLVER_IDLE_FETCH_INTERVAL_MS (e.g. =0). To make a signal actionable and bypass the gate, publish signals like bounty_task, external_task, log_error, etc.');
      }
    } else {
      console.log('[IdleGating] Saturated but fetch interval elapsed (' + Math.round((Date.now() - lastHubFetchMs) / 1000) + 's). Performing periodic Hub check.');
    }
  }

  // Inject retry context from previous validation failure.
  try {
    var solidifyState = readStateForSolidify();
    if (solidifyState && solidifyState.last_validation_failure) {
      var lvf = solidifyState.last_validation_failure;
      signals.push('retry_error_context');
      if (lvf.cmd) signals.push('retry_cmd:' + String(lvf.cmd).slice(0, 80));
      if (lvf.stderr) signals.push('retry_stderr:' + String(lvf.stderr).slice(0, 120));
      console.log('[RetryContext] Injected validation failure context from previous solidify (retries=' + (lvf.retries_attempted || 0) + ').');
    }
  } catch (_) {}

  // Curriculum engine: generate progressive evolution targets.
  try {
    var { generateCurriculumSignals } = require('../../gep/curriculum');
    var { getCapabilityGaps: _getCapGapsEarly } = require('../../gep/a2aProtocol');
    var earlyCapGaps = [];
    try { earlyCapGaps = _getCapGapsEarly() || []; } catch (_) {}
    var memGraphPath = require('../../gep/memoryGraph').memoryGraphPath ? require('../../gep/memoryGraph').memoryGraphPath() : '';
    var curriculumSignals = generateCurriculumSignals({
      capabilityGaps: earlyCapGaps,
      memoryGraphPath: memGraphPath,
      personality: {},
    });
    for (var ci = 0; ci < curriculumSignals.length; ci++) {
      if (!signals.includes(curriculumSignals[ci])) {
        signals.push(curriculumSignals[ci]);
      }
    }
    if (curriculumSignals.length > 0) {
      console.log('[Curriculum] Injected ' + curriculumSignals.length + ' curriculum target(s).');
    }
  } catch (e) {
    console.log('[Curriculum] Failed (non-fatal): ' + (e && e.message ? e.message : e));
  }

  return { ...ctx, genes, capsules, recentEvents, signals, skipHubCalls };
}

module.exports = { extractSignalsStage, shouldSkipHubCalls };
