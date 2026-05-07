'use strict';

const { PROXY_PROTOCOL_VERSION } = require('../mailbox/store');
const crypto = require('crypto');

const DEFAULT_HEARTBEAT_INTERVAL = 360_000;
const HELLO_TIMEOUT = 15_000;
const HEARTBEAT_TIMEOUT = 10_000;
const MAX_REAUTH_ATTEMPTS = 2;

let _cachedFingerprint = null;
function _getEnvFingerprint() {
  if (_cachedFingerprint) return _cachedFingerprint;
  try {
    const { captureEnvFingerprint } = require('../../gep/envFingerprint');
    _cachedFingerprint = captureEnvFingerprint();
  } catch {
    _cachedFingerprint = {
      platform: process.platform,
      arch: process.arch,
      node_version: process.version,
    };
  }
  return _cachedFingerprint;
}

class AuthError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

class LifecycleManager {
  constructor({ hubUrl, store, logger, getTaskMeta } = {}) {
    this.hubUrl = (hubUrl || process.env.A2A_HUB_URL || '').replace(/\/+$/, '');
    this.store = store;
    this.logger = logger || console;
    this.getTaskMeta = getTaskMeta || null;
    this._heartbeatTimer = null;
    this._running = false;
    this._startedAt = null;
    this._consecutiveFailures = 0;
    this._reauthInProgress = false;
    this._helloRateLimitUntil = 0;
    this._reauthBackoffUntil = 0;
  }

  get nodeId() {
    return this.store.getState('node_id');
  }

  get nodeSecret() {
    return this._resolveNodeSecret();
  }

  /**
   * Resolve the active node_secret with conflict reconciliation between the
   * persistent MailboxStore and `process.env.A2A_NODE_SECRET`.
   *
   * The store is normally authoritative because it is updated whenever
   * /a2a/hello returns a fresh secret (including rotations). However, if the
   * operator explicitly sets `A2A_NODE_SECRET` in the environment AND it
   * disagrees with the stored value, the env var wins and we sync the store
   * back to the env value. This breaks the failure mode reported in
   * EvoMap/evolver#529 where a stale secret persisted in
   * `~/.evomap/mailbox/state.json` keeps overriding a freshly minted secret
   * exported from `.env`, producing an infinite re-auth loop:
   *   stale store secret -> hello "OK" (lenient path) -> heartbeat 403
   *   -> rotate_secret hello -> node_id_already_claimed (because the bearer
   *   we sent could not prove ownership) -> 30-min backoff.
   *
   * Single-source mode (only one of store/env present) is unchanged.
   * @returns {string|null}
   */
  _resolveNodeSecret() {
    const envSecret = this._suppressEnvSecret
      ? null
      : ((process.env.A2A_NODE_SECRET || '').trim() || null);
    const storeSecret = this.store.getState('node_secret') || null;
    const valid = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s);

    if (envSecret && storeSecret && envSecret !== storeSecret) {
      if (valid(envSecret)) {
        this.store.setState('node_secret', envSecret);
        if (!this._envOverrideLogged) {
          this._envOverrideLogged = true;
          this.logger.warn(
            '[lifecycle] A2A_NODE_SECRET env var differs from MailboxStore; using env value and syncing store. ' +
              'Clear ~/.evomap/mailbox/state.json or unset A2A_NODE_SECRET to silence this warning.'
          );
        }
        return envSecret;
      }
      // env var malformed -- ignore it, fall back to store
      return storeSecret;
    }

