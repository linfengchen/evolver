// src/gep/validator/index.js
//
// Validator mode entry-point. Feature-gated by EVOLVER_VALIDATOR_ENABLED.
// Intended usage: called once per evolve cycle, it will fetch assigned
// validation tasks from the Hub, execute the provided commands in a
// sandbox, and submit a ValidationReport back to the Hub.
//
// Failure modes are all non-fatal -- a validator that cannot reach the Hub
// or cannot sandbox-execute will simply skip and try again next cycle.
'use strict';

const { getNodeId, buildHubHeaders, getHubUrl } = require('../a2aProtocol');
const { runInSandbox } = require('./sandboxExecutor');
const { buildReportPayload, submitReport } = require('./reporter');
const { ensureValidatorStake } = require('./stakeBootstrap');

const FETCH_TIMEOUT_MS = Number(process.env.EVOLVER_VALIDATOR_FETCH_TIMEOUT_MS) || 8_000;
const HUB_URL_FALLBACK = process.env.A2A_HUB_URL || process.env.EVOMAP_HUB_URL || 'https://evomap.ai';
const MAX_TASKS_PER_CYCLE = Math.max(1, Number(process.env.EVOLVER_VALIDATOR_MAX_TASKS_PER_CYCLE) || 2);

function isValidatorEnabled() {
  const raw = String(process.env.EVOLVER_VALIDATOR_ENABLED || '').toLowerCase().trim();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function resolveHubUrl() {
  try {
    const u = getHubUrl && getHubUrl();
    if (u && typeof u === 'string') return u;
  } catch (_) {}
  return HUB_URL_FALLBACK;
}

/**
 * Fetch validation tasks assigned to this node.
 */
async function fetchValidationTasks() {
  const nodeId = getNodeId();
  if (!nodeId) return [];
  const hubUrl = resolveHubUrl();
  const url = hubUrl.replace(/\/+$/, '') + '/a2a/fetch';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const msg = {
    protocol: 'gep-a2a',
    protocol_version: '1.0.0',
    message_type: 'fetch',
    message_id: 'msg_' + Date.now().toString(36),
    sender_id: nodeId,
    timestamp: new Date().toISOString(),
    payload: {
      include_tasks: true,
      validation_only: true,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHubHeaders(),
      body: JSON.stringify(msg),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    const p = data.payload || data;
    const list = Array.isArray(p.validation_tasks) ? p.validation_tasks : [];
    return list;
  } catch (_) {
    clearTimeout(timer);
    return [];
  }
}

/**
 * Validate a single task.
 * @param {object} task - Hub-provided validation task
 * @returns {Promise<{ status: string, report?: object, response?: object, reason?: string }>}
 */
async function validateOneTask(task) {
  if (!task || !task.task_id || !task.nonce) {
    return { status: 'skipped', reason: 'invalid_task_shape' };
  }
  const commands = Array.isArray(task.validation_commands) ? task.validation_commands : [];
  if (commands.length === 0) {
    // Nothing to run -- report overall_ok=false so the Hub records a fail and moves on.
    const payload = buildReportPayload(task, { results: [], overallOk: false, durationMs: 0 });
    const r = await submitReport(payload);
    return { status: 'reported_empty', report: payload, response: r };
  }

  let execution;
  try {
    execution = await runInSandbox(commands, {});
  } catch (err) {
    execution = {
      results: [{
        cmd: commands[0],
        ok: false,
        stdout: '',
        stderr: 'sandbox_error: ' + (err && err.message ? err.message : String(err)),
        exitCode: -1,
        durationMs: 0,
        timedOut: false,
      }],
      overallOk: false,
      durationMs: 0,
      stoppedEarly: true,
    };
  }

  const payload = buildReportPayload(task, execution);
  const response = await submitReport(payload);
  return {
    status: response && response.ok ? 'reported' : 'report_failed',
    report: payload,
    response,
  };
}

/**
 * Run one validator cycle. Intended to be called from the main evolve loop.
 * Returns a summary object (useful for logging/tests).
 *
 * @param {{ skipStake?: boolean }} [opts]
 */
async function runValidatorCycle(opts) {
  const options = opts || {};
  if (!isValidatorEnabled()) {
    return { skipped: 'disabled' };
  }
  if (!options.skipStake) {
    try {
      await ensureValidatorStake({});
    } catch (err) {
      // non-fatal -- stake may already exist or will retry later
    }
  }

  const tasks = await fetchValidationTasks();
  if (!tasks || tasks.length === 0) {
    return { tasks: 0, processed: 0 };
  }

  const slice = tasks.slice(0, MAX_TASKS_PER_CYCLE);
  const outcomes = [];
  for (const t of slice) {
    try {
      const outcome = await validateOneTask(t);
      outcomes.push({ task_id: t.task_id, ...outcome });
    } catch (err) {
      outcomes.push({
        task_id: t.task_id,
        status: 'error',
        reason: err && err.message ? err.message : String(err),
      });
    }
  }
  return { tasks: tasks.length, processed: outcomes.length, outcomes };
}

module.exports = {
  runValidatorCycle,
  fetchValidationTasks,
  validateOneTask,
  isValidatorEnabled,
};
