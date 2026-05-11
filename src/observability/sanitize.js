'use strict';

// Sanitization for span attributes. Two responsibilities:
//   1) Secrets (Authorization, *_SECRET, *_TOKEN, cookies) must never appear in
//      either the exportable or local_only payload — strip them at write time.
//   2) Large strings stored under local_only may be size-capped via env so the
//      JSONL file stays bounded; the corresponding exportable summary (length,
//      sha256) is preserved unconditionally so reviewers can detect truncation.

const { redactValue } = require('../webui/observer/redact');

const DEFAULT_PROMPT_MAX = 64 * 1024;
const DEFAULT_HUB_BODY_MAX = 64 * 1024;
const TRUNCATION_MARKER = '...[truncated]';

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getLocalOnlyEnabled() {
  const raw = process.env.EVOLVER_OBS_LOCAL_PAYLOAD;
  if (raw === undefined) return true;
  return !/^(0|false|no|off)$/i.test(String(raw).trim());
}

function getPromptMaxChars() {
  return readPositiveIntEnv('EVOLVER_OBS_LOCAL_PROMPT_MAX_CHARS', DEFAULT_PROMPT_MAX);
}

function getHubBodyMaxChars() {
  return readPositiveIntEnv('EVOLVER_OBS_LOCAL_HUB_BODY_MAX_CHARS', DEFAULT_HUB_BODY_MAX);
}

// redactValue from the observer already handles secret keys + bearer tokens;
// we wrap it so the observability facade has a single import surface and we
// can layer additional rules (e.g. strict allowlists) later without touching
// callers.
function sanitizeExportable(value) {
  return redactValue(value);
}

function capForKey(key) {
  if (/prompt/i.test(key) || /transcript/i.test(key) || /initial_user_prompt/i.test(key)) {
    return getPromptMaxChars();
  }
  if (/hub_response|hub_body|response_body/i.test(key)) {
    return getHubBodyMaxChars();
  }
  return Math.max(getPromptMaxChars(), getHubBodyMaxChars());
}

function truncateString(text, cap) {
  if (typeof text !== 'string') return text;
  if (text.length <= cap) return text;
  return text.slice(0, Math.max(0, cap - TRUNCATION_MARKER.length)) + TRUNCATION_MARKER;
}

function sanitizeLocalOnlyValue(key, value) {
  if (!getLocalOnlyEnabled()) return undefined;
  let candidate = value;
  // If the value looks like an HTTP/Hub response body, try to parse as JSON so
  // structured secret keys (A2A_NODE_SECRET, Authorization, ...) get properly
  // redacted via redactValue's object path. Fall back to text-mode redaction
  // when parsing fails (free-form text bodies).
  if (typeof candidate === 'string' && /response_body|hub_response|hub_body/i.test(key)) {
    const trimmed = candidate.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        const sanitizedObject = redactValue(parsed);
        candidate = JSON.stringify(sanitizedObject);
      } catch {
        // Not valid JSON — fall through to text-mode redaction below.
      }
    }
  }
  const redacted = redactValue(candidate);
  if (typeof redacted !== 'string') return redacted;
  return truncateString(redacted, capForKey(key));
}

module.exports = {
  sanitizeExportable,
  sanitizeLocalOnlyValue,
  getLocalOnlyEnabled,
  getPromptMaxChars,
  getHubBodyMaxChars,
  TRUNCATION_MARKER,
};
