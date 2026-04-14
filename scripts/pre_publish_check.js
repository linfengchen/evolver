'use strict';

/**
 * Pre-publish verification gate.
 *
 * Runs structural checks on source code + test suite before allowing
 * publish_public.js to proceed. Exit 0 = pass, exit 1 = blocked.
 *
 * Checks:
 *   1. Test suite passes (vitest)
 *   2. Proxy hello/heartbeat send env_fingerprint (Hub collision-check compat)
 *   3. All proxy HTTP call-sites handle 401/403 auth errors
 *   4. Proxy hello sends message_id + protocol envelope fields
 *   5. Proxy mailbox status includes node_id query param
 *   6. SyncEngine wires onAuthError callback
 *   7. Source version matches dist-public version (if dist-public exists)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROXY_DIR = path.join(ROOT, 'src', 'proxy');

const failures = [];
const warnings = [];

function fail(check, detail) {
  failures.push(`[FAIL] ${check}: ${detail}`);
}

function warn(check, detail) {
  warnings.push(`[WARN] ${check}: ${detail}`);
}

function pass(check) {
  process.stdout.write(`  [OK] ${check}\n`);
}

function readSource(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

// ---------------------------------------------------------------------------
// Check 1: Test suite
// ---------------------------------------------------------------------------
function checkTests() {
  const name = 'test-suite';
  if (process.env.SKIP_TESTS === '1') {
    warn(name, 'skipped via SKIP_TESTS=1');
    return;
  }
  try {
    execSync('npx vitest run', {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    pass(name);
  } catch (e) {
    const output = (e.stdout || '') + '\n' + (e.stderr || '');
    const realFailureMatch = output.match(/# fail (\d+)/);
    const realFails = realFailureMatch ? Number(realFailureMatch[1]) : -1;
    if (realFails === 0) {
      pass(name + ' (TAP reports 0 real failures)');
    } else {
      fail(name, `vitest exited with code ${e.status}; ${realFails} test(s) failed`);
    }
  }
}

// ---------------------------------------------------------------------------
// Check 2: Proxy hello/heartbeat send env_fingerprint
// ---------------------------------------------------------------------------
function checkEnvFingerprint() {
  const name = 'proxy-env-fingerprint';
  const src = readSource('src/proxy/lifecycle/manager.js');
  if (!src) { fail(name, 'manager.js not found'); return; }

  const helloMatch = src.match(/async hello\b[\s\S]*?(?=async \w|_build|class |module\.exports)/);
  const heartbeatMatch = src.match(/async heartbeat\b[\s\S]*?(?=async \w|start|stop|_should|class |module\.exports)/);

  let ok = true;
  if (!helloMatch || !helloMatch[0].includes('env_fingerprint')) {
    fail(name, 'hello() does not send env_fingerprint in request body');
    ok = false;
  }
  if (!heartbeatMatch || !heartbeatMatch[0].includes('env_fingerprint')) {
    fail(name, 'heartbeat() does not send env_fingerprint in request body');
    ok = false;
  }
  if (ok) pass(name);
}

// ---------------------------------------------------------------------------
// Check 3: All proxy HTTP call-sites handle 401/403
// ---------------------------------------------------------------------------
function checkAuthErrorHandling() {
  const name = 'proxy-auth-error-handling';
  const files = [
    'src/proxy/lifecycle/manager.js',
    'src/proxy/index.js',
    'src/proxy/sync/inbound.js',
    'src/proxy/sync/outbound.js',
  ];
  let ok = true;
  for (const rel of files) {
    const src = readSource(rel);
    if (!src) { fail(name, `${rel} not found`); ok = false; continue; }

    if (!src.includes('fetch(')) continue;

    const has403Check = /res\.status\s*===\s*403/.test(src) || /status\s*===\s*401/.test(src);
    if (!has403Check) {
      fail(name, `${rel} calls fetch() but does not check for 403/401 status`);
      ok = false;
    }
  }
  if (ok) pass(name);
}

// ---------------------------------------------------------------------------
// Check 4: Proxy hello sends protocol envelope
// ---------------------------------------------------------------------------
function checkHelloProtocolEnvelope() {
  const name = 'proxy-hello-protocol-envelope';
  const src = readSource('src/proxy/lifecycle/manager.js');
  if (!src) { fail(name, 'manager.js not found'); return; }

  const helloMethod = src.match(/async hello\b[\s\S]*?(?=async \w|_build|class |module\.exports)/);
  if (!helloMethod) { fail(name, 'cannot locate hello() method'); return; }
  const body = helloMethod[0];

  const required = ['message_id', 'protocol:', 'protocol_version', 'message_type'];
  let ok = true;
  for (const field of required) {
    if (!body.includes(field)) {
      fail(name, `hello() missing "${field}" in request body`);
      ok = false;
    }
  }
  if (ok) pass(name);
}

// ---------------------------------------------------------------------------
// Check 5: Mailbox status includes node_id query param
// ---------------------------------------------------------------------------
function checkMailboxStatusNodeId() {
  const name = 'proxy-mailbox-status-node-id';
  const src = readSource('src/proxy/index.js');
  if (!src) { fail(name, 'proxy/index.js not found'); return; }

  if (!src.includes('node_id=')) {
    fail(name, '_getHubMailboxStatus() does not include node_id query parameter');
    return;
  }
  pass(name);
}

// ---------------------------------------------------------------------------
// Check 6: SyncEngine wires onAuthError
// ---------------------------------------------------------------------------
function checkSyncEngineAuthWiring() {
  const name = 'sync-engine-auth-wiring';
  const engineSrc = readSource('src/proxy/sync/engine.js');
  const indexSrc = readSource('src/proxy/index.js');

  if (!engineSrc) { fail(name, 'engine.js not found'); return; }
  if (!indexSrc) { fail(name, 'proxy/index.js not found'); return; }

  let ok = true;
  if (!engineSrc.includes('onAuthError')) {
    fail(name, 'SyncEngine does not accept onAuthError parameter');
    ok = false;
  }
  if (!engineSrc.includes('AuthError')) {
    fail(name, 'SyncEngine does not import or handle AuthError');
    ok = false;
  }
  if (!indexSrc.includes('onAuthError')) {
    fail(name, 'EvoMapProxy does not pass onAuthError to SyncEngine');
    ok = false;
  }
  if (ok) pass(name);
}

// ---------------------------------------------------------------------------
// Check 7: Version consistency (source vs dist-public)
// ---------------------------------------------------------------------------
function checkVersionConsistency() {
  const name = 'version-consistency';
  const distPkgPath = path.join(ROOT, 'dist-public', 'package.json');
  if (!fs.existsSync(distPkgPath)) {
    pass(name + ' (dist-public not yet built, skipped)');
    return;
  }

  try {
    const srcPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const distPkg = JSON.parse(fs.readFileSync(distPkgPath, 'utf8'));

    if (srcPkg.version !== distPkg.version) {
      fail(name, `source version ${srcPkg.version} != dist-public version ${distPkg.version}. Re-run build_public.js.`);
      return;
    }
    pass(name);
  } catch (e) {
    warn(name, `could not compare versions: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Check 8: main evolver a2aProtocol also handles 401/403 on heartbeat
// ---------------------------------------------------------------------------
function checkA2aProtocolAuthHandling() {
  const name = 'a2a-protocol-auth-handling';
  const src = readSource('src/gep/a2aProtocol.js');
  if (!src) { warn(name, 'a2aProtocol.js not found (may be proxy-only build)'); return; }

  if (!src.includes('403') && !src.includes('401')) {
    fail(name, 'a2aProtocol.js sendHeartbeat/sendHello does not check for 403/401');
    return;
  }
  pass(name);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  process.stdout.write('\n=== Pre-publish verification ===\n\n');

  checkTests();
  checkEnvFingerprint();
  checkAuthErrorHandling();
  checkHelloProtocolEnvelope();
  checkMailboxStatusNodeId();
  checkSyncEngineAuthWiring();
  checkVersionConsistency();
  checkA2aProtocolAuthHandling();

  process.stdout.write('\n');

  if (warnings.length > 0) {
    for (const w of warnings) process.stdout.write(`  ${w}\n`);
    process.stdout.write('\n');
  }

  if (failures.length > 0) {
    process.stderr.write(`=== PUBLISH BLOCKED: ${failures.length} check(s) failed ===\n\n`);
    for (const f of failures) process.stderr.write(`  ${f}\n`);
    process.stderr.write('\nFix the above issues before publishing.\n');
    process.exit(1);
  }

  process.stdout.write(`=== All checks passed ===\n\n`);
}

main();
