#!/bin/bash
# deploy.sh -- Bump, build, deploy, and publish evolver
#
# Covers five release scenarios:
#
#   1) Stable patch/minor/major bump from main
#        ./scripts/deploy.sh patch
#        ./scripts/deploy.sh minor
#        ./scripts/deploy.sh major
#
#      If the current version is a prerelease (e.g. 1.70.1-beta.0), `patch`
#      promotes to the stable of the same base (-> 1.70.1) instead of bumping
#      the patch component. Use this right after finishing a beta series.
#
#   2) Explicit stable version (e.g. promote 1.70.0 after beta soak)
#        ./scripts/deploy.sh 1.70.0
#
#   3) Beta / prerelease (auto-detected by "-" in version)
#        ./scripts/deploy.sh 1.71.0-beta.0      (npm dist-tag: beta, GitHub: Pre-release)
#        ./scripts/deploy.sh 2.0.0-rc.1         (npm dist-tag: rc,   GitHub: Pre-release)
#
#      npm dist-tag is derived from the first prerelease segment (beta/alpha/rc/next).
#
#   4) Release from a non-main branch (hotfix backport, beta-promote branch)
#        ./scripts/deploy.sh 1.69.22 --source-branch=hotfix/1.69.x
#        ./scripts/deploy.sh 1.70.0  --source-branch=release/1.70.0 --notes-file=/tmp/notes.md
#
#      --source-branch overrides both the `git push` target and publish_public.js'
#      main-branch guard. The private-dev working copy MUST be on that branch already.
#
#   5) Dry-run preview (no writes anywhere)
#        ./scripts/deploy.sh 1.70.1-beta.1 --dry-run
#
# Additional flags:
#   --notes-file=<path>   Read GitHub Release notes from file (preferred for beta
#                         and promote scenarios where notes matter).
#   --skip-wrapper        Skip feishu-evolver-wrapper restart (irrelevant for
#                         beta releases; wrapper should stay on latest stable).
#   --skip-deploy-skills  Skip copying build output into ../skills/evolver/
#                         (set this for beta releases so the local workspace
#                         keeps running the stable version).
#   --skip-binaries       Skip building & uploading standalone binaries.
#                         Use only for emergency npm-only re-publishes.
#   --skip-wrapper and --skip-deploy-skills are implied for any prerelease
#   version unless explicitly overridden with --promote-local.
#
# Pipeline (all steps honor --dry-run):
#   0. Preflight (gh auth, npm auth, bun, branch match)
#   1. Bump version in package.json
#   2. Commit & push private-dev to the source branch
#   3. Build public distribution (dist-public/) with RELEASE_VERSION pinned
#   4. [stable only] Deploy dist-public/ to ../skills/evolver/
#   5. Publish to GitHub public repo + create Release (with --prerelease if needed)
#   6. Build standalone binaries for 5 platforms and attach to the GitHub Release
#   7. Publish to npm with the correct --tag (latest|beta|alpha|rc|next|...)
#   8. Verify: GitHub release state + npm dist-tags match expectations
#   9. [stable only] Restart feishu-evolver-wrapper
#
# Prerequisites:
#   - gh CLI authenticated (gh auth login)
#   - npm authenticated (npm whoami)
#   - bun >= 1.3 installed (https://bun.com) -- can be skipped with --skip-binaries
#   - Working copy clean on the target source branch
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
SKILLS_EVOLVER="$WORKSPACE_ROOT/skills/evolver"
WRAPPER_DIR="$WORKSPACE_ROOT/skills/feishu-evolver-wrapper"
PUBLIC_REPO="EvoMap/evolver"

cd "$REPO_ROOT"

BUMP=""
DRY_RUN=false
SKIP_WRAPPER=false
SKIP_DEPLOY_SKILLS=false
SKIP_BINARIES=false
PROMOTE_LOCAL=false
SOURCE_BRANCH=""
NOTES_FILE=""

for arg in "$@"; do
    case "$arg" in
        --dry-run)            DRY_RUN=true ;;
        --skip-wrapper)       SKIP_WRAPPER=true ;;
        --skip-deploy-skills) SKIP_DEPLOY_SKILLS=true ;;
        --skip-binaries)      SKIP_BINARIES=true ;;
        --promote-local)      PROMOTE_LOCAL=true ;;
        --source-branch=*)    SOURCE_BRANCH="${arg#--source-branch=}" ;;
        --notes-file=*)       NOTES_FILE="${arg#--notes-file=}" ;;
        --*)
            echo "ERROR: unknown flag: $arg"
            exit 2
            ;;
        *)
            if [ -z "$BUMP" ]; then
                BUMP="$arg"
            fi
            ;;
    esac
