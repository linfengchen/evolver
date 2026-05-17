'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync, spawn } = require('child_process');
const observer = require('../observer');

const SKILL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const DEFAULT_PACKAGE_NAME = '@evomap/evolver';
const DEFAULT_WEBUI_PORT = 19821;
let managedProxy = null;
let managedProxyStartPromise = null;

function buildWebUiRoutes() {
  return {
    'GET /webui/status': async () => ({ body: observer.getStatus() }),
    'GET /webui/version': async ({ server }) => ({ body: getVersionStatus(server) }),
    'POST /webui/version/check': async ({ server }) => ({ body: await checkVersion(server) }),
    'POST /webui/version/update-restart': async ({ server }) => updateAndRestart(server),
    'GET /webui/safety': async () => ({ body: observer.getSafetyState() }),
    'GET /webui/runs': async ({ query }) => ({ body: observer.listRuns(query) }),
    'GET /webui/runs/:runId': async ({ params }) => {
      const run = observer.getRun(params.runId);
      if (!run) throw httpError(404, 'RUN_NOT_FOUND', 'Run not found');
      return { body: run };
    },
    'GET /webui/assets': async ({ query }) => ({ body: observer.getAssetOverview(query) }),
    'GET /webui/assets/genes': async ({ query }) => ({ body: observer.listGenes(query) }),
    'GET /webui/assets/capsules': async ({ query }) => ({ body: observer.listCapsules(query) }),
    'GET /webui/assets/events': async ({ query }) => ({ body: observer.listEvents(query) }),
    'GET /webui/assets/candidates': async ({ query }) => ({ body: observer.listCandidates(query) }),
    'GET /webui/assets/calls': async ({ query }) => ({ body: observer.listAssetCalls(query) }),
    'GET /webui/assets/lineage/:id': async ({ params }) => ({ body: observer.getLineage(params.id) }),
    'GET /webui/interactions': async ({ query }) => ({ body: await observer.getInteractions(query) }),
    'POST /webui/proxy/start': async () => startManagedProxy(),
    'GET /webui/personality': async () => ({ body: observer.getPersonality() }),
    'GET /webui/memory-graph': async ({ query }) => ({ body: observer.getMemoryGraph(query) }),
    'GET /webui/skills': async () => ({ body: observer.listSkills() }),
    'POST /webui/skills/fetch': async ({ body }) => fetchSkill(body),
    'GET /webui/lifecycle': async ({ query }) => ({ body: observer.getLifecycle(query) }),
    'GET /webui/logs/evolver': async ({ query }) => ({ body: observer.getEvolverLog(query) }),
  };
}

async function startManagedProxy() {
  const current = observer.getStatus().proxy;
  if (current && current.running) {
    return { body: { ok: true, alreadyRunning: true, proxy: current } };
  }

  if (managedProxyStartPromise) return managedProxyStartPromise;

  managedProxyStartPromise = (async () => {
    try {
      const { startProxy } = require('../../proxy');
      const info = await startProxy({ logger: console });
      managedProxy = info.proxy;
      return {
        body: {
          ok: true,
          alreadyRunning: false,
          proxy: observer.getStatus().proxy,
          info: {
            url: info.url,
            port: info.port,
            nodeId: info.nodeId,
          },
        },
      };
    } catch (err) {
      throw httpError(500, 'PROXY_START_FAILED', err && err.message || 'Failed to start proxy');
    } finally {
      managedProxyStartPromise = null;
    }
  })();

  return managedProxyStartPromise;
}

async function stopManagedProxy() {
  if (!managedProxy) return;
  const proxy = managedProxy;
  managedProxy = null;
  try {
    await proxy.stop();
  } catch (_) {
    // Ignore shutdown errors; the Web UI process is already exiting.
  }
}

async function fetchSkill(body) {
  const skillId = body && typeof body.skillId === 'string' ? body.skillId.trim() : '';
  if (!SKILL_ID_PATTERN.test(skillId)) {
    throw httpError(400, 'INVALID_SKILL_ID', 'Skill ID must start with a letter or number and contain only letters, numbers, dot, underscore, dash, or colon.');
  }

  const repoRoot = path.resolve(__dirname, '../../..');
  const indexPath = path.join(repoRoot, 'index.js');
  const result = await execFileJson(process.execPath, [indexPath, 'fetch', '--skill', skillId], {
    cwd: repoRoot,
    env: process.env,
    timeout: 45000,
    maxBuffer: 1024 * 1024,
  });

  if (result.code !== 0) {
    throw httpError(502, 'FETCH_FAILED', extractFailure(result.stderr || result.stdout) || 'Skill fetch failed', {
      skillId,
      stdout: trimOutput(result.stdout),
      stderr: trimOutput(result.stderr),
    });
  }

  return {
    body: {
      ok: true,
      skillId,
      stdout: trimOutput(result.stdout),
      stderr: trimOutput(result.stderr),
      skills: observer.listSkills(),
    },
  };
}

