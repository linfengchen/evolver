'use strict';

// Integration test: dispatch() emits a properly-shaped observability span
// with exportable metadata and local_only gep_prompt_text, while the parent
// evolve.run span (when wired) parents the dispatch span via ALS.
// Runs against a tmpdir EVOLUTION_DIR so no repo files are touched.

const { describe, it, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mockMods = {};

before(() => {
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (request, parent /* , isMain */) {
    if (mockMods[request]) return mockMods[request];
    if (parent && parent.filename && parent.filename.includes('dispatch')) {
      const relMap = {
        '../../gep/assetStore': 'assetStore',
        '../../gep/prompt': 'prompt',
        '../../gep/assetCallLog': 'assetCallLog',
        '../../gep/solidify': 'solidify',
        '../../gep/bridge': 'bridge',
        '../../gep/paths': 'paths',
        '../../gep/explore': 'explore',
      };
      const key = relMap[request];
      if (key && mockMods[key]) return mockMods[key];
    }
    return origLoad.apply(this, arguments);
  };
});

function ctxFixture(overrides) {
  return {
    bridgeEnabled: false,
    recentMasterLog: 'log',
    todayLog: 'today',
    memorySnippet: '',
    userSnippet: '',
    cycleNum: 7,
    cycleId: 'cycle-7',
    mutationDirective: 'directive',
    healthReport: 'ok',
    fileList: '',
    reportingDirective: '',
    moodStatus: 'calm',
    memorySize: 0,
    syncDirective: '',
    localStateSummary: '',
    genes: [],
    capsules: [],
    recentEvents: [],
    signals: [],
    skipHubCalls: false,
    hubHit: { hit: false },
    activeTask: null,
    hubLessons: [],
    heartbeatActionContext: '',
    sharedKnowledgeContext: '',
    externalCandidatesPreview: '',
    capabilityCandidatesPreview: '',
    recentFailedCapsules: [],
    selectedGene: { id: 'gene-abc' },
    capsuleCandidates: [],
    selector: 'signal_match',
    selectedBy: 'selector',
    selectedCapsuleId: 'cap-1',
    strategyPolicy: { blastRadiusMaxFiles: 4 },
    personalitySelection: { personality_key: 'explorer', personality_known: true, personality_mutations: [] },
    personalityState: {},
    mutation: { id: 'm-1', category: 'innovate' },
    forceInnovation: false,
    IS_RANDOM_DRIFT: false,
    IS_REVIEW_MODE: false,
    IS_DRY_RUN: false,
    AGENT_NAME: 'test-agent',
    scanTime: 0,
    initialUserPrompt: 'do the thing',
    ...overrides,
  };
}

function configureDispatchMocks() {
  mockMods['assetStore'] = { getLastEventId: () => 'evt-x' };
  mockMods['prompt'] = {
    buildGepPrompt: () => 'GEP_PROMPT_TEXT_BODY',
    buildReusePrompt: () => 'REUSE_PROMPT',
    buildHubMatchedBlock: () => null,
  };
  mockMods['assetCallLog'] = { logAssetCall: () => {} };
  mockMods['solidify'] = {
    readStateForSolidify: () => ({}),
    writeStateForSolidify: () => {},
  };
  mockMods['bridge'] = {
    clip: (s) => s,
    writePromptArtifact: () => ({ promptPath: '/tmp/prompt.txt' }),
    renderSessionsSpawnCall: () => 'sessions_spawn({...})',
  };
  mockMods['paths'] = { getEvolutionDir: () => process.env.EVOLUTION_DIR, getRepoRoot: () => '/tmp/repo' };
  mockMods['explore'] = { tryExplore: async () => ({ signals: [] }) };
}

function readObsSpans(dir) {
  const file = path.join(dir, 'obs_spans.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

describe('observability wiring: dispatch', () => {
  let tmpDir;
  let saved;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-wiring-'));
    saved = process.env.EVOLUTION_DIR;
    process.env.EVOLUTION_DIR = tmpDir;
    // Force fresh require of observability + dispatch with the new EVOLUTION_DIR
    for (const k of Object.keys(require.cache)) {
      if (k.includes('/src/observability/') || k.endsWith('/src/evolve/pipeline/dispatch.js')
          || k.endsWith('/src/gep/paths.js')) {
        delete require.cache[k];
      }
    }
    configureDispatchMocks();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.EVOLUTION_DIR;
    else process.env.EVOLUTION_DIR = saved;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {
      // best-effort tmpdir cleanup
    }
  });

  it('writes an evolve.dispatch span with exportable metadata + local_only prompt', async () => {
    const { dispatch } = require('../src/evolve/pipeline/dispatch');
    const origLog = console.log;
    console.log = () => {};
    try {
      await dispatch(ctxFixture({ bridgeEnabled: false }));
    } finally {
      console.log = origLog;
    }

    const spans = readObsSpans(tmpDir);
    assert.equal(spans.length, 1);
    const span = spans[0];
    assert.equal(span.name, 'evolve.dispatch');
    assert.equal(span.exportable.cycle_id, 'cycle-7');
    assert.equal(span.exportable.cycle_num, 7);
    assert.equal(span.exportable.bridge_enabled, false);
    assert.equal(span.exportable.gene_id, 'gene-abc');
    assert.equal(span.exportable.is_direct_reuse, false);
    assert.equal(span.exportable.hub_match_mode, 'none');
    assert.equal(span.exportable.prompt_length, 'GEP_PROMPT_TEXT_BODY'.length);
    assert.match(span.exportable.prompt_sha256, /^[0-9a-f]{64}$/);
    assert.equal(span.local_only.gep_prompt_text, 'GEP_PROMPT_TEXT_BODY');
    assert.ok(Array.isArray(span.events) && span.events.length >= 2);
    const eventNames = span.events.map((e) => e.name);
    assert.ok(eventNames.includes('evolve.dispatch.prompt_built'));
    assert.ok(eventNames.includes('bridge.stdout'));
  });

  it('records sessions_spawn event with run_id when bridgeEnabled', async () => {
    mockMods['solidify'].readStateForSolidify = () => ({ last_run: { run_id: 'run_persisted' } });
    const { dispatch } = require('../src/evolve/pipeline/dispatch');
    const origLog = console.log;
    console.log = () => {};
    try {
      await dispatch(ctxFixture({ bridgeEnabled: true }));
    } finally {
      console.log = origLog;
    }

    const [span] = readObsSpans(tmpDir);
    assert.equal(span.exportable.bridge_enabled, true);
    const spawnEvent = (span.events || []).find((e) => e.name === 'bridge.sessions_spawn');
    assert.ok(spawnEvent, 'sessions_spawn event must be present');
    assert.equal(spawnEvent.attributes.run_id, 'run_persisted');
    assert.equal(spawnEvent.attributes.label, 'gep_bridge_7');
    assert.equal(spawnEvent.attributes.agent_id, 'test-agent');
  });

  it('marks idle dispatch span with skipped_idle=true and no prompt local_only', async () => {
    const { dispatch } = require('../src/evolve/pipeline/dispatch');
    const origLog = console.log;
    console.log = () => {};
    try {
      await dispatch(ctxFixture({ skipHubCalls: true }));
    } finally {
      console.log = origLog;
    }

    const [span] = readObsSpans(tmpDir);
    assert.equal(span.exportable.skipped_idle, true);
    assert.equal(span.local_only, undefined);
  });

  it('does not emit any local_only or prompt fields to a stub OTLP exporter', async () => {
    const obs = require('../src/observability');
    const captured = [];
    obs.registerOtlpExporter({ onSpanEnd: (rec) => captured.push(rec) });
    const { dispatch } = require('../src/evolve/pipeline/dispatch');
    const origLog = console.log;
    console.log = () => {};
    try {
      await dispatch(ctxFixture({ bridgeEnabled: false }));
    } finally {
      console.log = origLog;
    }
    obs.registerOtlpExporter(null);

    assert.equal(captured.length, 1);
    const exported = captured[0];
    assert.equal(exported.local_only, undefined);
    assert.equal(exported.exportable.gene_id, 'gene-abc');
    // Defensive: the full prompt body must never appear in OTLP-facing payload.
    assert.ok(!JSON.stringify(exported).includes('GEP_PROMPT_TEXT_BODY'));
  });
});
