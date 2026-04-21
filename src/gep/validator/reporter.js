// src/gep/validator/reporter.js
//
// Builds and submits validation reports for validation tasks.
// Sends via POST /a2a/report with `task_id` + `nonce` so the Hub routes the
// body into processValidationReport instead of the normal reporting path.
'use strict';

const crypto = require('crypto');
const { buildHubHeaders, getHubUrl, getNodeId } = require('../a2aProtocol');
const { captureEnvFingerprint } = require('../envFingerprint');
const { resolveHubUrl: resolveDefaultHubUrl } = require('../../config');

const REPORT_TIMEOUT_MS = Number(process.env.EVOLVER_VALIDATOR_REPORT_TIMEOUT_MS) || 10_000;

function resolveHubUrl() {
  try {
    const u = getHubUrl && getHubUrl();
    if (u && typeof u === 'string') return u;
  } catch (_) {}
  return resolveDefaultHubUrl();
}

function hashExecutionLog(results) {
  const list = Array.isArray(results) ? results : [];
  const hash = crypto.createHash('sha256');
  for (const r of list) {
    hash.update(String(r.cmd || ''));
    hash.update('\0');
    hash.update(String(r.ok ? 1 : 0));
    hash.update('\0');
    hash.update(String(r.exitCode || 0));
    hash.update('\0');
    hash.update((r.stdout || '').slice(0, 4000));
    hash.update('\0');
    hash.update((r.stderr || '').slice(0, 4000));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Build the validation report payload the Hub expects.
 *
 * @param {{ task_id: string, nonce: string }} task
 * @param {{ results: Array, overallOk: boolean, durationMs: number }} execution
 * @param {{ reproductionScore?: number }} [opts]
 */
function buildReportPayload(task, execution, opts) {
  const options = opts || {};
  const results = Array.isArray(execution && execution.results) ? execution.results : [];
  const commandsTotal = results.length;
  const commandsPassed = results.filter((r) => r && r.ok).length;
  const env = captureEnvFingerprint();

  const reproductionScore = Number.isFinite(options.reproductionScore)
    ? options.reproductionScore
    : (commandsTotal > 0 ? commandsPassed / commandsTotal : 0);

  return {
    task_id: task.task_id,
    nonce: task.nonce,
    overall_ok: !!execution.overallOk,
    commands_passed: commandsPassed,
    commands_total: commandsTotal,
    duration_ms: execution.durationMs || 0,
    execution_log_hash: hashExecutionLog(results),
    env_fingerprint: env,
    reproduction_score: Math.max(0, Math.min(1, reproductionScore)),
  };
}

async function submitReport(payload) {
  const nodeId = getNodeId();
  if (!nodeId) return { ok: false, error: 'no_node_id' };
  const hubUrl = resolveHubUrl();
  const url = hubUrl.replace(/\/+$/, '') + '/a2a/report';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);

  const msg = {
    protocol: 'gep-a2a',
    protocol_version: '1.0.0',
    message_type: 'report',
    message_id: 'msg_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex'),
    sender_id: nodeId,
    timestamp: new Date().toISOString(),
    payload,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHubHeaders(),
      body: JSON.stringify(msg),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, error: text.slice(0, 400) };
    }
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: true, data: text };
    }
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  buildReportPayload,
  submitReport,
  hashExecutionLog,
};
