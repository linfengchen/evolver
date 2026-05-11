'use strict';

// W3C Trace Context-compatible identifiers.
// trace_id: 16 bytes (32 hex chars), span_id: 8 bytes (16 hex chars).
// Generated with crypto.randomBytes so we never depend on the optional OTel SDK
// to assign IDs; ensures local JSONL records always have stable identifiers
// even when remote export is disabled.

const crypto = require('crypto');

const TRACE_ID_BYTES = 16;
const SPAN_ID_BYTES = 8;
const TRACE_ID_HEX_LEN = TRACE_ID_BYTES * 2;
const SPAN_ID_HEX_LEN = SPAN_ID_BYTES * 2;
const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;
const ZERO_TRACE_ID = '0'.repeat(TRACE_ID_HEX_LEN);
const ZERO_SPAN_ID = '0'.repeat(SPAN_ID_HEX_LEN);

function newTraceId() {
  let id;
  do {
    id = crypto.randomBytes(TRACE_ID_BYTES).toString('hex');
  } while (id === ZERO_TRACE_ID);
  return id;
}

function newSpanId() {
  let id;
  do {
    id = crypto.randomBytes(SPAN_ID_BYTES).toString('hex');
  } while (id === ZERO_SPAN_ID);
  return id;
}

function isValidTraceId(value) {
  return typeof value === 'string' && TRACE_ID_RE.test(value);
}

function isValidSpanId(value) {
  return typeof value === 'string' && SPAN_ID_RE.test(value);
}

module.exports = {
  newTraceId,
  newSpanId,
  isValidTraceId,
  isValidSpanId,
  TRACE_ID_HEX_LEN,
  SPAN_ID_HEX_LEN,
};
