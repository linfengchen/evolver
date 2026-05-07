const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const hookAdapter = require('../src/adapters/hookAdapter');
const opencodeAdapter = require('../src/adapters/opencode');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evolver-opencode-test-'));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

describe('opencode: registration in hookAdapter', () => {
  it('PLATFORMS contains opencode entry', () => {
    assert.ok(hookAdapter.PLATFORMS.opencode, 'PLATFORMS.opencode must be defined');
    assert.equal(hookAdapter.PLATFORMS.opencode.configDir, '.opencode');
    assert.equal(hookAdapter.PLATFORMS.opencode.detector, '.opencode');
    assert.equal(hookAdapter.PLATFORMS.opencode.name, 'opencode');
  });

  it('loadAdapter("opencode") returns opencode module', () => {
    const mod = hookAdapter.loadAdapter('opencode');
    assert.ok(mod);
    assert.equal(typeof mod.install, 'function');
    assert.equal(typeof mod.uninstall, 'function');
  });

  it('detectPlatform finds opencode from .opencode directory', () => {
    const tmp = makeTmpDir();
    try {
      fs.mkdirSync(path.join(tmp, '.opencode'), { recursive: true });
      assert.equal(hookAdapter.detectPlatform(tmp), 'opencode');
    } finally { cleanup(tmp); }
  });
});

describe('opencode adapter: buildPluginSource', () => {
  it('embeds the absolute hooks dir path', () => {
    const src = opencodeAdapter.buildPluginSource('/some/abs/.opencode/hooks');
    assert.match(src, /\/some\/abs\/\.opencode\/hooks/);
  });

  it('includes the _evolver_managed marker on the first line', () => {
    const src = opencodeAdapter.buildPluginSource('/x');
    const firstLine = src.split('\n')[0];
    assert.match(firstLine, /_evolver_managed: true/);
  });

  it('wires session.created -> evolver-session-start.js', () => {
    const src = opencodeAdapter.buildPluginSource('/x');
    assert.match(src, /session\.created[\s\S]*evolver-session-start\.js/);
  });

  it('wires session.idle -> evolver-session-end.js', () => {
    const src = opencodeAdapter.buildPluginSource('/x');
    assert.match(src, /session\.idle[\s\S]*evolver-session-end\.js/);
  });

  it('wires tool.execute.after -> evolver-signal-detect.js with write/edit filter', () => {
    const src = opencodeAdapter.buildPluginSource('/x');
    assert.match(src, /'tool\.execute\.after'/);
    assert.match(src, /evolver-signal-detect\.js/);
    assert.match(src, /input\.tool !== 'write'/);
    assert.match(src, /input\.tool !== 'edit'/);
  });

  it('exports both named Evolver and default for opencode loader compat', () => {
    const src = opencodeAdapter.buildPluginSource('/x');
    assert.match(src, /module\.exports\s*=\s*\{\s*Evolver\s*\}/);
    assert.match(src, /module\.exports\.default\s*=\s*Evolver/);
  });

  it('produces source that parses as valid JavaScript', () => {
    const src = opencodeAdapter.buildPluginSource('/x');
    // Use Function constructor as a syntax-only check (does not execute the
    // module body since the wrapper just receives the string).
    assert.doesNotThrow(() => new Function(src));
  });
});

describe('opencode adapter: install', () => {
  it('writes plugin file, copies hook scripts, injects AGENTS.md', () => {
    const tmp = makeTmpDir();
    try {
      fs.mkdirSync(path.join(tmp, '.opencode'), { recursive: true });
      const evolverRoot = path.resolve(__dirname, '..');
      const result = opencodeAdapter.install({ configRoot: tmp, evolverRoot, force: true });
      assert.equal(result.ok, true);
      assert.equal(result.platform, 'opencode');

      const pluginPath = path.join(tmp, '.opencode', 'plugins', 'evolver.js');
      assert.ok(fs.existsSync(pluginPath), 'plugin file missing');
      const pluginSrc = fs.readFileSync(pluginPath, 'utf8');
      assert.match(pluginSrc, /_evolver_managed: true/);

      const hooksDir = path.join(tmp, '.opencode', 'hooks');
      for (const script of ['evolver-session-start.js', 'evolver-signal-detect.js', 'evolver-session-end.js']) {
        assert.ok(fs.existsSync(path.join(hooksDir, script)), `script missing: ${script}`);
      }

      // The plugin must point at this install's hooks dir absolutely.
      assert.ok(pluginSrc.includes(hooksDir), 'plugin should reference absolute hooks dir');

      const agentsMd = fs.readFileSync(path.join(tmp, 'AGENTS.md'), 'utf8');
      assert.ok(agentsMd.includes('Evolution Memory'));
      assert.ok(agentsMd.includes('evolver-evolution-memory'));
    } finally { cleanup(tmp); }
  });

  it('skips when already installed without force', () => {
    const tmp = makeTmpDir();
    try {
      fs.mkdirSync(path.join(tmp, '.opencode'), { recursive: true });
      const evolverRoot = path.resolve(__dirname, '..');
      opencodeAdapter.install({ configRoot: tmp, evolverRoot, force: true });
      const result = opencodeAdapter.install({ configRoot: tmp, evolverRoot, force: false });
      assert.equal(result.ok, true);
      assert.equal(result.skipped, true);
    } finally { cleanup(tmp); }
  });

  it('overwrites with --force', () => {
    const tmp = makeTmpDir();
    try {
      fs.mkdirSync(path.join(tmp, '.opencode'), { recursive: true });
      const evolverRoot = path.resolve(__dirname, '..');
      opencodeAdapter.install({ configRoot: tmp, evolverRoot, force: true });
      const result = opencodeAdapter.install({ configRoot: tmp, evolverRoot, force: true });
      assert.equal(result.ok, true);
      assert.notEqual(result.skipped, true);
    } finally { cleanup(tmp); }
  });
});

