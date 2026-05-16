'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getRepoRoot, getMemoryDir, getEvolutionDir, getGepAssetsDir, getLogsDir } = require('../src/gep/paths');
const { projectFromPath } = require('../src/webui/projects/discover');
const { runWithProject } = require('../src/webui/projects/context');

function makeProject(root) {
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'memory', 'evolution'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'gep'), { recursive: true });
}

describe('webui project path context', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-context-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves project paths from request-local context', async () => {
    const firstRoot = path.join(tmpDir, 'first');
    const secondRoot = path.join(tmpDir, 'second');
    makeProject(firstRoot);
    makeProject(secondRoot);
    const firstRealRoot = fs.realpathSync(firstRoot);
    const secondRealRoot = fs.realpathSync(secondRoot);

    const firstProject = projectFromPath(firstRoot, { source: 'test' });
    const secondProject = projectFromPath(secondRoot, { source: 'test' });

    await Promise.all([
      runWithProject(firstProject, async () => {
        assert.equal(getRepoRoot(), firstRealRoot);
        assert.equal(getMemoryDir(), path.join(firstRealRoot, 'memory'));
        assert.equal(getEvolutionDir(), path.join(firstRealRoot, 'memory', 'evolution'));
        assert.equal(getGepAssetsDir(), path.join(firstRealRoot, 'assets', 'gep'));
        assert.equal(getLogsDir(), path.join(firstRealRoot, 'logs'));
      }),
      runWithProject(secondProject, async () => {
        assert.equal(getRepoRoot(), secondRealRoot);
        assert.equal(getMemoryDir(), path.join(secondRealRoot, 'memory'));
        assert.equal(getEvolutionDir(), path.join(secondRealRoot, 'memory', 'evolution'));
        assert.equal(getGepAssetsDir(), path.join(secondRealRoot, 'assets', 'gep'));
        assert.equal(getLogsDir(), path.join(secondRealRoot, 'logs'));
      }),
    ]);
  });
});
