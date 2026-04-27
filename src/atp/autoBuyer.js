// ATP Auto-Buyer (opt-out, default ON as of ATP liquidity unlock)
// Converts capability gaps into ATP orders with strict budget caps and
// 24h question-level deduplication. Disable by setting
// EVOLVER_ATP_AUTOBUY=off. Budget caps:
//   ATP_AUTOBUY_DAILY_CAP_CREDITS     (default 50)
//   ATP_AUTOBUY_PER_ORDER_CAP_CREDITS (default 10)
// Cold-start safety: the first 5 minutes after process start use a half-cap
// to protect against misconfiguration loops on restart storms.
//
// Integration contract:
//   1) Call start({ dailyCap, perOrderCap }) once at Evolver boot. The
//      evolve loop does this at the top of every cycle; start() is
//      idempotent so the repeated call is a no-op.
//   2) Call considerOrder({ signals, question, capabilities, budget, ... })
//      from the evolve loop whenever a capability gap is detected.
//   3) Result shape: { ok, skipped?, reason?, data?, error? }.
//
// Failure modes are non-fatal; every external call is wrapped with a 3s
// timeout race so loop cadence is never blocked by network issues.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { getMemoryDir } = require('../gep/paths');
const hubClient = require('./hubClient');

const DEFAULT_DAILY_CAP = 50;
const DEFAULT_PER_ORDER_CAP = 10;
const DEFAULT_ORDER_TIMEOUT_MS = 3000;
const COLD_START_WINDOW_MS = 5 * 60 * 1000;
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;
const LEDGER_FILENAME = 'atp-autobuyer-ledger.json';

let _started = false;
let _startedAt = 0;
let _config = {
  dailyCap: DEFAULT_DAILY_CAP,
  perOrderCap: DEFAULT_PER_ORDER_CAP,
  timeoutMs: DEFAULT_ORDER_TIMEOUT_MS,
};

function _ledgerPath() {
  return path.join(getMemoryDir(), LEDGER_FILENAME);
}

function _todayKey(now) {
  const d = new Date(typeof now === 'number' ? now : Date.now());
  return d.toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

function _isEnabled() {
  // Default ON: the evolve loop starts autoBuyer at the top of every cycle
  // so new users get ATP buyer routing out of the box. Disable by setting
  // EVOLVER_ATP_AUTOBUY=off. Budget caps (DAILY_CAP + PER_ORDER_CAP) keep
  // the downside bounded even when this is on.
  const raw = (process.env.EVOLVER_ATP_AUTOBUY || 'on').toLowerCase().trim();
  return raw !== 'off' && raw !== '0' && raw !== 'false';
}

function _emptyLedger() {
  return { version: 1, dayKey: _todayKey(), spent: 0, dedup: {} };
}

function _readLedger() {
  try {
    const p = _ledgerPath();
    if (!fs.existsSync(p)) return _emptyLedger();
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return _emptyLedger();
    if (!parsed.dayKey || !parsed.dedup) return _emptyLedger();
    return parsed;
  } catch (_) {
    return _emptyLedger();
  }
}

function _writeLedger(ledger) {
  try {
    const dir = getMemoryDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = _ledgerPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
    fs.renameSync(tmp, _ledgerPath());
  } catch (_) {
    // Non-fatal: ledger persistence failure means next process restart
    // re-reads previous ledger (so existing caps still apply).
  }
}

function _rotateIfNewDay(ledger, now) {
  const today = _todayKey(now);
  if (ledger.dayKey !== today) {
    return { version: 1, dayKey: today, spent: 0, dedup: ledger.dedup || {} };
  }
  return ledger;
}

function _pruneDedup(ledger, now) {
  const cutoff = (typeof now === 'number' ? now : Date.now()) - DEDUP_TTL_MS;
  const out = {};
  const src = ledger.dedup || {};
  const keys = Object.keys(src);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (typeof src[k] === 'number' && src[k] >= cutoff) out[k] = src[k];
  }
  ledger.dedup = out;
  return ledger;
}

function _questionHash(opts) {
  const caps = Array.isArray(opts.capabilities) ? opts.capabilities.slice().sort().join(',') : '';
  const q = (opts.question || '').slice(0, 2000);
  return crypto.createHash('sha256').update(caps + '|' + q).digest('hex').slice(0, 24);
}

function _effectiveCap(value, now) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  const within = _startedAt > 0 && (now - _startedAt) < COLD_START_WINDOW_MS;
  return within ? Math.floor(n / 2) : Math.floor(n);
}