done

if [ -z "$BUMP" ]; then
    echo "Usage: $0 <patch|minor|major|X.Y.Z[-tag.N]> [flags]"
    echo ""
    echo "Current version: $(node -p "require('./package.json').version")"
    echo ""
    echo "Flags:"
    echo "  --dry-run                 Preview all steps without executing"
    echo "  --source-branch=<branch>  Release from a non-main branch"
    echo "  --notes-file=<path>       Read GitHub Release notes from file"
    echo "  --skip-wrapper            Skip feishu-evolver-wrapper restart"
    echo "  --skip-deploy-skills      Skip local skills/evolver/ deploy"
    echo "  --skip-binaries           Skip standalone binary build & upload"
    echo "  --promote-local           Force local deploy even on prerelease"
    echo ""
    echo "See header comments for five supported release scenarios."
    exit 1
fi

CURRENT_VERSION=$(node -p "require('./package.json').version")

case "$BUMP" in
    patch|minor|major)
        NEW_VERSION=$(node -e "
            var current = '$CURRENT_VERSION';
            var hadPre = current.includes('-');
            var base = current.replace(/-.*\$/, '').split('.').map(function(x){return parseInt(x,10);});
            var bump = '$BUMP';
            if (bump === 'patch') {
                // If current is a prerelease (e.g. 1.70.1-beta.0), 'patch'
                // means 'promote to the stable of the same base' -> 1.70.1.
                // If current is already stable, bump Z.
                if (!hadPre) base[2] += 1;
            } else if (bump === 'minor') {
                base[1] += 1; base[2] = 0;
            } else if (bump === 'major') {
                base[0] += 1; base[1] = 0; base[2] = 0;
            }
            console.log(base.join('.'));
        ")
        ;;
    *)
        NEW_VERSION="$BUMP"
        ;;
esac

# --- Prerelease detection ---
# A version with a hyphen (e.g. 1.70.0-beta.5) is a prerelease. Derive the
# npm dist-tag from the first prerelease segment: beta/alpha/rc/next/canary.
# Unknown tags fall back to 'next' so we never clobber 'latest' by accident.
IS_PRERELEASE=false
NPM_DIST_TAG="latest"
GH_PRERELEASE_FLAG=""
if [[ "$NEW_VERSION" == *-* ]]; then
    IS_PRERELEASE=true
    PRE_LABEL="${NEW_VERSION#*-}"
    PRE_LABEL="${PRE_LABEL%%.*}"
    case "$PRE_LABEL" in
        beta|alpha|rc|next|canary) NPM_DIST_TAG="$PRE_LABEL" ;;
        *) NPM_DIST_TAG="next" ;;
    esac
    GH_PRERELEASE_FLAG="--prerelease"
    if [ "$PROMOTE_LOCAL" = false ]; then
        SKIP_WRAPPER=true
        SKIP_DEPLOY_SKILLS=true
    fi
fi

# --- Source branch default ---
if [ -z "$SOURCE_BRANCH" ]; then
    SOURCE_BRANCH="main"
fi

TOTAL_STEPS=9
# Step numbers are fixed at 0..9. Skipped steps still print their number
# so progress messages stay aligned with the header.

echo "=== Evolver Deploy Pipeline ==="
echo "Version:        $CURRENT_VERSION -> $NEW_VERSION"
echo "Source branch:  $SOURCE_BRANCH"
if [ "$IS_PRERELEASE" = true ]; then
    echo "Release type:   prerelease (GitHub: Pre-release, npm dist-tag: $NPM_DIST_TAG)"
else
    echo "Release type:   stable (GitHub: Latest, npm dist-tag: latest)"
fi
if [ -n "$NOTES_FILE" ]; then
    echo "Notes file:     $NOTES_FILE"
fi
if [ "$DRY_RUN" = true ]; then
    echo "Mode:           DRY RUN (no changes will be made)"
fi
echo ""

run_cmd() {
    if [ "$DRY_RUN" = true ]; then
        echo "  [dry-run] $*"
    else
        "$@"
    fi
}

