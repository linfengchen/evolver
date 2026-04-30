// test/validator.test.js
// Tests for the opt-in validator role: sandbox executor, reporter, and
// the cycle orchestrator. All tests stay in-process (no real Hub calls)
// by monkey-patching global fetch for report/stake submissions.
'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const sandbox = require('../src/gep/validator/sandboxExecutor');
const reporter = require('../src/gep/validator/reporter');
const validatorIndex = require('../src/gep/validator');

// Absolute paths to fixture scripts used as sandbox validation commands.
// Sandbox BLOCKED_NODE_FLAGS now rejects `node -e "..."` inline eval even
// from trusted callers, so every sandbox test must reach node via a real
// script file. `node` itself remains a real binary across platforms and
// works with spawn(..., { shell: false }).
const FX_DIR = path.join(__dirname, 'fixtures');
const CMD_PASS = 'node ' + path.join(FX_DIR, 'pass.js');
const CMD_FAIL = 'node ' + path.join(FX_DIR, 'fail.js');
const CMD_SLOW = 'node ' + path.join(FX_DIR, 'slow.js');
const CMD_HELLO = 'node ' + path.join(FX_DIR, 'hello.js');
const CMD_ECHO_FIRST = 'node ' + path.join(FX_DIR, 'echo-first.js');
const CMD_EXIT_2 = 'node ' + path.join(FX_DIR, 'exit-2.js');
const CMD_PRINT_CWD = 'node ' + path.join(FX_DIR, 'print-cwd.js');

function withFakeFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => { global.fetch = original; });
}

