'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('fetch command hardening (GHSA-r466-rxw4-3j9j)', () => {
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

  it('validates --out= path stays inside cwd', () => {
    // The fix wraps the raw --out= value with path.resolve + path.relative and
    // rejects paths that escape the cwd. Guard against regressions that go
    // back to the raw outFlag.slice() pattern without a cwd check.
    assert.ok(/outFlag\.slice\('--out='\.length\)/.test(indexSrc),
      'fetch still parses --out= flag');
    assert.ok(/path\.resolve\(process\.cwd\(\),\s*rawOut\)/.test(indexSrc),
      'fetch must resolve --out= against process.cwd()');
    assert.ok(/rel\.startsWith\('\.\.'\)/.test(indexSrc) || /startsWith\('\.\.'\)/.test(indexSrc),
      'fetch must reject paths escaping cwd via path.relative check');
  });

  it('does not allow the raw --out= value to flow directly into mkdirSync', () => {
    // Source-level check: `fs.mkdirSync(outDir, ...)` in the fetch branch must
    // be preceded by the path.resolve+path.relative containment guard we
    // introduced for GHSA-r466-rxw4-3j9j. We scope the check to the block
    // immediately after the --out= slice so other unrelated outDir vars in
    // index.js do not trigger false positives.
    const sliceIdx = indexSrc.indexOf("outFlag.slice('--out='.length)");
    assert.ok(sliceIdx !== -1, 'fetch still parses --out= flag');
    const window = indexSrc.slice(sliceIdx, sliceIdx + 2000);
    assert.ok(/path\.resolve\(process\.cwd\(\),\s*rawOut\)/.test(window),
      'the --out= slice result must feed into path.resolve(process.cwd(), rawOut) before mkdirSync');
    assert.ok(/rel\.startsWith\('\.\.'\)/.test(window),
      'the --out= branch must reject paths that escape cwd via path.relative check');
  });
});
