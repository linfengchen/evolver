const crypto = require('crypto');
const { execSync } = require('child_process');

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function hashCompact(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex').slice(0, 16);
}

function buildRequestPayload({ geneId, signals, mutation }) {
  let nodeSecret = null;
  try {
    nodeSecret = require('./a2aProtocol').getHubNodeSecret();
  } catch (e) {}
  if (!nodeSecret) return null;

  let nodeId = null;
  try {
    nodeId = require('./a2aProtocol').getNodeId();
  } catch (e) {}
  if (!nodeId) return null;

  const secretHash = crypto.createHash('sha256').update(nodeSecret).digest('hex');

  const ts = Date.now();
  const signalsHash = hashCompact(JSON.stringify(Array.isArray(signals) ? signals.slice(0, 8) : []));
  const mutationHash = hashCompact(JSON.stringify(mutation || {}));

  const challengeData = [nodeId, geneId || '', signalsHash, mutationHash, String(ts)].join('|');
  const clientSignature = hmacSha256(secretHash, challengeData);

  return {
    nodeId,
    nodeSecret,
    body: {
      sender_id: nodeId,
      gene_id: geneId || '',
      signals_hash: signalsHash,
      mutation_hash: mutationHash,
      ts: ts,
      client_signature: clientSignature,
    },
  };
}

function requestSolidifyPermitSync({ geneId, signals, mutation }) {
  const hubUrl = (process.env.A2A_HUB_URL || '').replace(/\/+$/, '');
  if (!hubUrl) return { ok: false, error: 'no_hub_url', offline: true };

  const req = buildRequestPayload({ geneId, signals, mutation });
  if (!req) return { ok: false, error: 'no_credentials', offline: true };

  const endpoint = hubUrl + '/a2a/verify-solidify';
  const timeoutSec = Math.ceil((require('../config').HTTP_TRANSPORT_TIMEOUT_MS || 10000) / 1000);

  const curlCmd = [
    'curl', '-s', '-X', 'POST',
    '-H', '"Content-Type: application/json"',
    '-H', '"Authorization: Bearer ' + req.nodeSecret + '"',
    '-d', "'" + JSON.stringify(req.body).replace(/'/g, "'\\''") + "'",
    '--max-time', String(timeoutSec),
    '"' + endpoint + '"',
  ].join(' ');

  try {
    const stdout = execSync(curlCmd, {
      encoding: 'utf8',
      timeout: (timeoutSec + 2) * 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (!stdout || !stdout.trim()) {
      return { ok: false, error: 'empty_response', offline: true };
    }
    return JSON.parse(stdout.trim());
  } catch (e) {
    return { ok: false, error: e.message || 'curl_failed', offline: true };
  }
}

function requestSolidifyPermit({ geneId, signals, mutation }) {
  const hubUrl = (process.env.A2A_HUB_URL || '').replace(/\/+$/, '');
  if (!hubUrl) return Promise.resolve({ ok: false, error: 'no_hub_url', offline: true });

  const req = buildRequestPayload({ geneId, signals, mutation });
  if (!req) return Promise.resolve({ ok: false, error: 'no_credentials', offline: true });

  const endpoint = hubUrl + '/a2a/verify-solidify';
  const timeoutMs = require('../config').HTTP_TRANSPORT_TIMEOUT_MS || 10000;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + req.nodeSecret,
  };

  return fetch(endpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          return { ok: false, error: 'HTTP ' + res.status + ': ' + t.slice(0, 200) };
        });
      }
      return res.json();
    })
    .catch(function (err) {
      return { ok: false, error: err.message, offline: true };
    });
}

function isSolidifyVerifyEnabled() {
  const v = (process.env.EVOLVER_SOLIDIFY_VERIFY || '').toLowerCase();
  if (v === 'false' || v === '0' || v === 'off') return false;
  const hubUrl = process.env.A2A_HUB_URL || '';
  return !!hubUrl;
}

module.exports = {
  requestSolidifyPermit,
  requestSolidifyPermitSync,
  isSolidifyVerifyEnabled,
};
