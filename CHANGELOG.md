# Changelog

All notable changes to `@evomap/evolver` are tracked here.

## [1.78.9] - 2026-05-04

### Fixed

- **`AGENT_SESSIONS_DIR` override silently ignored (issue #527).**
  `src/evolve.js` resolved the OpenClaw sessions directory at module
  load time with a hard-coded `os.homedir()/.openclaw/agents/<name>/sessions`
  path, bypassing `process.env.AGENT_SESSIONS_DIR` and
  `EVOLVER_SESSION_SCOPE`. On Windows and any non-standard OpenClaw
  layout (including `D:\openclaw\data\.openclaw\agents\...`), session
  logs were never read and every cycle surfaced
  `[NO SESSION LOGS FOUND]`, forcing the LLM to fall back to its own
  memory and appear to "cycle emptily".

  The module-level `AGENT_SESSIONS_DIR` now delegates to
  `getAgentSessionsDir()` from `src/gep/paths.js`, which was already the
  intended single source of truth. `diagnoseSessionSourceEmpty()` reuses
  the same resolution when the caller does not inject a custom
  `homedir` / `agentName` pair, so diagnostic output now matches what
  the runtime actually reads.

  `getAgentSessionsDir()` precedence, unchanged:
  1. `process.env.AGENT_SESSIONS_DIR` (explicit override)
  2. `workspace-<agent>` prefix in `EVOLVER_SESSION_SCOPE`
  3. `AGENT_NAME` (defaults to `main`)

  Regression test: `test/evolveSessionsDir.test.js` (8 cases).


## [1.78.8] - 2026-05-04

### Added

- **Built-in memory_graph.jsonl rotation (issue #519).** Long-running
  nodes previously accumulated multi-GB `memory/evolution/memory_graph.jsonl`
  files; one reporter observed 1.8 GB / 378k lines after 48h. Evolver now
  rotates the active file when it crosses a size threshold:
  - `EVOLVER_MEMORY_GRAPH_AUTO_ROTATE` (default `true`) enables rotation.
  - `EVOLVER_MEMORY_GRAPH_MAX_SIZE_MB` (default `100`) triggers rotation.
  - `EVOLVER_MEMORY_GRAPH_RETENTION_COUNT` (default `7`) caps how many
    rotated `memory_graph.jsonl.<ts>.gz` archives are kept on disk.
  - A startup pass rotates an already-oversized file on the next evolver
    start, so pre-existing giant files are handled automatically.
  - Rotation checks are throttled (once every ~30s or every 100 writes)
    so the write path stays cheap. Pruning and gzip compression run
    best-effort and never block the write path.
  - Regression test at `test/memoryGraphRotation.test.js`.


## [1.78.7] - 2026-05-03

### Fixed

- **`EVOLVER_REPO_ROOT` set in `.env` is now honored (chicken-and-egg fix).**
  `index.js` previously called `getRepoRoot()` to locate the `.env` file
  before `dotenv` had a chance to populate `EVOLVER_REPO_ROOT` from that
  very file, and `getRepoRoot()` cached the `.git`-walk result on first
  call -- so any `EVOLVER_REPO_ROOT` declared in `.env` was silently
  ignored and evolver ran against the wrong repository (often
  `node_modules/@evomap/evolver` itself on local npm installs). Fix:
  - Bootstrap now loads `.env` from `process.cwd()` first (independent
    of any cache) so an `EVOLVER_REPO_ROOT` declared there takes effect
    immediately.
  - `getRepoRoot()` re-reads `process.env.EVOLVER_REPO_ROOT` on every
    call and overrides the cache when the env var is set, so any
    override populated by a later `.env` load propagates cleanly.
  - Regression test at `test/paths.test.js` covers the "env set AFTER
    first getRepoRoot call" path. Reported in #526.


## [1.78.1] - 2026-05-02

### Fixed

- **Capsule publish payloads now attach a hub-shape `execution_trace` array**
  (`src/gep/solidify.js`). Previously the trace object was only written onto
  the sibling `EvolutionEvent`; the `Capsule` itself went out with no trace,
  so every Capsule on the hub was flagged `trace_empty` and triggered the
  `capsule-trace-enforce] would-reject` alert stream (~530 rejects / 15 min
  in prod). The array form is synthesized from the existing
  `validation.results`, `blast` and `canary` data -- no new data capture --
  with each step carrying `stage` + `cmd` + `exit` to satisfy
  `capsuleTraceQualityService`'s shape check. Anti-pattern publishes
  (`EVOLVER_PUBLISH_ANTI_PATTERNS=true`) get the same treatment.

### Internal

- New exported helper `buildCapsuleTraceSteps(...)` in `src/gep/solidify.js`
  with a regression test at `test/capsuleExecutionTrace.test.js` that
  replicates the hub's shape gates, so a drift on either end breaks CI before
  it inflates production alerts.

## [1.78.0] - earlier

- `evolver sync --scope` and `--export .gepx` for full-account asset
  downloads. See `618e451`.
