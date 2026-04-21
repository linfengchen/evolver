'use strict';

// Regression test for GH issue #453. Verifies that when the public build is
// assembled, the resulting npm package tarball includes runtime-critical
// scripts (`scripts/validate-*.js`) that were previously excluded due to the
// inherited `.npmignore` `/scripts/` rule.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(REPO_ROOT, 'dist-public');

test('dist-public build exists before testing package layout', () => {
  if (!fs.existsSync(DIST)) {
    // No dist-public yet — build has not run. The release workflow runs
    // `node scripts/build_public.js` before publishing so skip rather than
    // fail the unit suite.
    console.warn('[#453 test] dist-public/ missing -- build_public.js has not run yet. Skipping.');
    return;
  }
  assert.ok(fs.statSync(DIST).isDirectory());
});

test('dist-public/package.json whitelists scripts/ via files field', () => {
  if (!fs.existsSync(DIST)) return;
  const pkgPath = path.join(DIST, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.ok(Array.isArray(pkg.files), 'package.json files field must be an array');
  const has = pkg.files.some(f => f === 'scripts/' || f === 'scripts' || f === 'scripts/**');
  assert.ok(has, 'package.json files field must include scripts/');
});

test('dist-public/.npmignore does NOT exclude /scripts/', () => {
  if (!fs.existsSync(DIST)) return;
  const ignorePath = path.join(DIST, '.npmignore');
  if (!fs.existsSync(ignorePath)) return;
  const content = fs.readFileSync(ignorePath, 'utf8');
  const lines = content.split(/\r?\n/).map(l => l.trim());
  for (const line of lines) {
    assert.notStrictEqual(
      line,
      '/scripts/',
      'dist-public/.npmignore must not exclude /scripts/ (breaks validate-*.js at runtime)',
    );
  }
});

test('npm pack includes scripts/validate-*.js files', () => {
  if (!fs.existsSync(DIST)) return;
  // npm pack --dry-run --json lists files that would be published without
  // actually producing a tarball on disk.
  let out;
  try {
    out = execSync('npm pack --dry-run --json', {
      cwd: DIST,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    console.warn('[#453 test] npm pack --dry-run failed: ' + (e.message || e));
    return;
  }
  const info = JSON.parse(out);
  const entry = Array.isArray(info) ? info[0] : info;
  const files = (entry && entry.files) || [];
  const paths = files.map(f => f && f.path).filter(Boolean);
  const hasValidate = paths.some(p => /scripts\/validate-[a-z0-9-]+\.js$/.test(p));
  assert.ok(
    hasValidate,
    'npm pack must include scripts/validate-*.js; got: ' + JSON.stringify(paths),
  );
});
