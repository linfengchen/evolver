'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HEAD_BYTES = 4096;
const MAX_FILES_PER_PROVIDER_DIR = 20;

function discoverProjects(opts = {}) {
  const homedir = opts.homedir || os.homedir();
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const discovered = [];

  addCandidate(discovered, projectFromPath(cwd, {
    source: 'cwd',
    labelHint: 'Current working directory',
  }));

  for (const project of discoverManualProjects(env, homedir)) addCandidate(discovered, project);
  for (const project of discoverOpenClawProjects(homedir)) addCandidate(discovered, project);
  for (const project of discoverClaudeCodeProjects(homedir)) addCandidate(discovered, project);
  for (const project of discoverCursorProjects(homedir)) addCandidate(discovered, project);
  for (const project of discoverCodexProjects(homedir)) addCandidate(discovered, project);

  return dedupeProjects(discovered).sort(projectSort);
}

function discoverManualProjects(env, homedir) {
  const raw = String(env.EVOLVER_WEBUI_EXTRA_PROJECTS || '').trim();
  if (!raw) return [];
  return raw
    .split(path.delimiter)
    .map((entry) => expandHome(entry.trim(), homedir))
    .filter(Boolean)
    .map((entry) => projectFromPath(entry, {
      source: 'manual',
      labelHint: 'Manual path',
    }))
    .filter(Boolean);
}

function discoverOpenClawProjects(homedir) {
  const agentsRoot = path.join(homedir, '.openclaw', 'agents');
  const projects = [];
  for (const agentDir of readDirs(agentsRoot)) {
    const sessionsDir = path.join(agentsRoot, agentDir, 'sessions');
    for (const fileName of recentFiles(sessionsDir, '.jsonl')) {
      if (fileName.includes('.lock') || fileName.includes('.reset.')) continue;
      const sessionPath = path.join(sessionsDir, fileName);
      const header = readJsonlHead(sessionPath);
      if (!header || typeof header.cwd !== 'string') continue;
      addCandidate(projects, projectFromPath(header.cwd, {
        source: 'openclaw',
        agentName: agentDir,
        sessionPath,
        lastSeenAt: header.timestamp || fileMtimeIso(sessionPath),
      }));
    }
  }
  return projects;
}

function discoverClaudeCodeProjects(homedir) {
  const projectsRoot = path.join(homedir, '.claude', 'projects');
  const projects = [];
  for (const projectDir of readDirs(projectsRoot)) {
    const dirPath = path.join(projectsRoot, projectDir);
    let decodedFallback = null;
    for (const fileName of recentFiles(dirPath, '.jsonl')) {
      const sessionPath = path.join(dirPath, fileName);
      const metadata = readCwdFromJsonlRecords(sessionPath);
      if (metadata.cwd) {
        addCandidate(projects, projectFromPath(metadata.cwd, {
          source: 'claude-code',
          sessionPath,
          lastSeenAt: metadata.timestamp || fileMtimeIso(sessionPath),
        }));
        continue;
      }
      if (!decodedFallback) decodedFallback = decodeProjectSegment(projectDir);
      if (decodedFallback) {
        addCandidate(projects, projectFromPath(decodedFallback, {
          source: 'claude-code',
          sessionPath,
          lastSeenAt: fileMtimeIso(sessionPath),
          warning: 'cwd inferred from Claude Code project directory name',
        }));
      }
    }
  }
  return projects;
}

function discoverCursorProjects(homedir) {
  const projectsRoot = path.join(homedir, '.cursor', 'projects');
  const projects = [];
  for (const projectDir of readDirs(projectsRoot)) {
    const dirPath = path.join(projectsRoot, projectDir);
    const terminalDir = path.join(dirPath, 'terminals');
    let foundFromTerminal = false;
    for (const fileName of recentFiles(terminalDir, '.txt')) {
      const terminalPath = path.join(terminalDir, fileName);
      const terminalCwd = readCursorTerminalCwd(terminalPath);
      if (!terminalCwd) continue;
      foundFromTerminal = true;
      addCandidate(projects, projectFromPath(terminalCwd, {
        source: 'cursor',
        sessionPath: terminalPath,
        lastSeenAt: fileMtimeIso(terminalPath),
      }));
    }

    if (foundFromTerminal) continue;
    const decoded = decodeProjectSegment(projectDir);
    if (!decoded) continue;
    addCandidate(projects, projectFromPath(decoded, {
      source: 'cursor',
      lastSeenAt: dirMtimeIso(dirPath),
      warning: 'cwd inferred from Cursor project directory name',
    }));
  }
  return projects;
}

