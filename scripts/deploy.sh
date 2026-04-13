#!/bin/bash
# deploy.sh -- Bump, build, deploy, and publish evolver
#
# Usage:
#   ./scripts/deploy.sh patch    # bump patch (1.49.0 -> 1.49.1)
#   ./scripts/deploy.sh minor    # bump minor (1.49.0 -> 1.50.0)
#   ./scripts/deploy.sh major    # bump major (1.49.0 -> 2.0.0)
#   ./scripts/deploy.sh 1.50.0  # explicit version
#   ./scripts/deploy.sh patch --dry-run   # preview without executing
#   ./scripts/deploy.sh patch --skip-wrapper  # skip wrapper restart
#
# Pipeline:
#   1. Bump version in package.json
#   2. Commit & push evolver-private-dev to GitHub
#   3. Build public distribution (dist-public/)
#   4. Deploy to skills/evolver/ in the workspace
#   5. Publish to GitHub public repo + Release (EvoMap/evolver)
#   6. Publish to npm (@evomap/evolver)
#   7. Restart feishu-evolver-wrapper (optional)
#
# Prerequisites:
#   - gh CLI authenticated (gh auth login)
#   - npm authenticated (npm login)
#   - Working directory: evolver-private-dev repo root
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
SKILLS_EVOLVER="$WORKSPACE_ROOT/skills/evolver"
WRAPPER_DIR="$WORKSPACE_ROOT/skills/feishu-evolver-wrapper"
PUBLIC_REPO="EvoMap/evolver"

cd "$REPO_ROOT"

# --- Parse arguments ---
BUMP=""
DRY_RUN=false
SKIP_WRAPPER=false

for arg in "$@"; do
    case "$arg" in
        --dry-run)  DRY_RUN=true ;;
        --skip-wrapper) SKIP_WRAPPER=true ;;
        *)
            if [ -z "$BUMP" ]; then
                BUMP="$arg"
            fi
            ;;
    esac
done

if [ -z "$BUMP" ]; then
    echo "Usage: $0 <patch|minor|major|X.Y.Z> [--dry-run] [--skip-wrapper]"
    echo ""
    echo "Current version: $(node -p "require('./package.json').version")"
    echo ""
    echo "Options:"
    echo "  --dry-run        Preview all steps without executing"
    echo "  --skip-wrapper   Skip feishu-evolver-wrapper restart"
    exit 1
fi

CURRENT_VERSION=$(node -p "require('./package.json').version")

case "$BUMP" in
    patch|minor|major)
        NEW_VERSION=$(node -e "
            var v = '$CURRENT_VERSION'.split('.');
            if ('$BUMP' === 'patch') v[2] = parseInt(v[2]) + 1;
            if ('$BUMP' === 'minor') { v[1] = parseInt(v[1]) + 1; v[2] = 0; }
            if ('$BUMP' === 'major') { v[0] = parseInt(v[0]) + 1; v[1] = 0; v[2] = 0; }
            console.log(v.join('.'));
        ")
        ;;
    *)
        NEW_VERSION="$BUMP"
        ;;
esac

TOTAL_STEPS=7
if [ "$SKIP_WRAPPER" = true ]; then
    TOTAL_STEPS=6
fi

echo "=== Evolver Deploy Pipeline ==="
echo "Version: $CURRENT_VERSION -> $NEW_VERSION"
if [ "$DRY_RUN" = true ]; then
    echo "Mode: DRY RUN (no changes will be made)"
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

echo ""

# --- Step 1: Bump version ---
echo "[1/$TOTAL_STEPS] Bumping version to $NEW_VERSION..."
if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] sed -i \"s/\\\"version\\\": \\\"$CURRENT_VERSION\\\"/\\\"version\\\": \\\"$NEW_VERSION\\\"/\" package.json"
else
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
    else
        sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
    fi
fi

# --- Step 2: Commit & push private-dev ---
echo "[2/$TOTAL_STEPS] Committing and pushing evolver-private-dev..."
if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] git add -A && git commit && git push origin main"
else
    git add -A
    git commit -m "chore(release): prepare v$NEW_VERSION" || echo "  (nothing to commit)"
    git push origin main
fi

# --- Step 3: Build ---
echo "[3/$TOTAL_STEPS] Building public distribution..."
if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] RELEASE_VERSION=$NEW_VERSION node scripts/build_public.js"
else
    RELEASE_VERSION="$NEW_VERSION" node scripts/build_public.js
fi

# --- Step 4: Deploy to skills/evolver ---
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

# --- Step 5: Publish to GitHub public repo + Release ---
echo "[5/$TOTAL_STEPS] Publishing to GitHub ($PUBLIC_REPO) + Release v$NEW_VERSION..."
if [ "$DRY_RUN" = true ]; then
    DRY_RUN=true \
    PUBLIC_REPO="$PUBLIC_REPO" \
    PUBLIC_USE_BUILD_OUTPUT=true \
    RELEASE_TAG="v$NEW_VERSION" \
    RELEASE_TITLE="v$NEW_VERSION" \
    RELEASE_NOTES="Release v$NEW_VERSION" \
    node scripts/publish_public.js 2>&1
else
    PUBLIC_REPO="$PUBLIC_REPO" \
    PUBLIC_USE_BUILD_OUTPUT=true \
    RELEASE_TAG="v$NEW_VERSION" \
    RELEASE_TITLE="v$NEW_VERSION" \
    RELEASE_NOTES="Release v$NEW_VERSION" \
    node scripts/publish_public.js 2>&1 || echo "  WARN: publish_public.js exited non-zero (GitHub release may need manual check)"
fi

# --- Step 6: Publish npm ---
echo "[6/$TOTAL_STEPS] Publishing to npm (@evomap/evolver)..."
if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] cd dist-public && npm publish --access public"
else
    (cd "$REPO_ROOT/dist-public" && npm publish --access public 2>&1) || echo "  WARN: npm publish failed -- check 'npm login' or version conflict"
fi

# --- Step 8: Restart wrapper ---
if [ "$SKIP_WRAPPER" = false ]; then
    echo "[7/$TOTAL_STEPS] Restarting feishu-evolver-wrapper..."
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
fi

# --- Summary ---
echo ""
echo "=== Deploy Complete: v$NEW_VERSION ==="
echo "  GitHub:  https://github.com/$PUBLIC_REPO/releases/tag/v$NEW_VERSION"
echo "  npm:     https://www.npmjs.com/package/@evomap/evolver"
if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "  (This was a dry run. No changes were made.)"
fi
