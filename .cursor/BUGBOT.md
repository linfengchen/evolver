# Bugbot Review Rules — evolver-private-dev

This file gives Cursor Bugbot project-specific context. The repository is the
**private source of truth** for `@evomap/evolver`; the public mirror is
`EvoMap/evolver`, built via `scripts/build_public.js` driven by
`public.manifest.json`. Treat anything that could leak from private to public,
or that could break GEP asset integrity, as high severity.

## Project shape

- Pure Node.js (no TypeScript). Public surface is the npm package
  `@evomap/evolver`; entry point is `index.js`.
- Runtime dependencies are intentionally minimal — only `dotenv`. Do not
  approve PRs that add new runtime dependencies without a clear justification
  in the PR description.
- Tests run via `node --test`. There is no ESLint/Prettier in CI; rely on
  Bugbot to catch style and correctness regressions.

## High-severity rules (block the PR)

### 1. Secrets must round-trip through `src/gep/sanitize.js`

Any code path that writes capsule payloads, agent logs, prompts, or hub
broadcasts must call `sanitizePayload` (or an equivalent redactor) **before**
the data leaves the process. Flag as a blocking Bug if a PR:

- Logs raw `process.env.*`, request headers, or `Authorization` values.
- Sends capsule/event/log objects to `src/gep/bridge.js`,
  `src/gep/a2aProtocol.js`, `src/gep/issueReporter.js`, `src/proxy/sync/**`,
  or any HTTP/IPC sink without first running `sanitizePayload`.
- Adds a new secret pattern (API key, token, private key) that is not also
  added to `REDACT_PATTERNS` in `sanitize.js`.

### 2. Public/private leak prevention

`scripts/build_public.js` + `public.manifest.json` decide what ships to the
public repo and to npm. Block PRs that:

- Add a new top-level path that is **not** covered by either `include` or
  `exclude` in `public.manifest.json`. New private-only paths (docs/,
  memory/, internal scripts) must be added to `exclude`.
- Add `console.log` / TODO / FIXME / internal URLs / employee emails inside
  files listed in the `obfuscate` array — those files are shipped after
  obfuscation and any plaintext secret/comment leaks past obfuscation.
- Reference `EvoMap/evolver-private-dev` (this repo's URL) inside any file
  that is part of the public include set.

### 3. GEP asset integrity

The GEP protocol depends on stable hashing and signatures
(`src/gep/contentHash.js`, `src/gep/crypto.js`, `src/gep/integrityCheck.js`).
Block PRs that:

- Change `contentHash` / `crypto.sign` / `crypto.verify` behaviour without an
  explicit version bump and a migration path for existing
  `assets/gep/*.jsonl` records.
- Mutate gene/capsule/event objects in-place after they have been hashed or
  signed.
- Introduce non-deterministic ordering (e.g. `Object.keys` without sort, or
  `for ... in`) inside any code that participates in hashing.

### 4. Filesystem and network safety

- Reject `child_process.exec*` / `spawn*` calls that interpolate untrusted
  strings into the command. Use the array form with explicit args.
- Reject `fs.writeFileSync` / `fs.rmSync({recursive:true})` calls that
  resolve paths from user/LLM input without going through `src/gep/paths.js`
  or an equivalent allowlist.
- Reject HTTP fetches that disable TLS verification
  (`rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`) outside
  isolated test fixtures.

## Medium-severity rules (request changes)

### Async correctness

- Every Promise must either be `await`ed or have a `.catch` handler. Flag
  unhandled-rejection risks.
- Do not mix `await` with `.then(...)` chains inside the same logical block.
- Long-running loops in `src/proxy/**` must respect the existing cancellation
  / shutdown signals (look for `idleScheduler.js`, `lifecycle/**`).

### CLI compatibility

`index.js` is the public CLI binary. Any change to CLI flags, default
behaviour, exit codes, or stdout/stderr format is a breaking change for
`feishu-evolver-wrapper` and downstream users. Require:

- A note in `CHANGELOG.md` describing the user-visible change.
- Backwards-compatible behaviour behind a feature flag in
  `src/gep/featureFlags.js` whenever possible.
- An entry in `scripts/check_wrapper_compat.js` if a contract changes.

### Node version

`package.json` does not currently pin an `engines` field. The package is
distributed as a CLI to end users on a wide range of Node versions. Treat
Node.js >= 18 as the de-facto floor and flag use of APIs that require Node
20+ (e.g. `fs.glob`, top-level `using`, `--experimental-strip-types`) unless
the PR also adds an `engines.node` constraint to `package.json` and notes
the bump in `CHANGELOG.md`.

## Low-severity rules (nit / suggestion)

- Use `node:` prefix for built-in module imports (`require('node:fs')`).
- Prefer named functions over anonymous arrow functions when registering
  event listeners — eases stack traces.
- Avoid `JSON.stringify(...)` of large objects in hot paths inside
  `src/proxy/server/**`; prefer streaming or pagination.

## Context Bugbot should NOT flag

- The lack of TypeScript or ESLint config — intentional.
- Single-dependency `package.json` — intentional minimal supply chain.
- Files under `assets/gep/*.jsonl` are gitignored; if a PR appears to add
  them, that is a **block**, not a nit (see rule 2).
- The `dist-public/` and `dist-binaries/` directories are build artifacts —
  do not review them.

## Style

This repository forbids emoji in code, comments, commit messages, and
documentation, with a single allowed exception: the DNA glyph used in
public-facing docs. Flag any PR that adds other emoji.
