# Bugbot Review Rules — @evomap/evolver

This file gives Cursor Bugbot project-specific context for the public
`@evomap/evolver` repository. Most pull requests here come from external
contributors against the published distribution. The repository is
**generated** from a private source-of-truth and overwritten on every
release, so reviews should focus on contract correctness, not deep refactors
of the obfuscated core.

## Project shape

- Pure Node.js (no TypeScript). Public surface is the npm package
  `@evomap/evolver`; entry point is `index.js`.
- Single runtime dependency (`dotenv`). New runtime dependencies require a
  clear justification in the PR description — flag if missing.
- Tests run via `node --test`. There is no ESLint/Prettier in CI; rely on
  Bugbot to catch style and correctness regressions.
- Many files under `src/gep/**` are obfuscated (variable names hexadecimal,
  string arrays, control-flow flattening). **Do not** flag style issues
  inside obfuscated files — they are intentional and any "fix" will be
  overwritten on the next release.

## High-severity rules (block the PR)

### 1. Secrets must not be logged

Any code path that produces logs, telemetry, capsule payloads, or hub
broadcasts must avoid emitting raw secrets. Block PRs that:

- Log raw `process.env.*` values, request headers, `Authorization` values,
  or full URLs with credentials in the userinfo segment.
- Add a new secret pattern (API key, token, private key) without also
  extending the redaction patterns used by the project's sanitizer.

### 2. Filesystem and network safety

- Reject `child_process.exec*` / `spawn*` calls that interpolate untrusted
  strings into the command. Use the array form with explicit args.
- Reject `fs.writeFileSync` / `fs.rmSync({ recursive: true })` calls that
  resolve paths from user/LLM input without an allowlist or path-prefix
  check.
- Reject HTTP fetches that disable TLS verification
  (`rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`) outside
  isolated test fixtures.

### 3. Asset-store integrity (upgrade safety)

The npm package ships a `package.json` with a strict `files` allowlist and a
`.npmignore` that blocks `assets/gep/{genes,capsules,events,...}` files.
Block PRs that:

- Add `assets/gep/genes.json`, `assets/gep/capsules.json`,
  `assets/gep/events.jsonl`, or any other runtime asset file to the package
  — these would overwrite the user's local asset store on `npm upgrade` and
  silently destroy their accumulated GEP memory.
- Modify `package.json#files` to add `assets/gep/**` or remove `.npmignore`
  protection lines without an explicit migration plan.

### 4. CLI contract stability

`index.js` is the published CLI binary. Any breaking change to flags,
default behaviour, exit codes, or stdout/stderr format breaks every
downstream wrapper (e.g. `feishu-evolver-wrapper`). Require:

- A note in `CHANGELOG.md` describing the user-visible change.
- A semver-major version bump if the change is breaking.

## Medium-severity rules (request changes)

### Async correctness

- Every Promise must either be `await`ed or have a `.catch` handler. Flag
  unhandled-rejection risks.
- Do not mix `await` with `.then(...)` chains inside the same logical block.

### Adapter contract

External contributions most often touch `src/adapters/**` (e.g. fixes for
Claude Code / Codex / Cursor signal extraction). When reviewing an adapter
change:

- Confirm new field reads use defensive access (`obj?.field`) — adapter
  inputs are user-supplied tool calls and may have arbitrary shape.
- Confirm there is an accompanying test under `test/` exercising the new
  shape, or a justification in the PR description for why one cannot be
  added.

### Node version

`package.json` does not currently pin an `engines` field. The package is
distributed to end users running a wide range of Node versions. Treat
Node.js >= 18 as the de-facto floor and flag use of APIs that require Node
20+ (e.g. `fs.glob`, top-level `using`, `--experimental-strip-types`) unless
the PR also adds an `engines.node` constraint to `package.json` and notes
the bump in `CHANGELOG.md`.

## Low-severity rules (nit / suggestion)

- Use `node:` prefix for built-in module imports (`require('node:fs')`).
- Prefer named functions over anonymous arrow functions when registering
  event listeners — eases stack traces.
- Avoid `JSON.stringify(...)` of large objects on hot paths; prefer
  streaming or pagination.

## Context Bugbot should NOT flag

- The lack of TypeScript or ESLint config — intentional.
- Single-dependency `package.json` — intentional minimal supply chain.
- Hexadecimal identifier names, dead-code injection, control-flow
  flattening, RC4 string arrays, and `transformObjectKeys` artefacts inside
  `src/gep/**` files — all from `javascript-obfuscator` and intentional.
- The presence of `src/gep/.integrity` — required by runtime self-repair.
- The release-bot commit `Release vX.Y.Z` author (`evolver-publish`) — not a
  human reviewer; do not request changes from it.
- The `assets/gep/genes.seed.json` file — the canonical seed shipped with
  the package; flag changes to it only if they alter recorded gene
  signatures.

## Style

This repository forbids emoji in code, comments, commit messages, and
documentation, with a single allowed exception: the DNA glyph used in
public-facing docs. Flag any PR that adds other emoji.