function mkRes({ status = 200, body = {}, ok = true } = {}) {
  return {
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

describe('sandboxExecutor.runInSandbox', function () {
  const isWin = process.platform === 'win32';

  it('runs a passing command inside an isolated temp dir', async function () {
    const out = await sandbox.runInSandbox([CMD_HELLO], {});
    assert.equal(out.results.length, 1);
    assert.equal(out.overallOk, true);
    assert.match(out.results[0].stdout, /hello-sandbox/);
    // cwd must not be evolver workspace; should be under /tmp (or OS tmpdir)
    const tmpRoot = require('os').tmpdir();
    assert.match(out.results[0].stdout, new RegExp(tmpRoot.replace(/\\/g, '\\\\')));
  });

  it('stops at first failure and reports overallOk=false', async function () {
    const out = await sandbox.runInSandbox([
      CMD_ECHO_FIRST,
      CMD_EXIT_2,
      CMD_HELLO,
    ], {});
    assert.equal(out.overallOk, false);
    assert.equal(out.stoppedEarly, true);
    // Only the first two commands ran.
    assert.equal(out.results.length, 2);
    assert.equal(out.results[0].ok, true);
    assert.equal(out.results[1].ok, false);
  });

  it('enforces per-command timeout (kills long-running commands)', async function () {
    const out = await sandbox.runInSandbox([CMD_SLOW], { cmdTimeoutMs: 300 });
    assert.equal(out.overallOk, false);
    assert.equal(out.results[0].timedOut, true);
  });

  it('cleans up sandbox directory after execution', async function () {
    let captured;
    const out = await sandbox.runInSandbox([CMD_PRINT_CWD], { keepSandbox: true });
    captured = out.sandboxDir;
    assert.ok(captured);
    assert.ok(fs.existsSync(captured));
    // Now call with cleanup (default).
    const out2 = await sandbox.runInSandbox([CMD_PRINT_CWD], {});
    assert.equal(out2.sandboxDir, null);
    sandbox.cleanupDir(captured);
  });

  it('returns reason=no_commands for empty array', async function () {
    const out = await sandbox.runInSandbox([], {});
    assert.equal(out.reason, 'no_commands');
    assert.equal(out.overallOk, false);
  });

  it('rejects non-allowlisted executables (v1.69.8 hardening)', async function () {
    const out = await sandbox.runInSandbox(['bash -c "echo pwn"'], {});
    assert.equal(out.overallOk, false);
    assert.equal(out.results[0].ok, false);
    assert.match(out.results[0].stderr || '', /executable_not_allowed/);
  });

  it('rejects node -e inline eval (sandbox depth-in-depth)', async function () {
    // Even if policyCheck were bypassed, the sandbox itself must refuse
    // `node -e`-style evaluators because `node` is in ALLOWED_EXECUTABLES.
    const out = await sandbox.runInSandbox([
      'node -e "require(\'child_process\').execSync(\'id\')"',
    ], {});
    assert.equal(out.overallOk, false);
    assert.equal(out.results[0].ok, false);
    // Blocked flags are caught in the parseCommand/assertNodeCommandSafe block
    // whose failures surface via the `command_parse_failed:` stderr prefix.
    assert.match(out.results[0].stderr || '', /command_parse_failed/);
    assert.match(out.results[0].stderr || '', /node flag not allowed/);
    assert.equal(out.results[0].timedOut, false);
  });

  it('rejects node without a script file (inline eval disguised as --print)', async function () {
    const out = await sandbox.runInSandbox(['node -p "1+1"'], {});
    assert.equal(out.overallOk, false);
    assert.match(out.results[0].stderr || '', /node flag not allowed/);
  });

  it('redirects HOME to os.tmpdir() inside sandbox env', function () {
    const env = sandbox.buildSandboxEnv();
    const tmpRoot = require('os').tmpdir();
    assert.equal(env.HOME, tmpRoot);
    assert.equal(env.TMPDIR, tmpRoot);
  });

  it('rejects shell metacharacters (v1.69.8 hardening)', async function () {
    const out = await sandbox.runInSandbox(['node script.js && echo pwn'], {});
    assert.equal(out.overallOk, false);
    assert.equal(out.results[0].ok, false);
    assert.match(out.results[0].stderr || '', /command_parse_failed/);
  });
});

describe('reporter.buildReportPayload', function () {
  it('produces Hub-compatible payload with task_id/nonce', function () {
    const task = { task_id: 'vt_123', nonce: 'n_abc' };
    const execution = {
      results: [
        { cmd: 'echo a', ok: true, stdout: 'a', stderr: '', exitCode: 0, durationMs: 10 },
        { cmd: 'echo b', ok: true, stdout: 'b', stderr: '', exitCode: 0, durationMs: 5 },
      ],
      overallOk: true,
      durationMs: 15,
    };
    const payload = reporter.buildReportPayload(task, execution);
    assert.equal(payload.task_id, 'vt_123');
    assert.equal(payload.nonce, 'n_abc');
    assert.equal(payload.overall_ok, true);
    assert.equal(payload.commands_total, 2);
    assert.equal(payload.commands_passed, 2);
    assert.equal(payload.reproduction_score, 1);
    assert.equal(typeof payload.execution_log_hash, 'string');
    assert.equal(payload.execution_log_hash.length, 64);
    assert.ok(payload.env_fingerprint && typeof payload.env_fingerprint === 'object');
  });

  it('hashes execution log deterministically', function () {
    const results = [
      { cmd: 'echo a', ok: true, exitCode: 0, stdout: 'a', stderr: '' },
    ];
    const h1 = reporter.hashExecutionLog(results);
    const h2 = reporter.hashExecutionLog(results);
    assert.equal(h1, h2);
    const h3 = reporter.hashExecutionLog([{ ...results[0], stdout: 'b' }]);
    assert.notEqual(h1, h3);
  });

  it('reproductionScore reflects partial passes', function () {
    const payload = reporter.buildReportPayload(
      { task_id: 't', nonce: 'n' },
      {
        results: [
          { cmd: 'a', ok: true, exitCode: 0 },
          { cmd: 'b', ok: false, exitCode: 1 },
        ],
        overallOk: false,
        durationMs: 10,
      },
    );
    assert.equal(payload.reproduction_score, 0.5);
  });
});

describe('validator.runValidatorCycle', function () {
  const originalEnv = { ...process.env };
  let tmpHome;
  beforeEach(() => {
    // Isolate stakeBootstrap disk state per test so a successful stake
    // in one test doesn't silence the stake attempt in the next.
    tmpHome = fs.mkdtempSync(path.join(require('os').tmpdir(), 'validator-cycle-'));
    process.env.EVOLVER_HOME = tmpHome;
    process.env.A2A_HUB_URL = 'http://hub.local';
    process.env.HUB_NODE_SECRET = 'secret';
    process.env.A2A_NODE_ID = 'node_test_validator';
    // Reset the module-level stake state so each test starts fresh.
    try {
      const sb = require('../src/gep/validator/stakeBootstrap');
      if (sb && typeof sb._resetStateForTests === 'function') sb._resetStateForTests();
    } catch (_) {}
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in originalEnv)) delete process.env[k];
    }
    Object.assign(process.env, originalEnv);
    if (tmpHome) {
      try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('returns skipped:"disabled" when EVOLVER_VALIDATOR_ENABLED=0', async function () {
    process.env.EVOLVER_VALIDATOR_ENABLED = '0';
    const out = await validatorIndex.runValidatorCycle({});
    assert.equal(out.skipped, 'disabled');
  });

  it('fetches, sandboxes, and reports when enabled; reports overall_ok=false on failure', async function () {
    process.env.EVOLVER_VALIDATOR_ENABLED = '1';
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      const body = init && init.body ? JSON.parse(init.body) : {};
      if (url.endsWith('/a2a/validator/stake')) {
        return mkRes({ body: { stake: { stake_amount: 100 } } });
      }
      if (url.endsWith('/a2a/fetch')) {
        return mkRes({
          body: {
            validation_tasks: [
              {
                task_id: 'vt_fail',
                nonce: 'nonce_abc',
                asset_id: 'asset_x',
                validation_commands: [
                CMD_PASS,
                CMD_FAIL,
              ],
                expires_at: new Date(Date.now() + 60000).toISOString(),
              },
            ],
          },
        });
      }
      if (url.endsWith('/a2a/report')) {
        return mkRes({ body: { status: 'accepted', payload: body.payload } });
      }
      return mkRes({ ok: false, status: 404, body: { error: 'not_found' } });
    };
    const out = await withFakeFetch(fetchImpl, () => validatorIndex.runValidatorCycle({}));
    assert.equal(out.processed, 1);
    assert.equal(out.outcomes[0].status, 'reported');
    assert.equal(out.outcomes[0].report.overall_ok, false);
    assert.equal(out.outcomes[0].report.commands_total, 2);
    assert.equal(out.outcomes[0].report.commands_passed, 1);
    // Ensure stake was attempted once.
    const stakeCalls = calls.filter((c) => c.url.endsWith('/a2a/validator/stake'));
    assert.equal(stakeCalls.length, 1);
    // Regression: validator fetch MUST send tasks_only so Hub skips asset
    // search + GDI credit deduction. Pre-2026-04-30 this sent only
    // validation_only (ignored by Hub), burning ~96 credits per poll cycle.
    const fetchCalls = calls.filter((c) => c.url.endsWith('/a2a/fetch'));
    assert.equal(fetchCalls.length, 1);
    const fetchBody = JSON.parse(fetchCalls[0].init.body);
    assert.equal(fetchBody.payload.tasks_only, true, 'validator fetch MUST include tasks_only:true');
  });

  it('reports passing result when all commands succeed', async function () {
    process.env.EVOLVER_VALIDATOR_ENABLED = '1';
    const fetchImpl = async (url, init) => {
      const body = init && init.body ? JSON.parse(init.body) : {};
      if (url.endsWith('/a2a/validator/stake')) {
        return mkRes({ body: { stake: { stake_amount: 100 } } });
      }
      if (url.endsWith('/a2a/fetch')) {
        return mkRes({
          body: {
            validation_tasks: [
              {
                task_id: 'vt_ok',
                nonce: 'nonce_xyz',
                validation_commands: [
                CMD_PASS,
                CMD_PASS,
              ],
              },
            ],
          },
        });
      }
      if (url.endsWith('/a2a/report')) {
        return mkRes({ body: { status: 'accepted', payload: body.payload } });
      }
      return mkRes({ ok: false, status: 404, body: {} });
    };
    const out = await withFakeFetch(fetchImpl, () => validatorIndex.runValidatorCycle({}));
    assert.equal(out.outcomes[0].report.overall_ok, true);
    assert.equal(out.outcomes[0].report.commands_passed, 2);
  });

  it('gracefully handles empty validation_tasks list', async function () {
    process.env.EVOLVER_VALIDATOR_ENABLED = '1';
    const fetchImpl = async (url) => {
      if (url.endsWith('/a2a/validator/stake')) return mkRes({ body: {} });
      if (url.endsWith('/a2a/fetch')) return mkRes({ body: { validation_tasks: [] } });
      return mkRes({ ok: false });
    };
    const out = await withFakeFetch(fetchImpl, () => validatorIndex.runValidatorCycle({}));
    assert.equal(out.tasks, 0);
    assert.equal(out.processed, 0);
  });
});