function getRepoRoot() {
  return path.resolve(__dirname, '../../..');
}

function readPackageInfo() {
  const packagePath = path.join(getRepoRoot(), 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return {
      packageName: pkg.name || DEFAULT_PACKAGE_NAME,
      currentVersion: pkg.version || '0.0.0',
      packagePath,
    };
  } catch (err) {
    return {
      packageName: DEFAULT_PACKAGE_NAME,
      currentVersion: '0.0.0',
      packagePath,
      readError: err && err.message || String(err),
    };
  }
}

function getServerPort(server) {
  return Number(server && (server.actualPort || server.port)) || Number(process.env.EVOLVER_WEBUI_PORT) || DEFAULT_WEBUI_PORT;
}

function getVersionStatus(server, update = {}) {
  const pkg = readPackageInfo();
  const status = observer.getStatus();
  const command = getUpdateCommand(pkg.packageName);
  const officialVersion = update.latestVersion || update.officialVersion || null;
  const localAhead = officialVersion ? compareVersions(pkg.currentVersion, officialVersion) > 0 : false;
  const effectiveVersion = officialVersion || pkg.currentVersion;
  return {
    packageName: pkg.packageName,
    currentVersion: effectiveVersion,
    localVersion: pkg.currentVersion,
    officialVersion,
    versionSource: officialVersion ? 'npm' : 'local',
    displayVersion: `${pkg.packageName} v${effectiveVersion}`,
    packagePath: pkg.packagePath,
    packageReadError: pkg.readError || null,
    webui: {
      running: true,
      pid: process.pid,
      port: getServerPort(server),
    },
    proxy: status.proxy || { running: false },
    update: {
      checkedAt: update.checkedAt || null,
      latestVersion: update.latestVersion || null,
      localAhead,
      updateAvailable: typeof update.updateAvailable === 'boolean' ? update.updateAvailable : null,
      registryUrl: update.registryUrl || registryUrl(pkg.packageName),
      command: command.label,
    },
  };
}

async function checkVersion(server) {
  const pkg = readPackageInfo();
  const url = registryUrl(pkg.packageName);
  let latestVersion;
  try {
    latestVersion = await fetchLatestNpmVersion(pkg.packageName);
  } catch (err) {
    throw httpError(502, 'VERSION_CHECK_FAILED', err && err.message || 'Version check failed', { registryUrl: url });
  }

  return getVersionStatus(server, {
    checkedAt: new Date().toISOString(),
    latestVersion,
    updateAvailable: compareVersions(latestVersion, pkg.currentVersion) > 0,
    registryUrl: url,
  });
}

async function updateAndRestart(server) {
  const pkg = readPackageInfo();
  const command = getUpdateCommand(pkg.packageName);
  const result = await execFileJson(command.command, command.args, {
    cwd: command.cwd,
    env: process.env,
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });

  if (result.code !== 0) {
    throw httpError(502, 'UPDATE_FAILED', extractFailure(result.stderr || result.stdout) || 'Update command failed', {
      command: command.label,
      stdout: trimOutput(result.stdout),
      stderr: trimOutput(result.stderr),
    });
  }

  const port = getServerPort(server);
  const restart = scheduleWebUiRestart(port);
  setTimeout(() => process.exit(0), 450);

  return {
    status: 202,
    body: {
      ok: true,
      command: command.label,
      restart,
      stdout: trimOutput(result.stdout),
      stderr: trimOutput(result.stderr),
    },
  };
}

