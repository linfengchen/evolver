const fs = require('fs');
const path = require('path');
const { mergeJsonFile, copyHookScripts, appendSectionToFile, removeHookScripts } = require('./hookAdapter');

const HOOK_SCRIPTS_DIR_NAME = 'hooks';
const EVOLVER_MARKER = '<!-- evolver-evolution-memory -->';

function buildClaudeHooks(evolverRoot) {
  const scriptsBase = '.claude/hooks';
  return {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: `node ${scriptsBase}/evolver-session-start.js`,
              timeout: 3,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Write',
          hooks: [
            {
              type: 'command',
              command: `node ${scriptsBase}/evolver-signal-detect.js`,
              timeout: 2,
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: `node ${scriptsBase}/evolver-session-end.js`,
              timeout: 8,
            },
          ],
        },
      ],
    },
  };
}

function buildClaudeMdSection() {
  return `${EVOLVER_MARKER}
## Evolution Memory (Evolver)

This project uses evolver for self-evolution. Hooks automatically:
1. Inject recent evolution memory at session start
2. Detect evolution signals during file edits
3. Record outcomes at session end

For substantive tasks, call \`gep_recall\` before work and \`gep_record_outcome\` after.
Signals: log_error, perf_bottleneck, user_feature_request, capability_gap, deployment_issue, test_failure.`;
}

function install({ configRoot, evolverRoot, force }) {
  const claudeDir = path.join(configRoot, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const hooksDir = path.join(claudeDir, HOOK_SCRIPTS_DIR_NAME);
  const claudeMdPath = path.join(configRoot, 'CLAUDE.md');

  if (!force && fs.existsSync(settingsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (existing._evolver_managed) {
        console.log('[claude-code] Evolver hooks already installed. Use --force to overwrite.');
        return { ok: true, skipped: true };
      }
    } catch { /* proceed */ }
  }

  fs.mkdirSync(claudeDir, { recursive: true });

  const hooksCfg = buildClaudeHooks(evolverRoot);
  mergeJsonFile(settingsPath, hooksCfg);
  console.log('[claude-code] Wrote ' + settingsPath);

  const copied = copyHookScripts(hooksDir, path.join(evolverRoot, 'src', 'adapters'));
  console.log('[claude-code] Copied ' + copied.length + ' hook scripts to ' + hooksDir);

  const injected = appendSectionToFile(claudeMdPath, EVOLVER_MARKER, buildClaudeMdSection());
  if (injected) {
    console.log('[claude-code] Injected evolution section into ' + claudeMdPath);
  }

  console.log('[claude-code] Installation complete.');

  return {
    ok: true,
    platform: 'claude-code',
    files: [settingsPath, claudeMdPath, ...copied],
  };
}

function uninstall({ configRoot }) {
  const claudeDir = path.join(configRoot, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const hooksDir = path.join(claudeDir, HOOK_SCRIPTS_DIR_NAME);
  const claudeMdPath = path.join(configRoot, 'CLAUDE.md');

  let changed = false;

  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (data._evolver_managed) {
        if (data.hooks) {
          for (const event of Object.keys(data.hooks)) {
            if (Array.isArray(data.hooks[event])) {
              data.hooks[event] = data.hooks[event]
                .map(matcher => {
                  if (!matcher || !Array.isArray(matcher.hooks)) return matcher;
                  const filtered = matcher.hooks.filter(h => {
                    const cmd = (h && h.command) || '';
                    return !cmd.includes('evolver-session') && !cmd.includes('evolver-signal');
                  });
                  return { ...matcher, hooks: filtered };
                })
                .filter(matcher => matcher && Array.isArray(matcher.hooks) && matcher.hooks.length > 0);
              if (data.hooks[event].length === 0) delete data.hooks[event];
            }
          }
          if (Object.keys(data.hooks).length === 0) delete data.hooks;
        }
        delete data._evolver_managed;
        fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
        changed = true;
      }
    }
  } catch { /* ignore */ }

  const scripts = removeHookScripts(hooksDir);
  if (scripts > 0) changed = true;

  try {
    if (fs.existsSync(claudeMdPath)) {
      let content = fs.readFileSync(claudeMdPath, 'utf8');
      if (content.includes(EVOLVER_MARKER)) {
        const idx = content.indexOf(EVOLVER_MARKER);
        const nextSection = content.indexOf('\n## ', idx + EVOLVER_MARKER.length);
        const endIdx = nextSection !== -1 ? nextSection : content.length;
        content = content.slice(0, idx).trimEnd() + (nextSection !== -1 ? content.slice(endIdx) : '');
        fs.writeFileSync(claudeMdPath, content.trimEnd() + '\n', 'utf8');
        changed = true;
      }
    }
  } catch { /* ignore */ }

  console.log(changed
    ? '[claude-code] Uninstalled evolver hooks.'
    : '[claude-code] No evolver hooks found to uninstall.');

  return { ok: true, removed: changed };
}

module.exports = { install, uninstall, buildClaudeHooks };
