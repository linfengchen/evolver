const fs = require('fs');
const path = require('path');
const { mergeJsonFile, copyHookScripts, appendSectionToFile, removeHookScripts } = require('./hookAdapter');

const HOOK_SCRIPTS_DIR_NAME = 'hooks';
const EVOLVER_MARKER = '<!-- evolver-evolution-memory -->';

function buildCodexHooksJson(evolverRoot) {
  const scriptsBase = '.codex/hooks';
  return {
    hooks: {
      SessionStart: [
        {
          type: 'command',
          command: `node ${scriptsBase}/evolver-session-start.js`,
          timeout: 3,
        },
      ],
      PostToolUse: [
        {
          type: 'command',
          command: `node ${scriptsBase}/evolver-signal-detect.js`,
          timeout: 2,
        },
      ],
      Stop: [
        {
          type: 'command',
          command: `node ${scriptsBase}/evolver-session-end.js`,
          timeout: 8,
        },
      ],
    },
  };
}

function ensureConfigToml(codexDir) {
  const tomlPath = path.join(codexDir, 'config.toml');
  let content = '';
  try { content = fs.readFileSync(tomlPath, 'utf8'); } catch { /* new file */ }

  if (/codex_hooks\s*=\s*true/i.test(content)) {
    return false;
  }

  if (/\[features\]/.test(content)) {
    content = content.replace(
      /\[features\]/,
      '[features]\ncodex_hooks = true'
    );
  } else {
    const separator = content.length > 0 && !content.endsWith('\n') ? '\n\n' : content.length > 0 ? '\n' : '';
    content += separator + '[features]\ncodex_hooks = true\n';
  }

  fs.writeFileSync(tomlPath, content, 'utf8');
  return true;
}

function buildAgentsMdSection() {
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
  const codexDir = path.join(configRoot, '.codex');
  const hooksJsonPath = path.join(codexDir, 'hooks.json');
  const hooksDir = path.join(codexDir, HOOK_SCRIPTS_DIR_NAME);
  const agentsMdPath = path.join(configRoot, 'AGENTS.md');

  if (!force && fs.existsSync(hooksJsonPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
      if (existing._evolver_managed) {
        console.log('[codex] Evolver hooks already installed. Use --force to overwrite.');
        return { ok: true, skipped: true };
      }
    } catch { /* proceed */ }
  }

  fs.mkdirSync(codexDir, { recursive: true });

  const hooksCfg = buildCodexHooksJson(evolverRoot);
  mergeJsonFile(hooksJsonPath, hooksCfg);
  console.log('[codex] Wrote ' + hooksJsonPath);

  const copied = copyHookScripts(hooksDir, path.join(evolverRoot, 'src', 'adapters'));
  console.log('[codex] Copied ' + copied.length + ' hook scripts to ' + hooksDir);

  const tomlChanged = ensureConfigToml(codexDir);
  if (tomlChanged) {
    console.log('[codex] Enabled codex_hooks in config.toml');
  }

  const injected = appendSectionToFile(agentsMdPath, EVOLVER_MARKER, buildAgentsMdSection());
  if (injected) {
    console.log('[codex] Injected evolution section into ' + agentsMdPath);
  }

  console.log('[codex] Installation complete.');

  return {
    ok: true,
    platform: 'codex',
    files: [hooksJsonPath, path.join(codexDir, 'config.toml'), agentsMdPath, ...copied],
  };
}

function uninstall({ configRoot }) {
  const codexDir = path.join(configRoot, '.codex');
  const hooksJsonPath = path.join(codexDir, 'hooks.json');
  const hooksDir = path.join(codexDir, HOOK_SCRIPTS_DIR_NAME);
  const agentsMdPath = path.join(configRoot, 'AGENTS.md');

  let changed = false;

  try {
    if (fs.existsSync(hooksJsonPath)) {
      const data = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
      if (data._evolver_managed) {
        if (data.hooks) {
          for (const event of Object.keys(data.hooks)) {
            if (Array.isArray(data.hooks[event])) {
              data.hooks[event] = data.hooks[event].filter(h => {
                const cmd = h.command || '';
                return !cmd.includes('evolver-session') && !cmd.includes('evolver-signal');
              });
              if (data.hooks[event].length === 0) delete data.hooks[event];
            }
          }
          if (Object.keys(data.hooks).length === 0) delete data.hooks;
        }
        delete data._evolver_managed;
        fs.writeFileSync(hooksJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
        changed = true;
      }
    }
  } catch { /* ignore */ }

  const scripts = removeHookScripts(hooksDir);
  if (scripts > 0) changed = true;

  try {
    if (fs.existsSync(agentsMdPath)) {
      let content = fs.readFileSync(agentsMdPath, 'utf8');
      if (content.includes(EVOLVER_MARKER)) {
        const idx = content.indexOf(EVOLVER_MARKER);
        const nextSection = content.indexOf('\n## ', idx + EVOLVER_MARKER.length);
        const endIdx = nextSection !== -1 ? nextSection : content.length;
        content = content.slice(0, idx).trimEnd() + (nextSection !== -1 ? content.slice(endIdx) : '');
        fs.writeFileSync(agentsMdPath, content.trimEnd() + '\n', 'utf8');
        changed = true;
      }
    }
  } catch { /* ignore */ }

  console.log(changed
    ? '[codex] Uninstalled evolver hooks.'
    : '[codex] No evolver hooks found to uninstall.');

  return { ok: true, removed: changed };
}

module.exports = { install, uninstall, buildCodexHooksJson, ensureConfigToml };
