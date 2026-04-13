const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

  const curlArgs = [
    '-s', '-X', 'POST',
    '-H', 'Content-Type: application/json',
    '-H', 'Authorization: Bearer ' + req.nodeSecret,
    '-d', JSON.stringify(req.body),
    '--max-time', String(timeoutSec),
    endpoint,
  ];

  try {
    const stdout = execFileSync('curl', curlArgs, {
      encoding: 'utf8',
      timeout: (timeoutSec + 2) * 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (!stdout || !stdout.trim()) {
      return { ok: false, error: 'empty_response', offline: true };
    }
    const result = JSON.parse(stdout.trim());
    if (result && result.ok) {
      recordLastOnlineVerify();
      if (result.offline_token) {
        cacheOfflineToken(result.offline_token);
      }
    }
    return result;
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
      return res.json().then(function (result) {
        if (result && result.ok) {
          recordLastOnlineVerify();
          if (result.offline_token) {
            cacheOfflineToken(result.offline_token);
          }
        }
        return result;
      });
    })
    .catch(function (err) {
      return { ok: false, error: err.message, offline: true };
    });
}

// --- Offline token management ---

var _OFFLINE_TOKEN_FILE = null;
var _LAST_VERIFY_FILE = null;

function getMemDir() {
  try {
    return require('./paths').getMemoryDir();
  } catch (e) {
    try {
      return path.join(require('./paths').getRepoRoot(), '.evolver', 'memory');
    } catch (e2) {
      return path.join(process.cwd(), '.evolver', 'memory');
    }
  }
}

function offlineTokenPath() {
  if (!_OFFLINE_TOKEN_FILE) {
    _OFFLINE_TOKEN_FILE = path.join(getMemDir(), '.ot');
  }
  return _OFFLINE_TOKEN_FILE;
}

function lastVerifyPath() {
  if (!_LAST_VERIFY_FILE) {
    _LAST_VERIFY_FILE = path.join(getMemDir(), '.lv');
  }
  return _LAST_VERIFY_FILE;
}

function cacheOfflineToken(token) {
  try {
    const dir = path.dirname(offlineTokenPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = JSON.stringify(token);
    const key = crypto.createHash('sha256').update(process.env.A2A_HUB_URL || 'default').digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([iv, cipher.update(data, 'utf8'), cipher.final()]);
    fs.writeFileSync(offlineTokenPath(), encrypted);
  } catch (e) {}
}

function loadOfflineToken() {
  try {
    if (!fs.existsSync(offlineTokenPath())) return null;
    const encrypted = fs.readFileSync(offlineTokenPath());
    if (encrypted.length < 17) return null;
    const key = crypto.createHash('sha256').update(process.env.A2A_HUB_URL || 'default').digest();
    const iv = encrypted.slice(0, 16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const data = decipher.update(encrypted.slice(16)) + decipher.final('utf8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

function recordLastOnlineVerify() {
  try {
    const dir = path.dirname(lastVerifyPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(lastVerifyPath(), String(Date.now()), 'utf8');
  } catch (e) {}
}

function getLastOnlineVerifyTs() {
  try {
    if (!fs.existsSync(lastVerifyPath())) return 0;
    return parseInt(fs.readFileSync(lastVerifyPath(), 'utf8'), 10) || 0;
  } catch (e) {
    return 0;
  }
}

var MAX_OFFLINE_SOLIDIFIES = 10;
var MAX_OFFLINE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
var MAX_CLOCK_DRIFT_MS = 24 * 60 * 60 * 1000;

function consumeOfflinePermit() {
  var token = loadOfflineToken();
  if (!token) return { ok: false, error: 'no_offline_token', offline: true };

  var maxSolidifies = token.maxOfflineSolidifies || MAX_OFFLINE_SOLIDIFIES;
  var expiresAt = token.expiresAt || 0;
  var usedCount = token.usedCount || 0;
  var now = Date.now();

  var lastOnline = getLastOnlineVerifyTs();
  if (lastOnline > 0 && now < lastOnline - MAX_CLOCK_DRIFT_MS) {
    return { ok: false, error: 'clock_drift_detected', offline: true };
  }

  if (expiresAt > 0 && now > expiresAt) {
    return { ok: false, error: 'offline_token_expired', offline: true };
  }

  if (lastOnline > 0 && (now - lastOnline) > MAX_OFFLINE_DURATION_MS) {
    return { ok: false, error: 'offline_duration_exceeded', offline: true };
  }

  if (usedCount >= maxSolidifies) {
    return { ok: false, error: 'offline_quota_exhausted', offline: true };
  }

  token.usedCount = usedCount + 1;
  cacheOfflineToken(token);
  return { ok: true, offline: true, remaining: maxSolidifies - token.usedCount };
}

function isSolidifyVerifyEnabled() {
  if (process.env.NODE_ENV === 'test') {
    var v = (process.env.EVOLVER_SOLIDIFY_VERIFY || '').toLowerCase();
    if (v === 'false' || v === '0' || v === 'off') return false;
  }
  var hubUrl = process.env.A2A_HUB_URL || '';
  return !!hubUrl;
}

module.exports = {
  requestSolidifyPermit,
  requestSolidifyPermitSync,
  isSolidifyVerifyEnabled,
  consumeOfflinePermit,
  getLastOnlineVerifyTs,
};