function getUpdateCommand(packageName) {
  const repoRoot = getRepoRoot();
  if (fs.existsSync(path.join(repoRoot, '.git'))) {
    return getGitUpdateCommand(repoRoot);
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return {
    command: npmCommand,
    args: ['install', '-g', `${packageName || DEFAULT_PACKAGE_NAME}@latest`],
    cwd: repoRoot,
    label: `npm install -g ${packageName || DEFAULT_PACKAGE_NAME}@latest`,
  };
}

function getGitUpdateCommand(repoRoot) {
  const upstream = gitText(repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (upstream) {
    return {
      command: 'git',
      args: ['pull', '--ff-only'],
      cwd: repoRoot,
      label: `git pull --ff-only (${upstream})`,
    };
  }

  const remote = firstLine(gitText(repoRoot, ['remote'])) || 'origin';
  const defaultBranch = getRemoteDefaultBranch(repoRoot, remote);
  const currentBranch = firstLine(gitText(repoRoot, ['branch', '--show-current']));
  const branch = defaultBranch || currentBranch;
  if (!branch) {
    return {
      command: 'git',
      args: ['pull', '--ff-only'],
      cwd: repoRoot,
      label: 'git pull --ff-only',
    };
  }

  return {
    command: 'git',
    args: ['pull', '--ff-only', remote, branch],
    cwd: repoRoot,
    label: `git pull --ff-only ${remote} ${branch}`,
  };
}

function getRemoteDefaultBranch(repoRoot, remote) {
  const ref = gitText(repoRoot, ['symbolic-ref', `refs/remotes/${remote}/HEAD`]);
  const prefix = `refs/remotes/${remote}/`;
  if (ref && ref.startsWith(prefix)) return ref.slice(prefix.length);
  return '';
}

function gitText(repoRoot, args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch (_) {
    return '';
  }
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function scheduleWebUiRestart(port) {
  const repoRoot = getRepoRoot();
  const indexPath = path.join(repoRoot, 'index.js');
  const restartArgs = [indexPath, 'webui', `--port=${port}`];
  const script = [
    'const { spawn } = require("child_process");',
    `const child = spawn(${JSON.stringify(process.execPath)}, ${JSON.stringify(restartArgs)}, {`,
    `  cwd: ${JSON.stringify(repoRoot)},`,
    '  detached: true,',
    '  stdio: "ignore",',
    `  env: Object.assign({}, process.env, { EVOLVER_WEBUI_PORT: ${JSON.stringify(String(port))} }),`,
    '});',
    'child.unref();',
  ].join('\n');

  const launcher = spawn(process.execPath, ['-e', `setTimeout(() => {\n${script}\n}, 1200);`], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  launcher.unref();
  return { scheduled: true, port, currentPid: process.pid };
}

function registryUrl(packageName) {
  const encoded = encodeURIComponent(packageName || DEFAULT_PACKAGE_NAME).replace(/^%40/i, '@').replace(/%2F/ig, '%2f');
  return `https://registry.npmjs.org/${encoded}/latest`;
}

async function fetchLatestNpmVersion(packageName) {
  if (typeof fetch !== 'function') throw new Error('This Node.js runtime does not provide fetch.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(registryUrl(packageName), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Registry returned HTTP ${res.status}`);
    const body = await res.json();
    if (!body || !body.version) throw new Error('Registry response did not include a version.');
    return String(body.version);
  } finally {
    clearTimeout(timeout);
  }
}

function compareVersions(left, right) {
  const a = splitVersion(left);
  const b = splitVersion(right);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (typeof av === 'number' && typeof bv === 'number') {
      if (av !== bv) return av > bv ? 1 : -1;
    } else {
      const cmp = String(av).localeCompare(String(bv));
      if (cmp !== 0) return cmp > 0 ? 1 : -1;
    }
  }
  return 0;
}

function splitVersion(value) {
  return String(value || '0').replace(/^v/i, '').split(/[.+-]/).flatMap((chunk) => (
    chunk.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  ));
}

function execFileJson(command, args, options) {
  return new Promise((resolve) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        signal: error && error.signal || null,
        stdout: stdout || '',
        stderr: stderr || '',
      });
    });
  });
}

function extractFailure(output) {
  const line = String(output || '').split(/\r?\n/).find((row) => row.trim());
  return line ? line.trim() : '';
}

function trimOutput(output) {
  const text = String(output || '').trim();
  return text.length > 4000 ? text.slice(0, 4000) + '\n...(truncated)' : text;
}

function httpError(statusCode, code, message, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  err.details = details || {};
  return err;
}

module.exports = {
  buildWebUiRoutes,
  httpError,
  fetchSkill,
  getVersionStatus,
  checkVersion,
  compareVersions,
  startManagedProxy,
  stopManagedProxy,
  SKILL_ID_PATTERN,
};
