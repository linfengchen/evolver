'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverProjects } = require('../src/webui/projects/discover');

function makeProject(root) {
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'memory', 'evolution'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'gep'), { recursive: true });
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

describe('webui project discovery', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-projects-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers cwd, OpenClaw, Claude Code, Cursor, Codex, and manual project paths', () => {
    const home = path.join(tmpDir, 'home');
    const projectsDir = path.join(tmpDir, 'projects');
    const cwdProject = path.join(projectsDir, 'cwd-app');
    const openClawProject = path.join(projectsDir, 'openclaw-app');
    const claudeProject = path.join(projectsDir, 'claude-app');
    const cursorProject = path.join(projectsDir, 'cursor-app');
    const codexProject = path.join(projectsDir, 'codex-app');
    const manualProject = path.join(projectsDir, 'manual-app');

    for (const projectRoot of [cwdProject, openClawProject, claudeProject, cursorProject, codexProject, manualProject]) {
      makeProject(projectRoot);
    }
    const cwdRoot = fs.realpathSync(cwdProject);
    const openClawRoot = fs.realpathSync(openClawProject);
    const claudeRoot = fs.realpathSync(claudeProject);
    const cursorRoot = fs.realpathSync(cursorProject);
    const codexRoot = fs.realpathSync(codexProject);
    const manualRoot = fs.realpathSync(manualProject);

    writeJsonl(path.join(home, '.openclaw', 'agents', 'main', 'sessions', 'session.jsonl'), [
      { type: 'session', timestamp: '2026-05-12T01:00:00.000Z', cwd: openClawProject },
    ]);
    writeJsonl(path.join(home, '.claude', 'projects', '-tmp-claude', 'session.jsonl'), [
      { type: 'permission-mode', sessionId: 's1' },
      { type: 'user', timestamp: '2026-05-12T02:00:00.000Z', cwd: claudeProject },
    ]);
    fs.mkdirSync(path.join(home, '.cursor', 'projects', 'cursor-workspace', 'terminals'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.cursor', 'projects', 'cursor-workspace', 'terminals', '1.txt'),
      `---\npid: 123\ncwd: ${cursorProject}\nlast_command: node index.js\n---\n`,
      'utf8',
    );
    writeJsonl(path.join(home, '.codex', 'sessions', 'rollout-1.jsonl'), [
      { type: 'item.added', timestamp: '2026-05-12T03:00:00.000Z', cwd: codexProject, item: { type: 'message' } },
    ]);

    const result = discoverProjects({
      homedir: home,
      cwd: cwdProject,
      env: { EVOLVER_WEBUI_EXTRA_PROJECTS: manualProject },
    });
    const byRoot = new Map(result.map((project) => [project.repoRoot, project]));

    assert.deepEqual(new Set(byRoot.get(cwdRoot).agentSources), new Set(['cwd']));
    assert.ok(byRoot.get(openClawRoot).agentSources.includes('openclaw'));
    assert.ok(byRoot.get(claudeRoot).agentSources.includes('claude-code'));
    assert.ok(byRoot.get(cursorRoot).agentSources.includes('cursor'));
    assert.ok(byRoot.get(codexRoot).agentSources.includes('codex'));
    assert.ok(byRoot.get(manualRoot).agentSources.includes('manual'));
  });
});
