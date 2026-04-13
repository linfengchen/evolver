# evolver-private-dev

Private development repository for Evolver (source of truth).
Public distribution: [EvoMap/evolver](https://github.com/EvoMap/evolver).

Current version: see `package.json`.

## Repository Layout

```
index.js                     # CLI entry point
src/
  evolve.js                  # Core evolution engine
  proxy/                     # EvoMap Proxy (HTTP server, sync, mailbox)
  gep/                       # GEP protocol (bridge, prompt, selector, solidify)
  ops/                       # Operations modules (lifecycle, repair, cleanup, monitoring)
assets/gep/                  # Genes, Capsules, Events
scripts/
  build_public.js            # Build dist-public/ from public.manifest.json
  publish_public.js          # Publish to GitHub + npm
  check_wrapper_compat.js    # Check feishu-evolver-wrapper interface compatibility
test/                        # Test suite (vitest)
docs/                        # Private docs (excluded from public build)
memory/                      # Runtime artifacts (excluded from public build)
```

## Release Workflow

### Evolver Release

```bash
# 1. Version bump
#    Edit package.json version, commit:
git commit -am "chore(release): prepare vX.Y.Z"

# 2. Build public output
node scripts/build_public.js

# 3. Publish (GitHub Release + npm)
PUBLIC_REPO="EvoMap/evolver" node scripts/publish_public.js
cd dist-public && npm publish --access public
```

Both channels (GitHub Release, npm) must succeed.

| Channel | Target |
|---------|--------|
| GitHub Release | `EvoMap/evolver` |
| npm | `@evomap/evolver` |

### Public README

The public-facing README lives in `README.public.md`. It is copied and renamed to `dist-public/README.md` during build. Do NOT edit `README.public.md` for private dev notes; edit this file instead.

## Downstream Dependencies

### feishu-evolver-wrapper-private

The Feishu wrapper depends on evolver's `src/ops/` and `src/gep/bridge.js` modules at runtime.

| Private Repo | Public Repo |
|---|---|
| [EvoMap/feishu-evolver-wrapper-private](https://github.com/EvoMap/feishu-evolver-wrapper-private) | `EvoMap/feishu-evolver-wrapper` |

#### Interface Contract

The wrapper imports the following modules via `requireEvolverModule()`. Changing their export signatures is a breaking change for the wrapper.

| Module | Required Exports | Wrapper Usage |
|--------|-----------------|---------------|
| `src/ops/self_repair.js` | `repair()` | Git repo repair before each cycle |
| `src/ops/commentary.js` | `getComment()` | Feishu card personality text |
| `src/ops/cleanup.js` | `run()` | Disk hygiene |
| `src/ops/skills_monitor.js` | `run()` | Skill health in reports |
| `src/ops/health_check.js` | `runHealthCheck()` | Lifecycle watchdog |
| `src/gep/bridge.js` | `renderSessionsSpawnCall()` | Wrapper parses `sessions_spawn(JSON)` from stdout |
| `index.js` | CLI args: `run`, `--loop`, `--once`, `--mad-dog` | Wrapper spawns evolver as child process |

#### Compatibility Check

After modifying any of the above files, run:

```bash
node scripts/check_wrapper_compat.js
```

If the check fails, update the wrapper before releasing evolver.

#### Wrapper Release

```bash
cd /home/kprimo97/evomap/feishu-evolver-wrapper-private
node scripts/build_public.js
PUBLIC_REPO="EvoMap/feishu-evolver-wrapper" node scripts/publish_public.js
```

## Development

```bash
# Run tests
npx vitest run

# Single evolution run (sanity check)
node index.js

# Continuous loop
node index.js --loop
```

## Build Pipeline

`public.manifest.json` controls what goes into `dist-public/`:

- **include**: files to copy (supports globs)
- **exclude**: files to prune after copy
- **rewrite**: string replacements in specific files
- **rename**: file renames (e.g. `README.public.md` -> `README.md`)

Files in `docs/`, `memory/`, and `dist-public/` are never included in public builds.
