// src/gep/validator/stakeBootstrap.js
//
// Ensures this node has an active validator stake on the Hub before it
// starts consuming validation tasks. Idempotent: repeated calls will not
// create duplicate stakes; the Hub returns the existing active stake.
'use strict';

const crypto = require('crypto');
const { buildHubHeaders, getHubUrl, getNodeId } = require('../a2aProtocol');

const DEFAULT_STAKE_AMOUNT = Number(process.env.EVOLVER_VALIDATOR_STAKE_AMOUNT) || 100;
const STAKE_TIMEOUT_MS = Number(process.env.EVOLVER_VALIDATOR_STAKE_TIMEOUT_MS) || 10_000;
const HUB_URL_FALLBACK = process.env.A2A_HUB_URL || process.env.EVOMAP_HUB_URL || 'https://evomap.ai';

function resolveHubUrl() {
  try {
    const u = getHubUrl && getHubUrl();
    if (u && typeof u === 'string') return u;
  } catch (_) {}
  return HUB_URL_FALLBACK;
}

let _lastAttemptAt = 0;

/**
 * Attempt to stake credits so this node becomes eligible for validation tasks.
 * Safe to call repeatedly; debounced to at most once per 5 minutes.
 *
 * @param {{ amount?: number, force?: boolean }} [opts]
 */
async function ensureValidatorStake(opts) {
  const options = opts || {};
  const now = Date.now();
  if (!options.force && now - _lastAttemptAt < 5 * 60 * 1000) {
    return { ok: true, skipped: 'debounced' };
  }
  _lastAttemptAt = now;

  const nodeId = getNodeId();
  if (!nodeId) return { ok: false, error: 'no_node_id' };

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

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHubHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, error: text.slice(0, 400) };
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    return { ok: true, stake: parsed && parsed.stake ? parsed.stake : parsed };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  ensureValidatorStake,
  DEFAULT_STAKE_AMOUNT,
};