describe('opencode adapter: uninstall', () => {
  it('removes plugin file, hook scripts, and AGENTS.md section', () => {
    const tmp = makeTmpDir();
    try {
      fs.mkdirSync(path.join(tmp, '.opencode'), { recursive: true });
      const evolverRoot = path.resolve(__dirname, '..');
      opencodeAdapter.install({ configRoot: tmp, evolverRoot, force: true });

      const result = opencodeAdapter.uninstall({ configRoot: tmp });
      assert.equal(result.ok, true);
      assert.equal(result.removed, true);

      const pluginPath = path.join(tmp, '.opencode', 'plugins', 'evolver.js');
      assert.ok(!fs.existsSync(pluginPath), 'plugin file not removed');

      const hooksDir = path.join(tmp, '.opencode', 'hooks');
      for (const script of ['evolver-session-start.js', 'evolver-signal-detect.js', 'evolver-session-end.js']) {
        assert.ok(!fs.existsSync(path.join(hooksDir, script)), `script not removed: ${script}`);
      }

      const agentsMd = fs.readFileSync(path.join(tmp, 'AGENTS.md'), 'utf8');
      assert.ok(!agentsMd.includes('evolver-evolution-memory'));
    } finally { cleanup(tmp); }
  });

  it('does not remove user-authored plugin without _evolver_managed marker', () => {
    const tmp = makeTmpDir();
    try {
      const pluginsDir = path.join(tmp, '.opencode', 'plugins');
      fs.mkdirSync(pluginsDir, { recursive: true });
      const userPluginPath = path.join(pluginsDir, 'evolver.js');
      fs.writeFileSync(userPluginPath, '// user-authored, no managed marker\nmodule.exports = {};\n');

      // install with force=false should skip because file exists, but also
      // since marker is absent, the file is treated as user-owned. We force
      // install to overwrite, then uninstall. Uninstall must NOT touch a
      // non-managed file: re-create as user-owned and check.
      opencodeAdapter.uninstall({ configRoot: tmp });

      assert.ok(fs.existsSync(userPluginPath), 'user-authored plugin must be preserved');
      const content = fs.readFileSync(userPluginPath, 'utf8');
      assert.ok(content.includes('user-authored'));
    } finally { cleanup(tmp); }
  });

  it('returns ok with removed=false when nothing to remove', () => {
    const tmp = makeTmpDir();
    try {
      fs.mkdirSync(path.join(tmp, '.opencode'), { recursive: true });
      const result = opencodeAdapter.uninstall({ configRoot: tmp });
      assert.equal(result.ok, true);
      assert.equal(result.removed, false);
    } finally { cleanup(tmp); }
  });
});

describe('opencode adapter: isEvolverManagedPluginFile', () => {
  it('detects files with _evolver_managed marker', () => {
    const tmp = makeTmpDir();
    try {
      const p = path.join(tmp, 'evolver.js');
      fs.writeFileSync(p, '// _evolver_managed: true\nmodule.exports = {};\n');
      assert.equal(opencodeAdapter.isEvolverManagedPluginFile(p), true);
    } finally { cleanup(tmp); }
  });

  it('rejects user-authored plugins without marker', () => {
    const tmp = makeTmpDir();
    try {
      const p = path.join(tmp, 'evolver.js');
      fs.writeFileSync(p, '// my custom plugin\nmodule.exports = {};\n');
      assert.equal(opencodeAdapter.isEvolverManagedPluginFile(p), false);
    } finally { cleanup(tmp); }
  });

  it('returns false for non-existent file', () => {
    const tmp = makeTmpDir();
    try {
      assert.equal(
        opencodeAdapter.isEvolverManagedPluginFile(path.join(tmp, 'nope.js')),
        false
      );
    } finally { cleanup(tmp); }
  });
});