    return storeSecret || envSecret || null;
  }

  _buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const secret = this.nodeSecret;
    if (secret) headers['Authorization'] = 'Bearer ' + secret;
    headers['x-correlation-id'] = crypto.randomUUID();
    return headers;
  }

  async hello({ rotateSecret = false } = {}) {
    if (!this.hubUrl) return { ok: false, error: 'no_hub_url' };

    if (this._helloRateLimitUntil > Date.now()) {
      const waitSec = Math.ceil((this._helloRateLimitUntil - Date.now()) / 1000);
      this.logger.warn(`[lifecycle] hello suppressed: rate limited for ${waitSec}s`);
      return { ok: false, error: 'hello_rate_limit_active', waitSec };
    }

    const endpoint = `${this.hubUrl}/a2a/hello`;
    const nodeId = this.store.getState('node_id') || `node_${crypto.randomBytes(6).toString('hex')}`;

    const payload = { capabilities: {} };
    if (rotateSecret) payload.rotate_secret = true;

    const fp = _getEnvFingerprint();

    const body = {
      protocol: 'gep-a2a',
      protocol_version: '1.0.0',
      message_type: 'hello',
      message_id: 'msg_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
      sender_id: nodeId,
      timestamp: new Date().toISOString(),
      payload,
      env_fingerprint: fp,
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HELLO_TIMEOUT),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData?.error || `http_${res.status}`;
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('retry-after') || '3600', 10);
          this._helloRateLimitUntil = Date.now() + retryAfter * 1000;
          this.logger.error(`[lifecycle] hello rate limited (429): retry after ${retryAfter}s`);
          return { ok: false, error: 'hello_rate_limited', retryAfter };
        }
        this.logger.error(`[lifecycle] hello HTTP ${res.status}: ${errMsg}`);
        return { ok: false, error: errMsg, statusCode: res.status };
      }

      const data = await res.json();

      if (data?.payload?.status === 'rejected') {
        this.logger.error(`[lifecycle] hello rejected: ${data.payload.reason || 'unknown'}`);
        return { ok: false, error: data.payload.reason || 'hello_rejected', response: data };
      }

      const secret = data?.payload?.node_secret || data?.node_secret || null;
      if (secret && /^[a-f0-9]{64}$/i.test(secret)) {
        this.store.setState('node_secret', secret);
        // Hub just handed us a fresh secret. Whatever sits in
        // A2A_NODE_SECRET is now older than the store, so suppress the
        // env-wins reconciliation in _resolveNodeSecret for the rest of
        // this process. Without this, the very next _buildHeaders call
        // (e.g. the verification heartbeat in reAuthenticate) would see
        // env vs store as a conflict, treat the env value as authoritative,
        // and overwrite the freshly rotated secret with the stale one,
        // re-creating the auth loop the previous patch fixed (see #529
        // and the Bugbot review on PR #22).
        this._suppressEnvSecret = true;
        this.logger.log('[lifecycle] new node_secret stored from hello response');
      }

      this.store.setState('node_id', nodeId);
      this.logger.log(`[lifecycle] hello OK, node_id=${nodeId}${rotateSecret ? ' (secret rotated)' : ''}`);
      return { ok: true, nodeId, response: data };
    } catch (err) {
      this.logger.error(`[lifecycle] hello failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Re-authenticate after 403: rotate secret via hello, then verify with a
   * heartbeat. Returns true if auth is restored, false otherwise.
   *
   * Recovery sequence (issue EvoMap/evolver#529):
   *   attempt 1 -> hello with current Bearer + rotate_secret=true
   *                (works when the stale secret is still recognised)
   *   attempt 2 -> drop the bearer locally, hello WITHOUT Authorization
   *                + rotate_secret=true. If the node is owned by someone
   *                else, hub returns node_id_already_claimed; we surface a
   *                manual-reset hint to the user instead of churning forever.
   */
  async reAuthenticate() {
    if (this._reauthInProgress) return false;
    if (this._reauthBackoffUntil > Date.now()) {
      const waitSec = Math.ceil((this._reauthBackoffUntil - Date.now()) / 1000);
      this.logger.warn(`[lifecycle] re-auth suppressed: backoff active for ${waitSec}s`);
      return false;
    }
    this._reauthInProgress = true;
    let manualResetRequired = false;
    try {
      for (let attempt = 1; attempt <= MAX_REAUTH_ATTEMPTS; attempt++) {
        this.logger.warn(`[lifecycle] re-auth attempt ${attempt}/${MAX_REAUTH_ATTEMPTS}: rotating secret via hello...`);
        const helloResult = await this.hello({ rotateSecret: true });
        if (!helloResult.ok) {
          this.logger.error(`[lifecycle] re-auth hello failed: ${helloResult.error}`);
          if (helloResult.error === 'hello_rate_limited' || helloResult.error === 'hello_rate_limit_active') break;
          if (typeof helloResult.error === 'string' && helloResult.error.startsWith('node_id_already_claimed')) {
            // Hub does not believe we own this nodeId. Our locally cached
            // secret(s) are useless. Drop them so attempt 2 retries WITHOUT
            // a Bearer (lenient hello path). If even unauthenticated rotate
            // is rejected, only a manual reset can recover.
            if (attempt < MAX_REAUTH_ATTEMPTS) {
              this._dropLocalSecret('node_id_already_claimed');
              continue;
            }
            manualResetRequired = true;
            break;
          }
          continue;
        }
        const newSecret = helloResult.response?.payload?.node_secret;
        if (!newSecret) {
          this.logger.error('[lifecycle] re-auth: hub did not return a new secret (rotate may not have taken effect)');
          break;
        }
        const hbResult = await this.heartbeat({ _skipReauth: true });
        if (hbResult.ok) {
          this.logger.log('[lifecycle] re-auth succeeded: heartbeat confirmed with new secret');
          // Note: _envOverrideLogged is intentionally NOT reset here.
          // The successful hello path above already set _suppressEnvSecret=true,
          // which means _resolveNodeSecret will never hit the env-vs-store
          // conflict branch again in this process, so the warning would never
          // fire a second time anyway. Resetting the flag was misleading.
          return true;
        }
        this.logger.warn(`[lifecycle] re-auth attempt ${attempt}: heartbeat still failing after rotate`);
      }
      if (manualResetRequired) {
        this._emitManualResetNeeded();
      }
      this.logger.error('[lifecycle] re-auth exhausted all attempts, backing off for 30 minutes');
      this._reauthBackoffUntil = Date.now() + 30 * 60_000;
      return false;
    } finally {
      this._reauthInProgress = false;
    }
  }

  /**
   * Drop the cached node_secret in MailboxStore AND signal the env-var path to
   * skip its value for this process lifetime. Used when the hub explicitly
   * disowns our claim.
   * @param {string} reason - log tag describing why we are dropping it.
   */
  _dropLocalSecret(reason) {
    this.logger.warn(`[lifecycle] dropping cached node_secret (reason=${reason}); next hello will run unauthenticated`);
    try { this.store.setState('node_secret', ''); } catch { /* best-effort */ }
    // Suppress the env override for this process so _resolveNodeSecret stops
    // re-seeding the store with the same stale env value next call.
    this._suppressEnvSecret = true;
  }

  _emitManualResetNeeded() {
    try {
      this.store.writeInbound({
        type: 'system',
        priority: 'high',
        channel: 'evomap-hub',
        payload: {
          action: 'manual_secret_reset_required',
          message:
            'Hub disowns this node_id (node_id_already_claimed). Local node_secret in MailboxStore and A2A_NODE_SECRET env var are both invalid. Visit https://evomap.ai/account, click "Reset Secret" on the agent card, then update A2A_NODE_SECRET (or delete ~/.evomap/mailbox/state.json) and restart proxy.',
          docs_url: 'https://evomap.ai/account',
        },
      });
    } catch (err) {
      this.logger.warn(`[lifecycle] failed to emit manual_secret_reset_required event: ${err.message}`);
    }
  }

  async heartbeat({ _skipReauth = false } = {}) {
    if (!this.hubUrl) return { ok: false, error: 'no_hub_url' };

    const nodeId = this.nodeId;
    if (!nodeId) {
      const helloResult = await this.hello();
      if (!helloResult.ok) return helloResult;
    }

    const endpoint = `${this.hubUrl}/a2a/heartbeat`;
    const taskMeta = typeof this.getTaskMeta === 'function' ? this.getTaskMeta() : {};
    const fp = _getEnvFingerprint();
    const body = {
      node_id: this.nodeId,
      sender_id: this.nodeId,
      evolver_version: fp.evolver_version || PROXY_PROTOCOL_VERSION,
      env_fingerprint: fp,
      meta: {
        proxy_version: PROXY_PROTOCOL_VERSION,
        proxy_protocol_version: PROXY_PROTOCOL_VERSION,
        outbound_pending: this.store.countPending({ direction: 'outbound' }),
        inbound_pending: this.store.countPending({ direction: 'inbound' }),
        ...taskMeta,
      },
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT),
      });

      if (res.status === 403 || res.status === 401) {
        this._consecutiveFailures++;
        const errText = await res.text().catch(() => '');
        this.logger.error(`[lifecycle] heartbeat auth failed (${res.status}): ${errText}`);
        if (!_skipReauth) {
          const recovered = await this.reAuthenticate();
          if (recovered) {
            this._consecutiveFailures = 0;
            return { ok: true, recovered: true };
          }
        }
        return { ok: false, error: `auth_failed_${res.status}`, statusCode: res.status };
      }

      if (!res.ok) {
        this._consecutiveFailures++;
        const errText = await res.text().catch(() => '');
        this.logger.error(`[lifecycle] heartbeat HTTP ${res.status}: ${errText}`);
        return { ok: false, error: `http_${res.status}`, statusCode: res.status };
      }

      const data = await res.json();

      this._consecutiveFailures = 0;
      this.store.setState('last_heartbeat_at', new Date().toISOString());

      if (data?.status === 'unknown_node') {
        this.logger.warn('[lifecycle] Node unknown, re-registering...');
        await this.hello();
      }

      if (Array.isArray(data?.events) && data.events.length > 0) {
        this.store.writeInboundBatch(
          data.events.map(e => ({
            type: e.type || 'hub_event',
            payload: e,
            channel: 'evomap-hub',
          }))
        );
      }

      if (data?.min_proxy_version && this._shouldUpgrade(data.min_proxy_version)) {
        this.store.writeInbound({
          type: 'system',
          payload: {
            action: 'proxy_upgrade_required',
            min_version: data.min_proxy_version,
            current_version: PROXY_PROTOCOL_VERSION,
            upgrade_url: data.upgrade_url || null,
            message: data.upgrade_message || 'Proxy version is below the minimum required by Hub.',
          },
          channel: 'evomap-hub',
          priority: 'high',
        });
        this.logger.warn(`[lifecycle] Hub requires proxy >= ${data.min_proxy_version}, current: ${PROXY_PROTOCOL_VERSION}`);
      }

      return { ok: true, response: data };
    } catch (err) {
      this._consecutiveFailures++;
      this.logger.error(`[lifecycle] heartbeat failed (${this._consecutiveFailures}): ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  startHeartbeatLoop(intervalMs) {
    if (this._running) return;
    this._running = true;
    this._startedAt = Date.now();

    const interval = Math.max(30_000, intervalMs || DEFAULT_HEARTBEAT_INTERVAL);

    const tick = async () => {
      if (!this._running) return;
      await this.heartbeat();
      if (this._running) {
        const backoff = this._consecutiveFailures > 0
          ? Math.min(interval * Math.pow(2, this._consecutiveFailures), 30 * 60_000)
          : interval;
        this._heartbeatTimer = setTimeout(tick, backoff);
        if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
      }
    };

    tick();
  }

  stopHeartbeatLoop() {
    this._running = false;
    if (this._heartbeatTimer) {
      clearTimeout(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _shouldUpgrade(minVersion) {
    // parseInt strips trailing non-digit chars in prerelease segments like
    // `1-beta`, so `0.1.1-beta.1`.split('.')[2] -> `1-beta` -> parseInt = 1.
    // Using Number() here returned NaN and was treated as 0, under-counting
    // prerelease minimums. See community PR #516.
    const parse = (v) => String(v || '0.0.0').split('.').map((part) => parseInt(part, 10));
    const min = parse(minVersion);
    const cur = parse(PROXY_PROTOCOL_VERSION);
    for (let i = 0; i < 3; i++) {
      if ((cur[i] || 0) < (min[i] || 0)) return true;
      if ((cur[i] || 0) > (min[i] || 0)) return false;
    }
    return false;
  }
}

module.exports = { LifecycleManager, AuthError, DEFAULT_HEARTBEAT_INTERVAL };