function discoverCodexProjects(homedir) {
  const sessionsRoot = path.join(homedir, '.codex', 'sessions');
  const historyPath = path.join(homedir, '.codex', 'history.jsonl');
  const projects = [];

  for (const fileName of recentFiles(sessionsRoot, '.jsonl')) {
    const sessionPath = path.join(sessionsRoot, fileName);
    const metadata = readCwdFromJsonlRecords(sessionPath);
    if (!metadata.cwd) continue;
    addCandidate(projects, projectFromPath(metadata.cwd, {
      source: 'codex',
      sessionPath,
      lastSeenAt: metadata.timestamp || fileMtimeIso(sessionPath),
    }));
  }

  const history = readCwdFromJsonlRecords(historyPath);
  if (history.cwd) {
    addCandidate(projects, projectFromPath(history.cwd, {
      source: 'codex',
      sessionPath: historyPath,
      lastSeenAt: history.timestamp || fileMtimeIso(historyPath),
    }));
  }
  return projects;
}

function projectFromPath(inputPath, details = {}) {
  const projectRoot = resolveProjectRoot(inputPath);
  if (!projectRoot) return null;
  const workspaceRoot = resolveWorkspaceRoot(projectRoot);
  const memoryDir = path.join(workspaceRoot, 'memory');
  const evolutionDir = path.join(memoryDir, 'evolution');
  const gepAssetsDir = path.join(projectRoot, 'assets', 'gep');
  const hasEvolution = fs.existsSync(evolutionDir);
  const hasAssets = fs.existsSync(gepAssetsDir);
  if (!['cwd', 'manual'].includes(details.source) && !hasEvolution && !hasAssets) return null;
  const logsDir = path.join(workspaceRoot, 'logs');
  const label = buildProjectLabel(projectRoot, details.labelHint);
  return {
    id: projectId(projectRoot),
    label,
    repoRoot: projectRoot,
    workspaceRoot,
    memoryDir,
    evolutionDir,
    gepAssetsDir,
    logsDir,
    skillsDir: path.join(workspaceRoot, 'skills'),
    agentSources: [details.source || 'unknown'],
    agentNames: details.agentName ? [details.agentName] : [],
    sessionPaths: details.sessionPath ? [details.sessionPath] : [],
    lastSeenAt: details.lastSeenAt || null,
    hasMemory: fs.existsSync(memoryDir),
    hasEvolution,
    hasAssets,
    warnings: details.warning ? [details.warning] : [],
  };
}

function resolveProjectRoot(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return null;
  const resolved = safeRealpath(path.resolve(inputPath));
  if (!resolved || !path.isAbsolute(resolved)) return null;
  const stats = safeStat(resolved);
  if (!stats || !stats.isDirectory()) return null;

  const fromSpecialDir = rootFromKnownSubdir(resolved);
  if (fromSpecialDir && isValidProjectRoot(fromSpecialDir)) return fromSpecialDir;

  const gitRoot = findAncestorWith(resolved, '.git');
  if (gitRoot && isValidProjectRoot(gitRoot)) return gitRoot;

  if (isValidProjectRoot(resolved)) return resolved;
  return null;
}

function rootFromKnownSubdir(inputPath) {
  const normalized = inputPath.split(path.sep).join('/');
  if (normalized.endsWith('/memory/evolution')) return path.dirname(path.dirname(inputPath));
  if (normalized.endsWith('/assets/gep')) return path.dirname(path.dirname(inputPath));
  return null;
}

function isValidProjectRoot(projectRoot) {
  return fs.existsSync(path.join(projectRoot, '.git')) ||
    fs.existsSync(path.join(projectRoot, 'memory', 'evolution')) ||
    fs.existsSync(path.join(projectRoot, 'assets', 'gep'));
}

function resolveWorkspaceRoot(projectRoot) {
  const workspaceDir = path.join(projectRoot, 'workspace');
  return fs.existsSync(workspaceDir) ? workspaceDir : projectRoot;
}

function findAncestorWith(start, childName) {
  let current = start;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, childName))) return current;
    current = path.dirname(current);
  }
  return null;
}

