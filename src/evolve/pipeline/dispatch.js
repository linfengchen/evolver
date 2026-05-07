'use strict';

const { execSync } = require('child_process');
const { getLastEventId } = require('../../gep/assetStore');
const { buildGepPrompt, buildReusePrompt, buildHubMatchedBlock } = require('../../gep/prompt');
const { logAssetCall } = require('../../gep/assetCallLog');
const { readStateForSolidify, writeStateForSolidify } = require('../../gep/solidify');
const { clip, writePromptArtifact, renderSessionsSpawnCall } = require('../../gep/bridge');
const { getEvolutionDir, getRepoRoot } = require('../../gep/paths');
const { tryExplore } = require('../../gep/explore');

const MAX_EXEC_BUFFER = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Stage 7 — Prompt Build & Dispatch
// ---------------------------------------------------------------------------
// Input ctx fields (from prior stages + module-level flags injected by run()):
//   bridgeEnabled (Stage 1)
//   recentMasterLog, todayLog, memorySnippet, userSnippet, cycleNum, cycleId,
//     mutationDirective, healthReport, fileList, reportingDirective, moodStatus,
//     memorySize, syncDirective, localStateSummary (Stage 2)
//   genes, capsules, recentEvents, signals, skipHubCalls (Stage 3)
//   hubHit, activeTask, hubLessons, heartbeatActionContext, sharedKnowledgeContext,
//     externalCandidatesPreview, capabilityCandidatesPreview, recentFailedCapsules (Stage 4/5)
//   selectedGene, capsuleCandidates, selector, selectedBy, selectedCapsuleId,
//     strategyPolicy, personalitySelection, personalityState, mutation, forceInnovation (Stage 6)
//   IS_RANDOM_DRIFT, IS_REVIEW_MODE, IS_DRY_RUN, AGENT_NAME,
//     scanTime, initialUserPrompt (injected by run() at dispatch call-site)
// Returns: nothing (terminal stage — outputs via console or bridge)

