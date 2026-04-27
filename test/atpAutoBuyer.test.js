const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const savedEnv = {};
const envKeys = [
  'EVOLVER_ATP_AUTOBUY',
  'ATP_AUTOBUY_DAILY_CAP_CREDITS',
  'ATP_AUTOBUY_PER_ORDER_CAP_CREDITS',
  'MEMORY_DIR',
];

let tmpMemoryDir;
let autoBuyer;
let hubClient;
let origPlaceOrder;

function makeTmpMemoryDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'atp-autobuy-'));
  return d;
}

beforeEach(() => {
  for (const k of envKeys) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  tmpMemoryDir = makeTmpMemoryDir();
  process.env.MEMORY_DIR = tmpMemoryDir;

  // Fresh module instances: purge require cache for the modules under test
  // so every test sees a clean autoBuyer/hubClient pair.
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/src/atp/') || key.includes('/src/gep/paths')) {
      delete require.cache[key];
    }
  }
  autoBuyer = require('../src/atp/autoBuyer');
  hubClient = require('../src/atp/hubClient');
  origPlaceOrder = hubClient.placeOrder;
  autoBuyer.__internals.resetForTests();
});

afterEach(() => {
  if (origPlaceOrder) hubClient.placeOrder = origPlaceOrder;
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  try { fs.rmSync(tmpMemoryDir, { recursive: true, force: true }); } catch (_) {}
});

describe('autoBuyer.start gating', () => {
  it('starts when EVOLVER_ATP_AUTOBUY is unset (default on)', () => {
    autoBuyer.start({ dailyCap: 50, perOrderCap: 10 });
    assert.equal(autoBuyer.isStarted(), true);
  });

  it('does not start when EVOLVER_ATP_AUTOBUY=off', () => {
    process.env.EVOLVER_ATP_AUTOBUY = 'off';
    autoBuyer.start({ dailyCap: 50, perOrderCap: 10 });
    assert.equal(autoBuyer.isStarted(), false);
  });

  it('starts when EVOLVER_ATP_AUTOBUY=on', () => {
    process.env.EVOLVER_ATP_AUTOBUY = 'on';
    autoBuyer.start({ dailyCap: 50, perOrderCap: 10 });
    assert.equal(autoBuyer.isStarted(), true);
  });

  it('start is idempotent', () => {
    process.env.EVOLVER_ATP_AUTOBUY = 'on';
    autoBuyer.start({ dailyCap: 50, perOrderCap: 10 });
    autoBuyer.start({ dailyCap: 999, perOrderCap: 999 });
    assert.equal(autoBuyer.isStarted(), true);
  });
});

describe('autoBuyer.considerOrder: guards and budget caps', () => {
  it('skips when not started', async () => {
    const r = await autoBuyer.considerOrder({ capabilities: ['x'], question: 'q' });
    assert.equal(r.ok, false);
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'not_started');
  });

  it('skips when no capabilities', async () => {
    process.env.EVOLVER_ATP_AUTOBUY = 'on';
    autoBuyer.start({ dailyCap: 50, perOrderCap: 10 });
    const r = await autoBuyer.considerOrder({ capabilities: [], question: 'q' });
    assert.equal(r.ok, false);
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'no_capabilities');
  });

  it('clamps budget to perOrderCap and daily remaining', async () => {
    process.env.EVOLVER_ATP_AUTOBUY = 'on';
    // Use large caps so cold-start half-cap still leaves headroom > 1 credit.
    autoBuyer.start({ dailyCap: 1000, perOrderCap: 20 });
    const seen = [];
    hubClient.placeOrder = async (opts) => {
      seen.push(opts);
      return { ok: true, data: { order_id: 'ord_test_1' } };
    };
    const r = await autoBuyer.considerOrder({
      capabilities: ['code_review'],
      question: 'please review',
      budget: 500,
    });
    assert.equal(r.ok, true);
    assert.equal(seen.length, 1);
    // Requested 500 but perOrderCap=20 (half during cold start => 10).
    assert.ok(seen[0].budget <= 10, 'budget should be clamped to cold-start perOrderCap (10), got ' + seen[0].budget);
    assert.ok(seen[0].budget >= 1);
  });

  it('respects daily cap across multiple calls', async () => {
    process.env.EVOLVER_ATP_AUTOBUY = 'on';
    // dailyCap cold-start half = 5, perOrderCap half = 5. Two orders of 5 will hit cap.
    autoBuyer.start({ dailyCap: 10, perOrderCap: 10 });
    hubClient.placeOrder = async () => ({ ok: true, data: { order_id: 'x' } });
    const r1 = await autoBuyer.considerOrder({ capabilities: ['c1'], question: 'q1', budget: 100 });
    const r2 = await autoBuyer.considerOrder({ capabilities: ['c2'], question: 'q2', budget: 100 });
    const r3 = await autoBuyer.considerOrder({ capabilities: ['c3'], question: 'q3', budget: 100 });
    assert.equal(r1.ok, true);
    // Either r2 hits cap or r3 does -- spend must not exceed dailyCap (half=5 cold start).
    const spent = [r1, r2, r3].filter(r => r.ok).reduce((a, r) => a + (r.spent || 0), 0);
    assert.ok(spent <= 5, 'spent ' + spent + ' must not exceed cold-start dailyCap (5)');
    const lastHitCap = [r1, r2, r3].some(r => r.reason === 'daily_cap_reached');
    assert.ok(lastHitCap, 'at least one call must be rejected with daily_cap_reached');
  });
});

