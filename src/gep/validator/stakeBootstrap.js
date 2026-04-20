// src/gep/validator/stakeBootstrap.js
//
// Ensures this node has an active validator stake on the Hub before it
// starts consuming validation tasks. Idempotent: repeated calls will not
// create duplicate stakes; the Hub returns the existing active stake.
//
// Retry policy (v1.69.4+):
//   - First attempt runs immediately
//   - Successful attempt: next retry only after 24h (periodic re-check)
//   - Transient failure (network, 5xx): exponential backoff 5min -> 15min ->
//     60min -> 4h (capped)
//   - Insufficient credits (402): longer backoff 60min -> 4h (cap) because
//     credits need to accrue from validation/task rewards; we log the gap so
//     the user can also top up or claim the node manually
//   - Stake-amount-min (400) / invalid request: stop retrying this session
'use strict';

const crypto = require('crypto');
const { buildHubHeaders, getHubUrl, getNodeId } = require('../a2aProtocol');

const DEFAULT_STAKE_AMOUNT = Number(process.env.EVOLVER_VALIDATOR_STAKE_AMOUNT) || 100;
const STAKE_TIMEOUT_MS = Number(process.env.EVOLVER_VALIDATOR_STAKE_TIMEOUT_MS) || 10_000;
const HUB_URL_FALLBACK = process.env.A2A_HUB_URL || process.env.EVOMAP_HUB_URL || 'https://evomap.ai';

const BACKOFF_STEPS_TRANSIENT_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  4 * 60 * 60 * 1000,
];
const BACKOFF_STEPS_FUNDS_MS = [
  60 * 60 * 1000,
  4 * 60 * 60 * 1000,
];
const SUCCESS_RECHECK_MS = 24 * 60 * 60 * 1000;

function resolveHubUrl() {
  try {
    const u = getHubUrl && getHubUrl();
    if (u && typeof u === 'string') return u;
  } catch (_) {}
  return HUB_URL_FALLBACK;
}

function logStakeEvent(event, data) {
  try {
    const line = Object.assign({ evt: 'validator_stake', phase: event, ts: new Date().toISOString() }, data || {});
    console.log('[evomap-validator-stake] ' + JSON.stringify(line));
  } catch (_) {
    // best-effort
  }
  try {
    const sync = require('../../sync-engine');
    if (sync && typeof sync.log === 'function') {
      sync.log('validator_stake_' + event, data || {});
    }
  } catch (_) {
    // sync-engine is optional in some test/CLI contexts
  }
}

// Retry state machine: remembers last outcome classification so we can pick
// the right backoff bucket.
let _state = {
  nextAttemptAt: 0,
  transientFailures: 0,
  fundsFailures: 0,
  lastSuccessAt: 0,
  disabledUntilRestart: false,
};

function resetBackoff() {
  _state.transientFailures = 0;
  _state.fundsFailures = 0;
}

function pickDelay(kind) {
  if (kind === 'transient') {
    const idx = Math.min(
      Math.max(0, _state.transientFailures - 1),
      BACKOFF_STEPS_TRANSIENT_MS.length - 1,
    );
    return BACKOFF_STEPS_TRANSIENT_MS[idx];
  }
  if (kind === 'funds') {
    const idx = Math.min(
      Math.max(0, _state.fundsFailures - 1),
      BACKOFF_STEPS_FUNDS_MS.length - 1,
    );
    return BACKOFF_STEPS_FUNDS_MS[idx];
  }
  return 5 * 60 * 1000;
}

function classifyFailure(status, errorText) {
  const text = String(errorText || '').toLowerCase();
  if (status === 402 || text.includes('insufficient_credits')) return 'funds';
  if (status === 400 || status === 403 || status === 404) return 'permanent';
  return 'transient';
}

