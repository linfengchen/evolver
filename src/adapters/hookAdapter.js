const fs = require('fs');
const path = require('path');
const os = require('os');

const PLATFORMS = {
  cursor: { name: 'Cursor', configDir: '.cursor', detector: '.cursor' },
  'claude-code': { name: 'Claude Code', configDir: '.claude', detector: '.claude' },
  codex: { name: 'Codex', configDir: '.codex', detector: '.codex' },
  kiro: { name: 'Kiro', configDir: '.kiro', detector: '.kiro' },
  opencode: { name: 'opencode', configDir: '.opencode', detector: '.opencode' },
};

function detectPlatform(cwd) {
  const root = cwd || process.cwd();
  const home = os.homedir();
  for (const [id, meta] of Object.entries(PLATFORMS)) {
    if (fs.existsSync(path.join(root, meta.detector))) return id;
  }
  for (const [id, meta] of Object.entries(PLATFORMS)) {
    if (fs.existsSync(path.join(home, meta.detector))) return id;
  }
  return null;
}

function resolveConfigRoot(platformId, cwd) {
  const root = cwd || process.cwd();
  const home = os.homedir();
  const meta = PLATFORMS[platformId];
  if (!meta) return null;
  if (fs.existsSync(path.join(root, meta.detector))) return root;
  if (fs.existsSync(path.join(home, meta.detector))) return home;
  return root;
}

function loadAdapter(platformId) {
  switch (platformId) {
    case 'cursor': return require('./cursor');
    case 'claude-code': return require('./claudeCode');
    case 'codex': return require('./codex');
    case 'kiro': return require('./kiro');
    case 'opencode': return require('./opencode');
    default: return null;
  }
}

function mergeJsonFile(filePath, patch, { markerKey = '_evolver_managed' } = {}) {
  let existing = {};
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (raw) existing = JSON.parse(raw);
    }
  } catch { /* start fresh */ }
  const merged = deepMerge(existing, patch);
  merged[markerKey] = true;
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
  return merged;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function copyHookScripts(destDir, evolverRoot) {
  const scriptsDir = path.join(evolverRoot || __dirname, 'scripts');
  const scripts = [
    'evolver-session-start.js',
    'evolver-signal-detect.js',
    'evolver-session-end.js',
  ];
  fs.mkdirSync(destDir, { recursive: true });
  const copied = [];
  for (const name of scripts) {
    const src = path.join(scriptsDir, name);
    const dest = path.join(destDir, name);
    if (!fs.existsSync(src)) {
      console.warn(`[setup-hooks] Warning: script not found: ${src}`);
      continue;
    }
    fs.copyFileSync(src, dest);
    try { fs.chmodSync(dest, 0o755); } catch { /* windows */ }
    copied.push(dest);
  }
  return copied;
}

function appendSectionToFile(filePath, marker, content) {
  let existing = '';
  try { existing = fs.readFileSync(filePath, 'utf8'); } catch { /* new file */ }
  if (existing.includes(marker)) {
    console.log(`[setup-hooks] Section already present in ${filePath}, skipping.`);
    return false;
  }
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n\n' : '\n';
  fs.writeFileSync(filePath, existing + separator + content + '\n', 'utf8');
  return true;
}

function removeEvolverHooks(filePath, { markerKey = '_evolver_managed' } = {}) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data[markerKey]) return false;

    let changed = false;
    if (data.hooks) {
      for (const event of Object.keys(data.hooks)) {
        if (Array.isArray(data.hooks[event])) {
          const before = data.hooks[event].length;
          data.hooks[event] = data.hooks[event].filter(h => {
            const cmd = h.command || '';
            return !cmd.includes('evolver-session') && !cmd.includes('evolver-signal');
          });
          if (data.hooks[event].length !== before) changed = true;
          if (data.hooks[event].length === 0) delete data.hooks[event];
        }
      }
      if (Object.keys(data.hooks).length === 0) delete data.hooks;
    }
    if (data.mcpServers) {
      // Claude Code / Codex: hooks in mcpServers sub-key -- not relevant, skip
    }
    delete data[markerKey];
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, filePath);
    return changed;
  } catch {
    return false;
  }
}

function removeHookScripts(hooksDir) {
  const scripts = [
    'evolver-session-start.js',
    'evolver-signal-detect.js',
    'evolver-session-end.js',
  ];
  let removed = 0;
  for (const name of scripts) {
    const p = path.join(hooksDir, name);
    try {
      if (fs.existsSync(p)) { fs.unlinkSync(p); removed++; }
    } catch { /* ignore */ }
  }
  return removed;
}

async function setupHooks({ platform, cwd, force, uninstall, evolverRoot } = {}) {
  const effectiveCwd = cwd || process.cwd();
  const effectiveEvolverRoot = evolverRoot || path.resolve(__dirname, '..');
  const platformId = platform || detectPlatform(effectiveCwd);

  if (!platformId) {
    console.error('[setup-hooks] Could not detect platform. Use --platform=cursor|claude-code|codex|kiro|opencode');
    return { ok: false, error: 'platform_not_detected' };
  }

  const meta = PLATFORMS[platformId];
  if (!meta) {
    console.error(`[setup-hooks] Unknown platform: ${platformId}`);
    return { ok: false, error: 'unknown_platform' };
  }

  const configRoot = resolveConfigRoot(platformId, effectiveCwd);
  const adapter = loadAdapter(platformId);
  if (!adapter) {
    console.error(`[setup-hooks] No adapter found for ${platformId}`);
    return { ok: false, error: 'no_adapter' };
  }

  console.log(`[setup-hooks] Platform: ${meta.name}`);
  console.log(`[setup-hooks] Config root: ${configRoot}`);

  if (uninstall) {
    return adapter.uninstall({ configRoot, evolverRoot: effectiveEvolverRoot });
  }

  return adapter.install({ configRoot, evolverRoot: effectiveEvolverRoot, force });
}

module.exports = {
  detectPlatform,
  resolveConfigRoot,
  loadAdapter,
  mergeJsonFile,
  deepMerge,
  copyHookScripts,
  appendSectionToFile,
  removeEvolverHooks,
  removeHookScripts,
  setupHooks,
  PLATFORMS,
};