function start(opts) {
  if (_started) return;
  if (!_isEnabled()) return;
  _started = true;
  _startedAt = Date.now();
  const dailyCap = Math.max(0, Math.floor(Number((opts && opts.dailyCap) || process.env.ATP_AUTOBUY_DAILY_CAP_CREDITS) || DEFAULT_DAILY_CAP));
  const perOrderCap = Math.max(0, Math.floor(Number((opts && opts.perOrderCap) || process.env.ATP_AUTOBUY_PER_ORDER_CAP_CREDITS) || DEFAULT_PER_ORDER_CAP));
  const timeoutMs = Math.max(500, Math.floor(Number((opts && opts.timeoutMs) || DEFAULT_ORDER_TIMEOUT_MS)));
  _config = { dailyCap, perOrderCap, timeoutMs };
  let ledger = _readLedger();
  ledger = _rotateIfNewDay(ledger, _startedAt);
  ledger = _pruneDedup(ledger, _startedAt);
  _writeLedger(ledger);
  console.log('[ATP-AutoBuyer] Started (dailyCap=' + dailyCap + ', perOrderCap=' + perOrderCap + ', cold-start half-cap for ' + (COLD_START_WINDOW_MS / 1000) + 's)');
}

function stop() {
  _started = false;
  _startedAt = 0;
}

function isStarted() {
  return _started;
}

function _withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise(function (resolve) {
      setTimeout(function () { resolve({ ok: false, error: 'autobuyer_timeout' }); }, timeoutMs);
    }),
  ]);
}

async function considerOrder(opts) {
  if (!_started) return { ok: false, skipped: true, reason: 'not_started' };
  if (!opts || !Array.isArray(opts.capabilities) || opts.capabilities.length === 0) {
    return { ok: false, skipped: true, reason: 'no_capabilities' };
  }
  const now = Date.now();
  let ledger = _readLedger();
  ledger = _rotateIfNewDay(ledger, now);
  ledger = _pruneDedup(ledger, now);

  const hash = _questionHash(opts);
  if (ledger.dedup[hash]) {
    return { ok: false, skipped: true, reason: 'dedup_hit', hash: hash };
  }

  const dailyCap = _effectiveCap(_config.dailyCap, now);
  const perOrderCap = _effectiveCap(_config.perOrderCap, now);
  const remaining = Math.max(0, dailyCap - (ledger.spent || 0));
  if (remaining <= 0) {
    console.warn('[ATP-AutoBuyer] Daily cap reached, skipping order (spent=' + ledger.spent + ', cap=' + dailyCap + ')');
    return { ok: false, skipped: true, reason: 'daily_cap_reached', spent: ledger.spent, cap: dailyCap };
  }

  const requested = Math.max(1, Math.floor(Number(opts.budget) || perOrderCap));
  const budget = Math.min(requested, perOrderCap, remaining);
  if (budget <= 0) {
    return { ok: false, skipped: true, reason: 'budget_clamped_to_zero' };
  }

  const orderOpts = {
    capabilities: opts.capabilities,
    budget: budget,
    routingMode: opts.routingMode || 'fastest',
    verifyMode: opts.verifyMode || 'auto',
    question: opts.question,
    signals: opts.signals,
    minReputation: opts.minReputation,
  };

  const result = await _withTimeout(hubClient.placeOrder(orderOpts), _config.timeoutMs);

  if (result && result.ok) {
    ledger.spent = (ledger.spent || 0) + budget;
    ledger.dedup[hash] = now;
    _writeLedger(ledger);
    console.log('[ATP-AutoBuyer] Order placed: ' + (result.data && result.data.order_id) + ' budget=' + budget + ' remaining_today=' + Math.max(0, dailyCap - ledger.spent));
    return { ok: true, data: result.data, spent: budget };
  }

  // On failure still record dedup so we don't hammer the hub for the same
  // capability gap within the TTL window (but do NOT charge the spend).
  ledger.dedup[hash] = now;
  _writeLedger(ledger);
  return { ok: false, error: (result && result.error) || 'unknown_error' };
}

// Test-only reset, not exported by default.
function _resetForTests() {
  _started = false;
  _startedAt = 0;
  _config = {
    dailyCap: DEFAULT_DAILY_CAP,
    perOrderCap: DEFAULT_PER_ORDER_CAP,
    timeoutMs: DEFAULT_ORDER_TIMEOUT_MS,
  };
}

module.exports = {
  start,
  stop,
  isStarted,
  considerOrder,
  // Exposed for tests and diagnostics only; callers should not depend on
  // these internals in production code paths.
  __internals: {
    readLedger: _readLedger,
    writeLedger: _writeLedger,
    questionHash: _questionHash,
    effectiveCap: _effectiveCap,
    resetForTests: _resetForTests,
    constants: {
      DEFAULT_DAILY_CAP,
      DEFAULT_PER_ORDER_CAP,
      COLD_START_WINDOW_MS,
      DEDUP_TTL_MS,
      LEDGER_FILENAME,
    },
  },
};