function dedupeProjects(projects) {
  const byRoot = new Map();
  for (const project of projects.filter(Boolean)) {
    const key = safeRealpath(project.repoRoot) || project.repoRoot;
    const existing = byRoot.get(key);
    if (!existing) {
      byRoot.set(key, project);
      continue;
    }
    existing.agentSources = union(existing.agentSources, project.agentSources);
    existing.agentNames = union(existing.agentNames, project.agentNames);
    existing.sessionPaths = union(existing.sessionPaths, project.sessionPaths);
    existing.warnings = union(existing.warnings, project.warnings);
    existing.lastSeenAt = latestIso(existing.lastSeenAt, project.lastSeenAt);
    existing.hasMemory = existing.hasMemory || project.hasMemory;
    existing.hasEvolution = existing.hasEvolution || project.hasEvolution;
    existing.hasAssets = existing.hasAssets || project.hasAssets;
  }
  return Array.from(byRoot.values());
}

function projectSort(a, b) {
  if (a.agentSources.includes('cwd') && !b.agentSources.includes('cwd')) return -1;
  if (b.agentSources.includes('cwd') && !a.agentSources.includes('cwd')) return 1;
  const timeDelta = Date.parse(b.lastSeenAt || '') - Date.parse(a.lastSeenAt || '');
  if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta;
  return a.label.localeCompare(b.label);
}

function addCandidate(projects, project) {
  if (project) projects.push(project);
}

function readDirs(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // Missing provider directories are expected on machines without that agent.
    return [];
  }
}

function recentFiles(dirPath, suffix) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => {
        const filePath = path.join(dirPath, entry.name);
        return { name: entry.name, time: safeMtime(filePath) };
      })
      .sort((a, b) => b.time - a.time)
      .slice(0, MAX_FILES_PER_PROVIDER_DIR)
      .map((entry) => entry.name);
  } catch {
    // Missing provider directories are expected on machines without that agent.
    return [];
  }
}

function readJsonlHead(filePath) {
  const head = readHead(filePath, HEAD_BYTES);
  const line = head.split('\n').find((entry) => entry.trim());
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    // Malformed metadata should not break the dashboard discovery list.
    return null;
  }
}

function readCwdFromJsonlRecords(filePath) {
  const head = readHead(filePath, HEAD_BYTES * 4);
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const cwd = extractCwd(record);
      if (cwd) {
        return {
          cwd,
          timestamp: record.timestamp || record.created_at || record.time || null,
        };
      }
    } catch {
      // Skip malformed transcript rows; discovery is best-effort metadata only.
    }
  }
  return { cwd: null, timestamp: null };
}

function extractCwd(record) {
  if (!record || typeof record !== 'object') return null;
  if (typeof record.cwd === 'string') return record.cwd;
  if (record.session && typeof record.session.cwd === 'string') return record.session.cwd;
  if (record.item && typeof record.item.cwd === 'string') return record.item.cwd;
  return null;
}

function readCursorTerminalCwd(filePath) {
  const head = readHead(filePath, 1024);
  const match = /^cwd:\s*(.+)$/m.exec(head);
  return match ? match[1].trim() : null;
}

function readHead(filePath, maxBytes) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
      return buffer.slice(0, bytesRead).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Unreadable session files are ignored; discovery is best-effort metadata.
    return '';
  }
}

function decodeProjectSegment(segment) {
  if (!segment || /^\d+$/.test(segment)) return null;
  const normalized = segment.startsWith('-') ? segment.slice(1) : segment;
  const candidate = path.sep + normalized.split('-').filter(Boolean).join(path.sep);
  return fs.existsSync(candidate) ? candidate : null;
}

function buildProjectLabel(projectRoot, labelHint) {
  const base = path.basename(projectRoot) || projectRoot;
  return labelHint ? `${base} (${labelHint})` : base;
}

function projectId(projectRoot) {
  return `p_${crypto.createHash('sha1').update(projectRoot).digest('hex').slice(0, 12)}`;
}

function latestIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function union(a, b) {
  return Array.from(new Set([...(a || []), ...(b || [])].filter(Boolean)));
}

function fileMtimeIso(filePath) {
  const mtime = safeMtime(filePath);
  return mtime ? new Date(mtime).toISOString() : null;
}

function dirMtimeIso(dirPath) {
  return fileMtimeIso(dirPath);
}

function safeMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    // Unreadable files simply sort as oldest.
    return 0;
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    // Candidate path disappeared or is unreadable.
    return null;
  }
}

function safeRealpath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    // Invalid candidate paths are ignored by validation.
    return null;
  }
}

function expandHome(value, homedir) {
  if (!value) return '';
  if (value === '~') return homedir;
  if (value.startsWith(`~${path.sep}`)) return path.join(homedir, value.slice(2));
  return value;
}

module.exports = {
  discoverProjects,
  projectFromPath,
  decodeProjectSegment,
  readCursorTerminalCwd,
};