# --- Preflight checks ---
echo "[0/$TOTAL_STEPS] Preflight checks..."

if ! command -v gh &>/dev/null; then
    echo "  WARN: gh CLI not found -- GitHub Release will use API fallback"
else
    if ! gh auth status -h github.com &>/dev/null 2>&1; then
        echo "  ERROR: gh not authenticated. Run: gh auth login"
        exit 1
    fi
    echo "  gh CLI: OK"
fi

if command -v npm &>/dev/null; then
    echo "  npm CLI: OK"
else
    echo "  WARN: npm CLI not found -- npm publish will be skipped"
fi

if npm whoami &>/dev/null 2>&1; then
    echo "  npm auth: OK"
else
    echo "  WARN: npm not authenticated -- npm publish may fail"
fi

if [ "$SKIP_BINARIES" = false ]; then
    if command -v bun &>/dev/null; then
        BUN_VERSION=$(bun --version 2>/dev/null)
        BUN_MAJOR=${BUN_VERSION%%.*}
        BUN_MINOR_PART=${BUN_VERSION#*.}
        BUN_MINOR=${BUN_MINOR_PART%%.*}
        if [ "${BUN_MAJOR:-0}" -lt 1 ] || { [ "${BUN_MAJOR:-0}" -eq 1 ] && [ "${BUN_MINOR:-0}" -lt 3 ]; }; then
            echo "  ERROR: bun >= 1.3 required for binary build; found $BUN_VERSION"
            echo "         Install/upgrade from https://bun.com or pass --skip-binaries"
            exit 1
        fi
        echo "  bun: $BUN_VERSION OK"
    else
        echo "  ERROR: bun not found in PATH (needed for binary build)"
        echo "         Install from https://bun.com or pass --skip-binaries"
        exit 1
    fi
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$SOURCE_BRANCH" ]; then
    echo "  ERROR: current branch is '$CURRENT_BRANCH' but source-branch is '$SOURCE_BRANCH'."
    echo "         Run: git checkout $SOURCE_BRANCH"
    exit 1
fi
echo "  branch: $CURRENT_BRANCH OK"

# Verify notes file exists if provided
if [ -n "$NOTES_FILE" ] && [ ! -f "$NOTES_FILE" ]; then
    echo "  ERROR: --notes-file not found: $NOTES_FILE"
    exit 1
fi

# Verify target tag doesn't already exist (remote check via gh)
if command -v gh &>/dev/null && [ "$DRY_RUN" = false ]; then
    if gh release view "v$NEW_VERSION" --repo "$PUBLIC_REPO" &>/dev/null; then
        echo "  ERROR: GitHub release v$NEW_VERSION already exists on $PUBLIC_REPO."
        exit 1
    fi
fi

echo ""

# --- Step 1: Bump version ---
echo "[1/$TOTAL_STEPS] Bumping version to $NEW_VERSION..."
if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] sed -i s/\"$CURRENT_VERSION\"/\"$NEW_VERSION\"/ package.json"
else
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
    else
        sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
    fi
fi

# --- Step 2: Commit & push private-dev ---
echo "[2/$TOTAL_STEPS] Committing and pushing $SOURCE_BRANCH..."
if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] git add -A && git commit && git push origin $SOURCE_BRANCH"
else
    git add -A
    git commit -m "chore(release): prepare v$NEW_VERSION" || echo "  (nothing to commit)"
    git push origin "$SOURCE_BRANCH"
fi

# --- Step 3: Build ---
echo "[3/$TOTAL_STEPS] Building public distribution..."
if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] RELEASE_VERSION=$NEW_VERSION node scripts/build_public.js"
else
    RELEASE_VERSION="$NEW_VERSION" node scripts/build_public.js
fi

