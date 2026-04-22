'use strict';

// One-off: normalize local capsules.jsonl to match the new Gene conventions.
// - Strip "AVOID: ..." steps out of `strategy`.
// - Add a top-level `avoid` array mirroring those pitfalls so downstream
//   Hub renderers can surface them in a dedicated section.
// - Recompute `asset_id` for any capsule whose content changed.
// Idempotent: re-runs make no further changes once normalized.

const fs = require('fs');
const path = require('path');
const { computeAssetId } = require('../src/gep/contentHash');

const CAP_PATH = path.join(__dirname, '..', 'assets/gep/capsules.jsonl');

function normalize(capsule) {
  if (!capsule || capsule.type !== 'Capsule') return { capsule, changed: false };
  const oldStrategy = Array.isArray(capsule.strategy) ? capsule.strategy.slice() : [];
  if (oldStrategy.length === 0) return { capsule, changed: false };

  const newStrategy = [];
  const extractedAvoid = [];
  for (const step of oldStrategy) {
    const s = String(step);
    const m = s.match(/^\s*AVOID\s*[:\-]\s*(.+)$/i);
    if (m) extractedAvoid.push(m[1].trim());
    else newStrategy.push(s);
  }

  let changed = false;
  if (JSON.stringify(capsule.strategy) !== JSON.stringify(newStrategy)) {
    capsule.strategy = newStrategy;
    changed = true;
  }

  const existing = Array.isArray(capsule.avoid) ? capsule.avoid.slice() : [];
  const merged = [];
  const seen = new Set();
  [...existing, ...extractedAvoid].forEach((a) => {
    const k = String(a).trim();
    if (k && !seen.has(k.toLowerCase())) {
      seen.add(k.toLowerCase());
      merged.push(k);
    }
  });
  const mergedCapped = merged.slice(0, 5);
  if (JSON.stringify(capsule.avoid || []) !== JSON.stringify(mergedCapped)) {
    if (mergedCapped.length > 0) capsule.avoid = mergedCapped;
    else delete capsule.avoid;
    changed = true;
  }

  if (changed) {
    delete capsule.asset_id;
    capsule.asset_id = computeAssetId(capsule);
  }

  return { capsule, changed };
}

function main() {
  const raw = fs.readFileSync(CAP_PATH, 'utf8');
  const lines = raw.split(/\n/).filter((l) => l.trim().length > 0);
  const out = [];
  let changedCount = 0;
  for (const line of lines) {
    const cap = JSON.parse(line);
    const prev = cap.asset_id;
    const res = normalize(cap);
    if (res.changed) {
      changedCount += 1;
      // eslint-disable-next-line no-console
      console.log(`normalized ${res.capsule.id}: ${prev} -> ${res.capsule.asset_id}`);
    }
    out.push(JSON.stringify(res.capsule));
  }
  fs.writeFileSync(CAP_PATH, out.join('\n') + '\n', 'utf8');
  console.log(`done. total=${lines.length} changed=${changedCount}`);
}

main();
