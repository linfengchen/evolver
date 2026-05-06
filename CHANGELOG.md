# Changelog

All notable changes to `@evomap/evolver` are tracked here.

## [1.79.1] - 2026-05-06

### Fixed

- **Windows cmd-popup loop on suicide-respawn (issue #528).** On Windows,
  `child_process.spawn(detached: true, windowsHide: true)` allocates a new
  conhost (cmd) window every time -- `windowsHide` is silently ignored in
  detached mode, see Node.js child_process docs. So every time the daemon
  hit `EVOLVER_MAX_CYCLES` (default 100) or `EVOLVER_MAX_RSS_MB` (default
  500) and ran the suicide-respawn, Windows users saw a new cmd popup.
  v1.79.0 made this worse by adding a third spawn site for the cycle
  hard-timeout, copying the same buggy options.

  The two in-process spawn sites are now consolidated into one helper
  `spawnReplacementProcess()` that, on Windows, defaults to *not*
  spawning. Instead the daemon `process.exit(1)`s and lets an external
  supervisor restart it. Compatible supervisors:

  - `feishu-evolver-wrapper` `>= 1.10.0` (recommended; already does
    auto-restart with backoff and now also handles inner stuck cycles).
  - NSSM (Non-Sucking Service Manager).
  - pm2-windows-startup.
  - Windows Task Scheduler with "On failure: restart" rule.

  Users who explicitly want the in-process respawn (and accept the cmd
  popups) can opt back in with `EVOLVER_SUICIDE_WINDOWS=true`.

  No behavior change on macOS/Linux.

### Notes on the original report

The reporter's auto-generated diagnosis attributed a separate symptom
("`evolver buy/orders/publish` subcommands break the daemon") to lock
contention on `evolver.pid`. That hypothesis is incorrect: subcommands
do not call `acquireLock()` -- only `--loop` does. What the reporter
observed was the same suicide-respawn cycle ending exactly when a
subcommand happened to run, and the new conhost popup made it look like
the subcommand caused it. Fixing the popup also fixes the perceived
"daemon got killed" symptom.

## [1.79.0] - 2026-05-06

### Fixed

- **Cycle hard-timeout watchdog (issue #19).** The daemon main loop in
  `index.js` previously called `await evolve.run()` with no upper bound,
  so a single hung cycle (unclosed socket, stalled LLM call, etc.) could
  freeze the process indefinitely. One reporter observed cycle #5372
  stuck for 22 days at 0% CPU.

  `evolve.run()` is now wrapped in `Promise.race(evolvePromise,
  cycleTimeoutPromise)`. When the timeout fires, the daemon emits a
  `[Daemon] Cycle hard-timeout exceeded after Nms (cycle=N, phase=Y)`
  diagnostic, force-spawns a replacement process, and exits with code 1
  so a host wrapper observes the dead pid.

  New environment variables (both opt-out, default-on):

  - `EVOLVER_CYCLE_TIMEOUT_ENABLED` (default `true`).
  - `EVOLVER_CYCLE_TIMEOUT_MS` (default `2700000`, i.e. 45 minutes).
  - `EVOLVER_PROGRESS_UPDATE_MS` (default `60000`).

### Added

- **`memory/evolution/cycle_progress.json` heartbeat.** The daemon now
  atomically writes a small JSON heartbeat at cycle start, every 60s
  while `evolve.run()` is in flight, and again at sleep entry. External
  watchdogs can poll `updated_at` to detect a true freeze (the file
  stays stale for >30 minutes only when the inner event loop is
  genuinely hung; normal long LLM cycles still refresh it via the
  60-second ticker).

  Schema:

  ```json
  { "pid": 12345, "outer_cycle": 5372, "inner_cycle": 17,
    "started_at": 1746543112000, "phase": "evolve.run|sleep|cycle_timeout_respawn",
    "updated_at": 1746543210000 }
  ```

  Regression tests: `test/cycleHardTimeout.test.js` (11 cases) and
  `test/cycleProgressFile.test.js` (4 cases).


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