# --- Step 4: Deploy to ../skills/evolver (stable only) ---
if [ "$SKIP_DEPLOY_SKILLS" = false ]; then
    echo "[4/$TOTAL_STEPS] Deploying to skills/evolver/..."
    if [ -d "$SKILLS_EVOLVER" ]; then
        if [ "$DRY_RUN" = true ]; then
            echo "  [dry-run] rm -rf $SKILLS_EVOLVER/* && cp -r dist-public/* $SKILLS_EVOLVER/"
        else
            rm -rf "$SKILLS_EVOLVER"/*
            cp -r dist-public/* "$SKILLS_EVOLVER/"
            cp dist-public/.gitignore "$SKILLS_EVOLVER/" 2>/dev/null || true
            cd "$SKILLS_EVOLVER"
            ln -sf ../../memory memory 2>/dev/null || true
            ln -sf ../../MEMORY.md MEMORY.md 2>/dev/null || true
            cd "$REPO_ROOT"
            node -e "require('$SKILLS_EVOLVER/src/evolve'); console.log('  Local deploy verified OK');"
        fi
    else
        echo "  SKIP: $SKILLS_EVOLVER not found"
    fi
else
    echo "[4/$TOTAL_STEPS] (skipped -- prerelease or --skip-deploy-skills)"
fi

# --- Step 5: Publish to GitHub public repo + Release ---
echo "[5/$TOTAL_STEPS] Publishing to GitHub ($PUBLIC_REPO) + Release v$NEW_VERSION..."
PUBLISH_ENV=(
    "PUBLIC_REPO=$PUBLIC_REPO"
    "PUBLIC_USE_BUILD_OUTPUT=true"
    "RELEASE_VERSION=$NEW_VERSION"
    "RELEASE_TAG=v$NEW_VERSION"
    "RELEASE_TITLE=v$NEW_VERSION"
    "SOURCE_BRANCH=$SOURCE_BRANCH"
)
if [ -n "$NOTES_FILE" ]; then
    PUBLISH_ENV+=("RELEASE_NOTES_FILE=$NOTES_FILE")
else
    PUBLISH_ENV+=("RELEASE_NOTES=Release v$NEW_VERSION")
fi

if [ "$DRY_RUN" = true ]; then
    PUBLISH_ENV+=("DRY_RUN=true")
    echo "  [dry-run] env ${PUBLISH_ENV[*]} node scripts/publish_public.js"
else
    env "${PUBLISH_ENV[@]}" node scripts/publish_public.js 2>&1 \
        || echo "  WARN: publish_public.js exited non-zero (check GitHub release manually)"
fi

# After GitHub release created, ensure the prerelease flag is set. publish_public
# historically does not set it, so we enforce it here.
if [ "$IS_PRERELEASE" = true ] && [ "$DRY_RUN" = false ]; then
    if command -v gh &>/dev/null; then
        gh release edit "v$NEW_VERSION" --repo "$PUBLIC_REPO" --prerelease 2>&1 \
            | sed 's/^/  /' || echo "  WARN: could not set prerelease flag"
    fi
fi

# --- Step 6: Build & upload standalone binaries ---
echo "[6/$TOTAL_STEPS] Building & uploading standalone binaries..."
if [ "$SKIP_BINARIES" = true ]; then
    echo "  (skipped -- --skip-binaries)"
else
    if [ "$DRY_RUN" = true ]; then
        echo "  [dry-run] RELEASE_VERSION=$NEW_VERSION node scripts/build_binaries.js"
        echo "  [dry-run] gh release upload v$NEW_VERSION dist-binaries/* --repo $PUBLIC_REPO --clobber"
    else
        # Build all 5 platform binaries (~7s) into dist-binaries/.
        # The script is deterministic: same NEW_VERSION + same source = same sha256.
        if RELEASE_VERSION="$NEW_VERSION" node scripts/build_binaries.js; then
            # --clobber lets a re-run of deploy.sh overwrite stale assets if a
            # prior step (e.g. npm publish) failed and we re-execute end-to-end.
            if command -v gh &>/dev/null; then
                gh release upload "v$NEW_VERSION" \
                    dist-binaries/evolver-darwin-arm64 \
                    dist-binaries/evolver-darwin-arm64.sha256 \
                    dist-binaries/evolver-darwin-x64 \
                    dist-binaries/evolver-darwin-x64.sha256 \
                    dist-binaries/evolver-linux-x64 \
                    dist-binaries/evolver-linux-x64.sha256 \
                    dist-binaries/evolver-linux-arm64 \
                    dist-binaries/evolver-linux-arm64.sha256 \
                    dist-binaries/evolver-windows-x64.exe \
                    dist-binaries/evolver-windows-x64.exe.sha256 \
                    dist-binaries/SHA256SUMS.txt \
                    --repo "$PUBLIC_REPO" \
                    --clobber 2>&1 | sed 's/^/  /' \
                    || echo "  WARN: gh release upload exited non-zero"
            else
                echo "  WARN: gh CLI not available; binaries built but not uploaded."
                echo "        Manual upload: gh release upload v$NEW_VERSION dist-binaries/* --repo $PUBLIC_REPO --clobber"
            fi
        else
            echo "  WARN: build_binaries.js failed; binaries NOT attached to release."
            echo "        Re-run: RELEASE_VERSION=$NEW_VERSION node scripts/build_binaries.js"
            echo "        Then:   gh release upload v$NEW_VERSION dist-binaries/* --repo $PUBLIC_REPO --clobber"
        fi
    fi
fi

# --- Step 7: Publish npm with the right dist-tag ---
echo "[7/$TOTAL_STEPS] Publishing to npm (@evomap/evolver, dist-tag=$NPM_DIST_TAG)..."
if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] cd dist-public && npm publish --access public --tag $NPM_DIST_TAG"
else
    (cd "$REPO_ROOT/dist-public" && npm publish --access public --tag "$NPM_DIST_TAG" 2>&1) \
        || echo "  WARN: npm publish failed -- check 'npm login' or version conflict"
fi

# --- Step 8: Verify ---
echo "[8/$TOTAL_STEPS] Verifying release..."
if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] skipping verification"
else
    # Give the registry a few seconds to propagate dist-tags.
    sleep 6
    if command -v gh &>/dev/null; then
        GH_STATE=$(gh release view "v$NEW_VERSION" --repo "$PUBLIC_REPO" --json isPrerelease,isDraft 2>/dev/null || echo "{}")
        echo "  GitHub state: $GH_STATE"
    fi
    NPM_TAGS=$(npm view @evomap/evolver dist-tags --json 2>/dev/null || echo "{}")
    echo "  npm dist-tags: $NPM_TAGS"
    EXPECTED_TAG_VERSION=$(node -e "try{var t=$NPM_TAGS;process.stdout.write(t['$NPM_DIST_TAG']||'')}catch(e){}" 2>/dev/null || echo "")
    if [ "$EXPECTED_TAG_VERSION" = "$NEW_VERSION" ]; then
        echo "  npm dist-tag '$NPM_DIST_TAG' points to $NEW_VERSION as expected."
    else
        echo "  WARN: npm dist-tag '$NPM_DIST_TAG' = '$EXPECTED_TAG_VERSION', expected '$NEW_VERSION'. Registry may still be propagating."
    fi
fi

# --- Step 9: Restart wrapper (stable only) ---
if [ "$SKIP_WRAPPER" = false ]; then
    echo "[9/$TOTAL_STEPS] Restarting feishu-evolver-wrapper..."
    if [ -d "$WRAPPER_DIR" ] && [ -f "$WRAPPER_DIR/index.js" ]; then
        if [ "$DRY_RUN" = true ]; then
            echo "  [dry-run] pkill + restart feishu-evolver-wrapper"
        else
            pkill -f "feishu-evolver-wrapper/index.js" 2>/dev/null || true
            sleep 2
            cd "$WORKSPACE_ROOT"
            export EVOLVE_WRAPPER_LOOP_SLEEP_SECONDS="${EVOLVE_WRAPPER_LOOP_SLEEP_SECONDS:-600}"
            export FORCE_INNOVATION="${FORCE_INNOVATION:-true}"
            nohup node "$WRAPPER_DIR/index.js" --loop > "$WRAPPER_DIR/wrapper.log" 2>&1 &
            echo "  Wrapper restarted (PID: $!)"
        fi
    else
        echo "  SKIP: feishu-evolver-wrapper not found at $WRAPPER_DIR"
    fi
else
    echo "[9/$TOTAL_STEPS] (skipped -- prerelease or --skip-wrapper)"
fi

# --- Summary ---
echo ""
echo "=== Deploy Complete: v$NEW_VERSION ==="
echo "  GitHub:  https://github.com/$PUBLIC_REPO/releases/tag/v$NEW_VERSION"
echo "  npm:     https://www.npmjs.com/package/@evomap/evolver"
if [ "$IS_PRERELEASE" = true ]; then
    echo "  Install: npm install @evomap/evolver@$NPM_DIST_TAG"
else
    echo "  Install: npm install @evomap/evolver@latest"
fi
if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "  (This was a dry run. No changes were made.)"
fi
