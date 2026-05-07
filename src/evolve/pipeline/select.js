'use strict';

const { selectGeneAndCapsule } = require('../../gep/selector');
const { buildMutation, isHighRiskMutationAllowed } = require('../../gep/mutation');
const { selectPersonalityForRun } = require('../../gep/personality');
const memoryAdapter = require('../../gep/memoryGraphAdapter');
const { recordHypothesis, recordAttempt, memoryGraphPath } = memoryAdapter;
const { expandSignals } = require('../../gep/learningSignals');
const { resolveStrategy } = require('../../gep/strategy');

function _verbose(...args) {
  if (String(process.env.EVOLVER_VERBOSE || '').toLowerCase() !== 'true') return;
  args.unshift('[Verbose]');
  console.log.apply(console, args);
}

// ---------------------------------------------------------------------------
// computeAdaptiveStrategyPolicy
// ---------------------------------------------------------------------------

function computeAdaptiveStrategyPolicy(opts) {
  const recentEvents = Array.isArray(opts && opts.recentEvents) ? opts.recentEvents : [];
  const selectedGene = opts && opts.selectedGene ? opts.selectedGene : null;
  const signals = Array.isArray(opts && opts.signals) ? opts.signals : [];
  const baseStrategy = resolveStrategy({ signals: signals });

  const tail = recentEvents.slice(-8);
  let repairStreak = 0;
  for (let i = tail.length - 1; i >= 0; i--) {
    if (tail[i] && tail[i].intent === 'repair') repairStreak++;
    else break;
  }
  let failureStreak = 0;
  for (let i = tail.length - 1; i >= 0; i--) {
    if (tail[i] && tail[i].outcome && tail[i].outcome.status === 'failed') failureStreak++;
    else break;
  }

  const antiPatterns = selectedGene && Array.isArray(selectedGene.anti_patterns) ? selectedGene.anti_patterns.slice(-5) : [];
  const learningHistory = selectedGene && Array.isArray(selectedGene.learning_history) ? selectedGene.learning_history.slice(-6) : [];
  const signalTags = new Set(expandSignals(signals, ''));
  const overlappingAntiPatterns = antiPatterns.filter(function (ap) {
    return ap && Array.isArray(ap.learning_signals) && ap.learning_signals.some(function (tag) {
      return signalTags.has(String(tag));
    });
  });
  const hardFailures = overlappingAntiPatterns.filter(function (ap) { return ap && ap.mode === 'hard'; }).length;
  const softFailures = overlappingAntiPatterns.filter(function (ap) { return ap && ap.mode !== 'hard'; }).length;
  const recentSuccesses = learningHistory.filter(function (x) { return x && x.outcome === 'success'; }).length;

  const stagnation = signals.includes('stable_success_plateau') ||
    signals.includes('evolution_saturation') ||
    signals.includes('empty_cycle_loop_detected') ||
    failureStreak >= 3 ||
    repairStreak >= 3;

  const forceInnovate = stagnation && !signals.includes('log_error');
  const highRiskGene = hardFailures >= 1 || (softFailures >= 2 && recentSuccesses === 0);
  const cautiousExecution = highRiskGene || failureStreak >= 2;

  let blastRadiusMaxFiles = selectedGene && selectedGene.constraints && Number.isFinite(Number(selectedGene.constraints.max_files))
    ? Number(selectedGene.constraints.max_files)
    : 12;
  if (cautiousExecution) blastRadiusMaxFiles = Math.max(2, Math.min(blastRadiusMaxFiles, 6));
  else if (forceInnovate) blastRadiusMaxFiles = Math.max(3, Math.min(blastRadiusMaxFiles, 10));

  const directives = [];
  directives.push('Base strategy: ' + baseStrategy.label + ' (' + baseStrategy.description + ')');
  if (forceInnovate) directives.push('Force strategy shift: prefer innovate over repeating repair/optimize.');
  if (highRiskGene) directives.push('Selected gene is high risk for current signals; keep blast radius narrow and prefer smallest viable change.');
  if (failureStreak >= 2) directives.push('Recent failure streak detected; avoid repeating recent failed approach.');
  directives.push('Target max files for this cycle: ' + blastRadiusMaxFiles + '.');

  return {
    name: baseStrategy.name,
    label: baseStrategy.label,
    description: baseStrategy.description,
    forceInnovate: forceInnovate,
    cautiousExecution: cautiousExecution,
    highRiskGene: highRiskGene,
    repairStreak: repairStreak,
    failureStreak: failureStreak,
    blastRadiusMaxFiles: blastRadiusMaxFiles,
    directives: directives,
  };
}

