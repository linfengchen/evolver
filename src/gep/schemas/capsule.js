'use strict';

// ---------------------------------------------------------------------------
// Capsule Schema — single source of truth for the Capsule object shape.
// All modules that create or consume Capsule objects should use
// createCapsule() and validateCapsule() rather than assuming field presence.
// ---------------------------------------------------------------------------

const { SCHEMA_VERSION } = require('../contentHash');

const VALID_OUTCOME_STATUSES = ['success', 'failed'];

const CAPSULE_DEFAULTS = {
  type: 'Capsule',
  id: null,
  schema_version: SCHEMA_VERSION,
  trigger: [],
  gene: null,
  summary: '',
  confidence: 0,
  blast_radius: { files: 0, lines: 0 },
  outcome: { status: 'failed', score: 0 },
  success_streak: 0,
  success_reason: null,
  gene_library_version: null,
  env_fingerprint: null,
  source_type: null,
  reused_asset_id: null,
  a2a: { eligible_to_broadcast: false },
  content: null,
  diff: null,
  strategy: [],
  execution_trace: [],
  asset_id: null,
};

// createCapsule: merge partial with defaults and normalize array/object fields.
// Safe to call with a fully-formed Capsule (idempotent).
function createCapsule(partial) {
  const c = Object.assign({}, CAPSULE_DEFAULTS, partial);

  // Fresh array copies — never hold references to CAPSULE_DEFAULTS arrays.
  c.trigger         = Array.isArray(c.trigger)         ? c.trigger.slice()         : [];
  c.strategy        = Array.isArray(c.strategy)        ? c.strategy.slice()        : [];
  c.execution_trace = Array.isArray(c.execution_trace) ? c.execution_trace.slice() : [];

  // Normalize blast_radius
  if (!c.blast_radius || typeof c.blast_radius !== 'object') {
    c.blast_radius = { files: 0, lines: 0 };
  } else {
    c.blast_radius = Object.assign({ files: 0, lines: 0 }, c.blast_radius);
  }

  // Normalize outcome
  if (!c.outcome || typeof c.outcome !== 'object') {
    c.outcome = { status: 'failed', score: 0 };
  } else {
    c.outcome = Object.assign({ status: 'failed', score: 0 }, c.outcome);
    if (!VALID_OUTCOME_STATUSES.includes(c.outcome.status)) {
      c.outcome.status = 'failed';
    }
  }

  // Normalize a2a
  if (!c.a2a || typeof c.a2a !== 'object') {
    c.a2a = { eligible_to_broadcast: false };
  } else {
    c.a2a = Object.assign({ eligible_to_broadcast: false }, c.a2a);
  }

  // Normalize string fields
  if (typeof c.summary !== 'string')        c.summary = '';
  if (typeof c.schema_version !== 'string') c.schema_version = SCHEMA_VERSION;
  if (typeof c.confidence !== 'number')     c.confidence = 0;

  return c;
}

// validateCapsule: throw if required fields are missing or malformed.
// Use before broadcasting/publishing a Capsule to the Hub or writing to disk.
function validateCapsule(c) {
  if (!c || typeof c !== 'object')          throw new Error('Capsule must be an object');
  if (c.type !== 'Capsule')                 throw new Error('Capsule.type must be "Capsule", got: ' + c.type);
  if (!c.id || typeof c.id !== 'string')    throw new Error('Capsule.id is required and must be a string');
  if (!c.outcome || typeof c.outcome !== 'object')
                                            throw new Error('Capsule.outcome must be an object');
  if (!VALID_OUTCOME_STATUSES.includes(c.outcome.status))
                                            throw new Error('Capsule.outcome.status must be one of: ' + VALID_OUTCOME_STATUSES.join(', ') + ', got: ' + c.outcome.status);
  if (!Array.isArray(c.trigger))            throw new Error('Capsule.trigger must be an array');
  if (!Array.isArray(c.execution_trace))    throw new Error('Capsule.execution_trace must be an array');
  return true;
}

module.exports = { createCapsule, validateCapsule, CAPSULE_DEFAULTS, VALID_OUTCOME_STATUSES };
