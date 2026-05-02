# Changelog

All notable changes to `@evomap/evolver` are tracked here.

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