// ---------------------------------------------------------------------------
// Stage 6 — Selection & Mutation
// ---------------------------------------------------------------------------
// Input ctx fields: genes, capsules, signals, recentEvents, memoryAdvice,
//   recentFailedCapsules, heartbeatCapGaps, heartbeatNovelty, plateauOverride,
//   observations, IS_RANDOM_DRIFT, hubHit (optional, for verbose only)
// Output ctx additions: selectedGene, capsuleCandidates, selector, selectedBy,
//   capsulesUsed, selectedCapsuleId, strategyPolicy, personalitySelection,
//   personalityState, mutation, mutationInnovateMode, hypothesisId

async function selectAndMutate(ctx) {
  const {
    genes, capsules, signals, recentEvents,
    memoryAdvice, recentFailedCapsules,
    heartbeatCapGaps, heartbeatNovelty,
    plateauOverride, observations,
    IS_RANDOM_DRIFT,
    hubHit,
  } = ctx;

  const { selectedGene, capsuleCandidates, selector } = selectGeneAndCapsule({
    genes,
    capsules,
    signals,
    memoryAdvice,
    driftEnabled: IS_RANDOM_DRIFT,
    failedCapsules: recentFailedCapsules,
    capabilityGaps: heartbeatCapGaps,
    noveltyScore: heartbeatNovelty && Number.isFinite(heartbeatNovelty.score) ? heartbeatNovelty.score : null,
    plateauOverride,
  });

  const selectedBy = memoryAdvice && memoryAdvice.preferredGeneId ? 'memory_graph+selector' : 'selector';
  const capsulesUsed = Array.isArray(capsuleCandidates)
    ? capsuleCandidates.map(c => (c && c.id ? String(c.id) : null)).filter(Boolean)
    : [];
  const selectedCapsuleId = capsulesUsed.length ? capsulesUsed[0] : null;
  const strategyPolicy = computeAdaptiveStrategyPolicy({
    recentEvents,
    selectedGene,
    signals,
  });

  _verbose('Gene selection: gene=' + (selectedGene ? selectedGene.id : '(none)') + ' capsule=' + (selectedCapsuleId || '(none)') + ' selectedBy=' + selectedBy + ' selector=' + (selector || '(none)'));
  _verbose('Strategy policy: name=' + strategyPolicy.name + ' forceInnovate=' + strategyPolicy.forceInnovate + ' cautious=' + strategyPolicy.cautiousExecution + ' maxFiles=' + strategyPolicy.blastRadiusMaxFiles);
  if (memoryAdvice) {
    _verbose('Memory advice: preferred=' + (memoryAdvice.preferredGeneId || '(none)') + ' banned=[' + (Array.isArray(memoryAdvice.bannedGeneIds) ? memoryAdvice.bannedGeneIds.join(',') : '') + ']');
  }

  // Personality selection (natural selection + small mutation when triggered).
  // This state is persisted in MEMORY_DIR and is treated as an evolution control surface (not role-play).
  const personalitySelection = selectPersonalityForRun({
    driftEnabled: IS_RANDOM_DRIFT,
    signals,
    recentEvents,
  });
  const personalityState = personalitySelection && personalitySelection.personality_state ? personalitySelection.personality_state : null;

  // Mutation object is mandatory for every evolution run.
  const tail = Array.isArray(recentEvents) ? recentEvents.slice(-6) : [];
  const tailOutcomes = tail
    .map(e => (e && e.outcome && e.outcome.status ? String(e.outcome.status) : null))
    .filter(Boolean);
  const stableSuccess = tailOutcomes.length >= 6 && tailOutcomes.every(s => s === 'success');
  const tailAvgScore =
    tail.length > 0
      ? tail.reduce((acc, e) => acc + (e && e.outcome && Number.isFinite(Number(e.outcome.score)) ? Number(e.outcome.score) : 0), 0) /
        tail.length
      : 0;
  const innovationPressure =
    !IS_RANDOM_DRIFT &&
    personalityState &&
    Number.isFinite(Number(personalityState.creativity)) &&
    Number(personalityState.creativity) >= 0.75 &&
    stableSuccess &&
    tailAvgScore >= 0.7;
  const forceInnovation =
    String(process.env.FORCE_INNOVATION || process.env.EVOLVE_FORCE_INNOVATION || '').toLowerCase() === 'true';
  const mutationInnovateMode = !!IS_RANDOM_DRIFT || !!innovationPressure || !!forceInnovation || !!strategyPolicy.forceInnovate;
  const mutationSignals = innovationPressure ? [...(Array.isArray(signals) ? signals : []), 'stable_success_plateau'] : signals;
  const mutationSignalsEffective = (forceInnovation || strategyPolicy.forceInnovate)
    ? [...(Array.isArray(mutationSignals) ? mutationSignals : []), 'force_innovation']
    : mutationSignals;

  const allowHighRisk =
    !!IS_RANDOM_DRIFT &&
    !!personalitySelection &&
    !!personalitySelection.personality_known &&
    personalityState &&
    isHighRiskMutationAllowed(personalityState) &&
    Number(personalityState.rigor) >= 0.8 &&
    Number(personalityState.risk_tolerance) <= 0.3 &&
    !(Array.isArray(signals) && signals.includes('log_error'));
  const mutation = buildMutation({
    signals: mutationSignalsEffective,
    selectedGene,
    driftEnabled: mutationInnovateMode,
    personalityState,
    allowHighRisk,
  });

  _verbose('Mutation: category=' + (mutation && mutation.category || '?') + ' risk=' + (mutation && mutation.risk_level || '?') + ' innovateMode=' + mutationInnovateMode + ' forceInnovation=' + forceInnovation + ' allowHighRisk=' + allowHighRisk);
  _verbose('Hub: hubHit=' + (hubHit && hubHit.hit ? 'true (score=' + hubHit.score + ' mode=' + hubHit.mode + ')' : 'false (' + (hubHit && hubHit.reason || 'unknown') + ')'));

  // Memory Graph: record hypothesis bridging Signal -> Action. If this fails, refuse to evolve.
  let hypothesisId = null;
  try {
    const hyp = recordHypothesis({
      signals,
      mutation,
      personality_state: personalityState,
      selectedGene,
      selector,
      driftEnabled: mutationInnovateMode,
      selectedBy,
      capsulesUsed,
      observations,
    });
    hypothesisId = hyp && hyp.hypothesisId ? hyp.hypothesisId : null;
  } catch (e) {
    console.error(`[MemoryGraph] Hypothesis write failed: ${e.message}`);
    console.error(`[MemoryGraph] Refusing to evolve without causal memory. Target: ${memoryGraphPath()}`);
    throw new Error(`MemoryGraph Hypothesis write failed: ${e.message}`);
  }

  // Memory Graph: record the chosen causal path for this run. If this fails, refuse to output a mutation prompt.
  try {
    recordAttempt({
      signals,
      mutation,
      personality_state: personalityState,
      selectedGene,
      selector,
      driftEnabled: mutationInnovateMode,
      selectedBy,
      hypothesisId,
      capsulesUsed,
      observations,
    });
  } catch (e) {
    console.error(`[MemoryGraph] Attempt write failed: ${e.message}`);
    console.error(`[MemoryGraph] Refusing to evolve without causal memory. Target: ${memoryGraphPath()}`);
    throw new Error(`MemoryGraph Attempt write failed: ${e.message}`);
  }

  return {
    ...ctx,
    selectedGene,
    capsuleCandidates,
    selector,
    selectedBy,
    capsulesUsed,
    selectedCapsuleId,
    strategyPolicy,
    personalitySelection,
    personalityState,
    mutation,
    mutationInnovateMode,
    forceInnovation,
    hypothesisId,
  };
}

module.exports = { selectAndMutate, computeAdaptiveStrategyPolicy };