describe('autoBuyer.considerOrder: 24h deduplication', () => {
  it('skips the second call for the same question within TTL', async () => {
    process.env.EVOLVER_ATP_AUTOBUY = 'on';
    autoBuyer.start({ dailyCap: 100, perOrderCap: 20 });
    hubClient.placeOrder = async () => ({ ok: true, data: { order_id: 'dedup_ord' } });
    const r1 = await autoBuyer.considerOrder({
      capabilities: ['code_review'],
      question: 'exact same question text',
    });
    const r2 = await autoBuyer.considerOrder({
      capabilities: ['code_review'],
      question: 'exact same question text',
    });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, false);
    assert.equal(r2.skipped, true);
    assert.equal(r2.reason, 'dedup_hit');
  });

  it('dedups even when the first placeOrder fails, to protect hub', async () => {
    process.env.EVOLVER_ATP_AUTOBUY = 'on';
    autoBuyer.start({ dailyCap: 100, perOrderCap: 20 });
    let called = 0;
    hubClient.placeOrder = async () => {
      called += 1;
      return { ok: false, error: 'simulated_network_error' };
    };
    const r1 = await autoBuyer.considerOrder({ capabilities: ['c'], question: 'boom' });
    const r2 = await autoBuyer.considerOrder({ capabilities: ['c'], question: 'boom' });
    assert.equal(r1.ok, false);
    assert.equal(r2.skipped, true);
    assert.equal(r2.reason, 'dedup_hit');
    assert.equal(called, 1, 'only first failure should reach hub');
  });
});

describe('autoBuyer: ledger persistence', () => {
  it('persists spend to ledger file and reloads on restart', async () => {
    process.env.EVOLVER_ATP_AUTOBUY = 'on';
    autoBuyer.start({ dailyCap: 100, perOrderCap: 20 });
    hubClient.placeOrder = async () => ({ ok: true, data: { order_id: 'persist_test' } });
    await autoBuyer.considerOrder({ capabilities: ['x'], question: 'persist q' });

    const ledgerPath = path.join(tmpMemoryDir, 'atp-autobuyer-ledger.json');
    assert.ok(fs.existsSync(ledgerPath), 'ledger file should exist');
    const parsed = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    assert.equal(parsed.version, 1);
    assert.ok(parsed.spent > 0, 'spent should be recorded');
    assert.ok(Object.keys(parsed.dedup).length === 1, 'dedup should have exactly one entry');
  });
});

describe('autoBuyer: timeout protection', () => {
  it('resolves with error when hub placeOrder hangs past timeoutMs (min 500ms clamp)', async () => {
    process.env.EVOLVER_ATP_AUTOBUY = 'on';
    // Note: start() clamps timeoutMs to >=500ms; we pass 50 but effective is 500.
    autoBuyer.start({ dailyCap: 100, perOrderCap: 20, timeoutMs: 50 });
    hubClient.placeOrder = () => new Promise(() => {}); // never resolves
    const t0 = Date.now();
    const r = await autoBuyer.considerOrder({ capabilities: ['c'], question: 'slow hub' });
    const elapsed = Date.now() - t0;
    assert.equal(r.ok, false);
    assert.equal(r.error, 'autobuyer_timeout');
    // Effective timeout is 500ms; allow generous ceiling for CI jitter.
    assert.ok(elapsed < 1500, 'should time out within ~500ms clamp, elapsed=' + elapsed);
    assert.ok(elapsed >= 400, 'should not short-circuit before clamp, elapsed=' + elapsed);
  });
});

describe('autoBuyer.__internals.questionHash', () => {
  it('is stable regardless of capability array order', () => {
    const h1 = autoBuyer.__internals.questionHash({ capabilities: ['a', 'b'], question: 'same' });
    const h2 = autoBuyer.__internals.questionHash({ capabilities: ['b', 'a'], question: 'same' });
    assert.equal(h1, h2);
  });

  it('differs for different questions', () => {
    const h1 = autoBuyer.__internals.questionHash({ capabilities: ['a'], question: 'q1' });
    const h2 = autoBuyer.__internals.questionHash({ capabilities: ['a'], question: 'q2' });
    assert.notEqual(h1, h2);
  });
});