function parseShortfall(errorText) {
  const match = String(errorText || '').match(/need\s+(\d+(?:\.\d+)?),\s*have\s+(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  return { need: Number(match[1]), have: Number(match[2]) };
}

/**
 * Attempt to stake credits so this node becomes eligible for validation tasks.
 * Safe to call repeatedly; internally throttled by the retry state machine.
 *
 * @param {{ amount?: number, force?: boolean }} [opts]
 */
async function ensureValidatorStake(opts) {
  const options = opts || {};
  const now = Date.now();

  if (_state.disabledUntilRestart && !options.force) {
    return { ok: false, skipped: 'disabled_until_restart' };
  }

  if (!options.force && _state.nextAttemptAt > now) {
    return { ok: true, skipped: 'backoff', nextAttemptAt: _state.nextAttemptAt };
  }

  const nodeId = getNodeId();
  if (!nodeId) {
    _state.nextAttemptAt = now + pickDelay('transient');
    return { ok: false, error: 'no_node_id' };
  }

  const hubUrl = resolveHubUrl();
  const url = hubUrl.replace(/\/+$/, '') + '/a2a/validator/stake';
  const amount = Math.max(100, Math.round(Number(options.amount) || DEFAULT_STAKE_AMOUNT));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STAKE_TIMEOUT_MS);

  const body = {
    sender_id: nodeId,
    node_id: nodeId,
    payload: { stake_amount: amount },
    message_id: 'msg_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex'),
    timestamp: new Date().toISOString(),
  };

  logStakeEvent('attempt', { node_id: nodeId, amount, hub: hubUrl });

  let res;
  let text = '';
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildHubHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    text = await res.text();
  } catch (err) {
    clearTimeout(timer);
    _state.transientFailures += 1;
    _state.nextAttemptAt = now + pickDelay('transient');
    const msg = err && err.message ? err.message : String(err);
    logStakeEvent('failed_network', {
      node_id: nodeId,
      error: msg,
      next_retry_in_ms: _state.nextAttemptAt - now,
      attempt: _state.transientFailures,
    });
    return { ok: false, error: msg };
  }

  if (res.ok) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    resetBackoff();
    _state.lastSuccessAt = now;
    _state.nextAttemptAt = now + SUCCESS_RECHECK_MS;
    logStakeEvent('success', {
      node_id: nodeId,
      stake: parsed && parsed.stake ? parsed.stake : parsed,
    });
    return { ok: true, stake: parsed && parsed.stake ? parsed.stake : parsed };
  }

  const kind = classifyFailure(res.status, text);
  if (kind === 'funds') {
    _state.fundsFailures += 1;
    _state.nextAttemptAt = now + pickDelay('funds');
    const short = parseShortfall(text);
    logStakeEvent('insufficient_credits', {
      node_id: nodeId,
      status: res.status,
      needed: short ? short.need : amount,
      have: short ? short.have : null,
      attempt: _state.fundsFailures,
      next_retry_in_ms: _state.nextAttemptAt - now,
      hint: 'earn credits by completing validation tasks or claim the node on evomap.ai to top up',
    });
    return { ok: false, status: res.status, error: text.slice(0, 400), kind: 'funds' };
  }

  if (kind === 'permanent') {
    _state.disabledUntilRestart = true;
    logStakeEvent('failed_permanent', {
      node_id: nodeId,
      status: res.status,
      error: text.slice(0, 400),
      note: 'stake disabled until process restart; check client version and hub compatibility',
    });
    return { ok: false, status: res.status, error: text.slice(0, 400), kind: 'permanent' };
  }

  _state.transientFailures += 1;
  _state.nextAttemptAt = now + pickDelay('transient');
  logStakeEvent('failed_transient', {
    node_id: nodeId,
    status: res.status,
    error: text.slice(0, 400),
    attempt: _state.transientFailures,
    next_retry_in_ms: _state.nextAttemptAt - now,
  });
  return { ok: false, status: res.status, error: text.slice(0, 400), kind: 'transient' };
}

// Test-only reset hook.
function _resetStateForTests() {
  _state = {
    nextAttemptAt: 0,
    transientFailures: 0,
    fundsFailures: 0,
    lastSuccessAt: 0,
    disabledUntilRestart: false,
  };
}

function _getStateForTests() {
  return Object.assign({}, _state);
}

module.exports = {
  ensureValidatorStake,
  DEFAULT_STAKE_AMOUNT,
  BACKOFF_STEPS_TRANSIENT_MS,
  BACKOFF_STEPS_FUNDS_MS,
  SUCCESS_RECHECK_MS,
  _resetStateForTests,
  _getStateForTests,
};