async function dispatch(ctx) {
  const {
    bridgeEnabled,
    recentMasterLog, todayLog, memorySnippet, userSnippet,
    cycleNum, cycleId, mutationDirective, healthReport, fileList,
    reportingDirective, moodStatus, memorySize, syncDirective, localStateSummary,
    genes, capsules, recentEvents, signals, skipHubCalls,
    hubHit, activeTask, hubLessons,
    heartbeatActionContext, sharedKnowledgeContext,
    externalCandidatesPreview, capabilityCandidatesPreview,
    recentFailedCapsules,
    selectedGene, capsuleCandidates, selector, selectedBy, selectedCapsuleId,
    strategyPolicy, personalitySelection, personalityState, mutation, forceInnovation,
    IS_RANDOM_DRIFT, IS_REVIEW_MODE, IS_DRY_RUN, AGENT_NAME,
    scanTime, initialUserPrompt,
  } = ctx;

  const REPO_ROOT = getRepoRoot();

  // Solidify state: capture minimal, auditable context for post-patch validation + asset write.
  // This enforces strict protocol closure after patch application.
  try {
    const runId = `run_${Date.now()}`;
    const parentEventId = getLastEventId();

    // Baseline snapshot (before any edits).
    let baselineUntracked = [];
    let baselineHead = null;
    try {
      const out = execSync('git ls-files --others --exclude-standard', {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
        windowsHide: true, maxBuffer: MAX_EXEC_BUFFER
      });
      baselineUntracked = String(out)
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
    } catch (e) {
      console.warn('[SolidifyState] Failed to read baseline untracked files:', e && e.message || e);
    }

    try {
      const out = execSync('git rev-parse HEAD', {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
        windowsHide: true, maxBuffer: MAX_EXEC_BUFFER
      });
      baselineHead = String(out || '').trim() || null;
    } catch (e) {
      console.warn('[SolidifyState] Failed to read git HEAD:', e && e.message || e);
    }

    const maxFiles = strategyPolicy && Number.isFinite(Number(strategyPolicy.blastRadiusMaxFiles))
      ? Number(strategyPolicy.blastRadiusMaxFiles)
      : (
        selectedGene && selectedGene.constraints && Number.isFinite(Number(selectedGene.constraints.max_files))
          ? Number(selectedGene.constraints.max_files)
          : 12
      );
    const blastRadiusEstimate = {
      files: Number.isFinite(maxFiles) && maxFiles > 0 ? maxFiles : 0,
      lines: Number.isFinite(maxFiles) && maxFiles > 0 ? Math.round(maxFiles * 80) : 0,
    };

    // Merge into existing state to preserve last_solidify (do not wipe it).
    const prevState = readStateForSolidify();
    prevState.last_run = {
        run_id: runId,
        created_at: new Date().toISOString(),
        parent_event_id: parentEventId || null,
        selected_gene_id: selectedGene && selectedGene.id ? selectedGene.id : null,
        selected_capsule_id: selectedCapsuleId,
        selector: selector || null,
        signals: Array.isArray(signals) ? signals : [],
        mutation: mutation || null,
        mutation_id: mutation && mutation.id ? mutation.id : null,
        personality_state: personalityState || null,
        personality_key: personalitySelection && personalitySelection.personality_key ? personalitySelection.personality_key : null,
        personality_known: !!(personalitySelection && personalitySelection.personality_known),
        personality_mutations:
          personalitySelection && Array.isArray(personalitySelection.personality_mutations)
            ? personalitySelection.personality_mutations
            : [],
        drift: !!IS_RANDOM_DRIFT,
        selected_by: selectedBy,
        source_type: hubHit && hubHit.hit ? (hubHit.mode === 'direct' ? 'reused' : 'reference') : 'generated',
        reused_asset_id: hubHit && hubHit.hit ? (hubHit.asset_id || null) : null,
        reused_source_node: hubHit && hubHit.hit ? (hubHit.source_node_id || null) : null,
        reused_chain_id: hubHit && hubHit.hit ? (hubHit.chain_id || null) : null,
        baseline_untracked: baselineUntracked,
        baseline_git_head: baselineHead,
        blast_radius_estimate: blastRadiusEstimate,
        strategy_policy: strategyPolicy,
        active_task_id: activeTask ? (activeTask.id || activeTask.task_id || null) : null,
        active_task_title: activeTask ? (activeTask.title || null) : null,
        worker_assignment_id: activeTask ? (activeTask._worker_assignment_id || null) : null,
        worker_pending: activeTask ? (activeTask._worker_pending || false) : false,
        commitment_deadline: activeTask ? (activeTask._commitment_deadline || null) : null,
        applied_lessons: hubLessons.map(function(l) { return l.lesson_id; }).filter(Boolean),
        hub_lessons: hubLessons,
        cycleId: cycleNum,
        initial_user_prompt: initialUserPrompt,
      };
    writeStateForSolidify(prevState);

    if (hubHit && hubHit.hit) {
      const assetAction = hubHit.mode === 'direct' ? 'asset_reuse' : 'asset_reference';
      logAssetCall({
        run_id: runId,
        action: assetAction,
        asset_id: hubHit.asset_id || null,
        asset_type: hubHit.match && hubHit.match.type ? hubHit.match.type : null,
        source_node_id: hubHit.source_node_id || null,
        chain_id: hubHit.chain_id || null,
        score: hubHit.score || null,
        mode: hubHit.mode,
        signals: Array.isArray(signals) ? signals : [],
        extra: {
          selected_gene_id: selectedGene && selectedGene.id ? selectedGene.id : null,
          task_id: activeTask ? (activeTask.id || activeTask.task_id || null) : null,
        },
      });
    }
  } catch (e) {
    console.error(`[SolidifyState] Write failed: ${e.message}`);
  }

  if (skipHubCalls) {
    try {
      const exploreResult = await tryExplore(signals, null, REPO_ROOT);
      if (exploreResult && exploreResult.signals && exploreResult.signals.length > 0) {
        console.log('[Explore] Discovered ' + exploreResult.signals.length + ' new signals during idle exploration.');
        for (var ei = 0; ei < exploreResult.signals.length; ei++) {
          if (!signals.includes(exploreResult.signals[ei])) {
            signals.push(exploreResult.signals[ei]);
          }
        }
      }
    } catch (exploreErr) {
      console.error('[Explore] Error during idle exploration: ' + exploreErr.message);
    }
    console.log('[IdleGating] Idle cycle complete. Prompt generation and bridge spawning skipped.');
    return;
  }

  const genesPreview = `\`\`\`json\n${JSON.stringify(genes.slice(0, 6), null, 2)}\n\`\`\``;
  const capsulesPreview = `\`\`\`json\n${JSON.stringify(capsules.slice(-3), null, 2)}\n\`\`\``;

  const reviewNote = IS_REVIEW_MODE
    ? 'Review mode: before significant edits, pause and ask the user for confirmation.'
    : 'Review mode: disabled.';

  // Build recent evolution history summary for context injection
  const recentHistorySummary = (() => {
    if (!recentEvents || recentEvents.length === 0) return '(no prior evolution events)';
    const last8 = recentEvents.slice(-8);
    const lines = last8.map((evt, idx) => {
      const sigs = Array.isArray(evt.signals) ? evt.signals.slice(0, 3).join(', ') : '?';
      const gene = Array.isArray(evt.genes_used) && evt.genes_used.length ? evt.genes_used[0] : 'none';
      const outcome = evt.outcome && evt.outcome.status ? evt.outcome.status : '?';
      const ts = evt.meta && evt.meta.at ? evt.meta.at : (evt.id || '');
      return `  ${idx + 1}. [${evt.intent || '?'}] signals=[${sigs}] gene=${gene} outcome=${outcome} @${ts}`;
    });
    return lines.join('\n');
  })();

  const context = `
Initial User Prompt (Original Intent):
${initialUserPrompt ? '```\n' + initialUserPrompt + '\n```' : '(not available)'}

Runtime state:
- System health: ${healthReport}
- Agent state: ${moodStatus}
- Scan duration: ${scanTime}ms
- Memory size: ${memorySize} bytes
- Skills available (if any):
${fileList || '[skills directory not found]'}

Local State (ALREADY CONFIGURED -- do NOT duplicate):
${localStateSummary}

Notes:
- ${reviewNote}
- ${reportingDirective}
- ${syncDirective}

Recent Evolution History (last 8 cycles -- DO NOT repeat the same intent+signal+gene):
${recentHistorySummary}
IMPORTANT: If you see 3+ consecutive "repair" cycles with the same gene, you MUST switch to "innovate" intent.
${(() => {
  // Compute consecutive failure count from recent events for context injection
  let cfc = 0;
  const evts = Array.isArray(recentEvents) ? recentEvents : [];
  for (let i = evts.length - 1; i >= 0; i--) {
    if (evts[i] && evts[i].outcome && evts[i].outcome.status === 'failed') cfc++;
    else break;
  }
  if (cfc >= 3) {
    return `\nFAILURE STREAK WARNING: The last ${cfc} cycles ALL FAILED. You MUST change your approach.\n- Do NOT repeat the same gene/strategy. Pick a completely different approach.\n- If the error is external (API down, binary missing), mark as FAILED and move on.\n- Prefer a minimal safe innovate cycle over yet another failing repair.`;
  }
  return '';
})()}

External candidates (A2A receive zone; staged only, never execute directly):
${externalCandidatesPreview}

Global memory (MEMORY.md):
\`\`\`
${memorySnippet}
\`\`\`

User registry (USER.md):
\`\`\`
${userSnippet}
\`\`\`

Recent memory snippet:
\`\`\`
${todayLog.slice(-3000)}
\`\`\`

Recent session transcript:
\`\`\`
${recentMasterLog}
\`\`\`

Mutation directive:
${mutationDirective}
${heartbeatActionContext}
${sharedKnowledgeContext}
`.trim();

  // Build the prompt: in direct-reuse mode, use a minimal reuse prompt.
  // In reference mode (or no hit), use the full GEP prompt with hub match injected.
  const isDirectReuse = hubHit && hubHit.hit && hubHit.mode === 'direct';
  const hubMatchedBlock = hubHit && hubHit.hit && hubHit.mode === 'reference'
    ? buildHubMatchedBlock({ capsule: hubHit.match })
    : null;

  const prompt = isDirectReuse
    ? buildReusePrompt({
        capsule: hubHit.match,
        signals,
        nowIso: new Date().toISOString(),
      })
    : buildGepPrompt({
        nowIso: new Date().toISOString(),
        context,
        signals,
        selector,
        parentEventId: getLastEventId(),
        selectedGene,
        capsuleCandidates,
        genesPreview,
        capsulesPreview,
        capabilityCandidatesPreview,
        externalCandidatesPreview,
        hubMatchedBlock,
        strategyPolicy,
        failedCapsules: recentFailedCapsules,
        hubLessons,
        cycleId: cycleNum,
        initialUserPrompt,
      });

  // Optional: emit a compact thought process block for wrappers (noise-controlled).
  const emitThought = String(process.env.EVOLVE_EMIT_THOUGHT_PROCESS || '').toLowerCase() === 'true';
  if (emitThought) {
    const s = Array.isArray(signals) ? signals : [];
    const thought = [
      `cycle_id: ${cycleId}`,
      `signals_count: ${s.length}`,
      `signals: ${s.slice(0, 12).join(', ')}${s.length > 12 ? ' ...' : ''}`,
      `selected_gene: ${selectedGene && selectedGene.id ? String(selectedGene.id) : '(none)'}`,
      `selected_capsule: ${selectedCapsuleId ? String(selectedCapsuleId) : '(none)'}`,
      `mutation_category: ${mutation && mutation.category ? String(mutation.category) : '(none)'}`,
      `force_innovation: ${forceInnovation ? 'true' : 'false'}`,
      `source_type: ${hubHit && hubHit.hit ? (isDirectReuse ? 'reused' : 'reference') : 'generated'}`,
      `hub_reuse_mode: ${isDirectReuse ? 'direct' : hubMatchedBlock ? 'reference' : 'none'}`,
    ].join('\n');
    console.log(`[THOUGHT_PROCESS]\n${thought}\n[/THOUGHT_PROCESS]`);
  }

  const printPrompt = String(process.env.EVOLVE_PRINT_PROMPT || '').toLowerCase() === 'true';

  // Default behavior (v1.4.1+): "execute-by-default" by bridging prompt -> sub-agent via sessions_spawn.
  // This project is the Brain; the Hand is a spawned executor agent. Wrappers can disable bridging with EVOLVE_BRIDGE=false.
  if (bridgeEnabled) {
    // Reuse the run_id stored in the solidify state when possible.
    let runId = `run_${Date.now()}`;
    try {
      const st = readStateForSolidify();
      if (st && st.last_run && st.last_run.run_id) runId = String(st.last_run.run_id);
    } catch (e) {}
    let artifact = null;
    try {
      artifact = writePromptArtifact({
        memoryDir: getEvolutionDir(),
        cycleId,
        runId,
        prompt,
        meta: {
          agent: AGENT_NAME,
          drift_enabled: IS_RANDOM_DRIFT,
          review_mode: IS_REVIEW_MODE,
          dry_run: IS_DRY_RUN,
          mutation_id: mutation && mutation.id ? mutation.id : null,
          personality_key: personalitySelection && personalitySelection.personality_key ? personalitySelection.personality_key : null,
        },
      });
    } catch (e) {
      artifact = null;
    }

    const executorTask = [
      'You are the executor (the Hand).',
      'Your job is to apply a safe, minimal patch in this repo following the attached GEP protocol prompt.',
      artifact && artifact.promptPath ? `Prompt file: ${artifact.promptPath}` : 'Prompt file: (unavailable)',
      '',
      'After applying changes and validations, you MUST run:',
      '  node index.js solidify',
      '',
      'Loop chaining (only if you are running in loop mode): after solidify succeeds, print a sessions_spawn call to start the next loop run with a short delay.',
      'Example:',
      'sessions_spawn({ task: "exec: node skills/evolver/index.js evolve", agentId: "main", cleanup: "delete", label: "gep_loop_next" })',
      '',
      'GEP protocol prompt (may be truncated here; prefer the prompt file if provided):',
      clip(prompt, 24000),
    ].join('\n');

    const spawn = renderSessionsSpawnCall({
      task: executorTask,
      agentId: AGENT_NAME,
      cleanup: 'delete',
      label: `gep_bridge_${cycleNum}`,
    });

    console.log('\n[BRIDGE ENABLED] Spawning executor agent via sessions_spawn.');
    console.log(spawn);
    if (printPrompt) {
      console.log('\n[PROMPT OUTPUT] (EVOLVE_PRINT_PROMPT=true)');
      console.log(prompt);
    }
  } else {
    console.log(prompt);
    console.log('\n[SOLIDIFY REQUIRED] After applying the patch and validations, run: node index.js solidify');
  }
}

module.exports = { dispatch };
