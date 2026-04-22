'use strict';

// One-off script: normalize local skill2gep genes.jsonl.
// - Move "AVOID: ..." steps from strategy into a dedicated top-level `avoid` field.
// - Rewrite `summary` to a concise natural-language description instead of
//   copy-pasting the first strategy step (previous output was "<id>: <step1>...").
// - Recompute asset_id for every changed gene.
// Idempotent: re-runs do not change content once normalized.

const fs = require('fs');
const path = require('path');
const { computeAssetId } = require('../src/gep/contentHash');

const GENES_PATH = path.join(__dirname, '..', 'assets/gep/genes.jsonl');

// Hand-curated concise summaries. Generated only for genes we actually
// own + publish; all other genes are left untouched.
const CURATED_SUMMARIES = {
  gene_skill2gep_gene_distill:
    'Distill a Skill document into a reusable GEP Gene by extracting trigger signals, strategy steps, anti-patterns, and validation commands.',
  gene_skill2gep_capsule_collect:
    'Assemble a GEP Capsule from a single real execution of a Gene: record outcome, execution trace, and environment fingerprint.',
  gene_skill2gep_publish_route:
    'Route GEP assets to the correct channel: SKILL.md goes to the Skill Store; Genes and Capsules go to the GEP Hub via evolver publish.',
  gene_vercel_deploy_cicd:
    'Deploy a Next.js project to Vercel in CI by separating the build step from the deploy step and pinning the CLI to a non-interactive token.',
};

function normalizeGene(gene) {
  if (!gene || gene.type !== 'Gene') return { gene, changed: false };
  const id = gene.id;
  const curated = CURATED_SUMMARIES[id];
  if (!curated) return { gene, changed: false };

  let changed = false;

  const oldStrategy = Array.isArray(gene.strategy) ? gene.strategy.slice() : [];
  const newStrategy = [];
  const extractedAvoid = [];
  for (const step of oldStrategy) {
    const s = String(step);
    const m = s.match(/^\s*AVOID\s*[:\-]\s*(.+)$/i);
    if (m) {
      extractedAvoid.push(m[1].trim());
    } else {
      newStrategy.push(s);
    }
  }

  if (extractedAvoid.length > 0 || !Array.isArray(gene.avoid)) {
    const existing = Array.isArray(gene.avoid) ? gene.avoid.slice() : [];
    // Merge dedup, preserve order, cap 5.
    const seen = new Set();
    const merged = [];
    [...existing, ...extractedAvoid].forEach((a) => {
      const k = String(a).trim();
      if (k && !seen.has(k.toLowerCase())) {
        seen.add(k.toLowerCase());
        merged.push(k);
      }
    });
    if (JSON.stringify(gene.avoid || []) !== JSON.stringify(merged)) {
      gene.avoid = merged.slice(0, 5);
      changed = true;
    }
  }

  if (JSON.stringify(gene.strategy) !== JSON.stringify(newStrategy)) {
    gene.strategy = newStrategy;
    changed = true;
  }

  if (gene.summary !== curated) {
    gene.summary = curated;
    changed = true;
  }

  if (changed) {
    delete gene.asset_id;
    const newId = computeAssetId(gene);
    gene.asset_id = newId;
  }

  return { gene, changed };
}

function main() {
  const raw = fs.readFileSync(GENES_PATH, 'utf8');
  const lines = raw.split(/\n/).filter((l) => l.trim().length > 0);
  const out = [];
  let changedCount = 0;
  for (const line of lines) {
    const gene = JSON.parse(line);
    const prevId = gene.asset_id;
    const res = normalizeGene(gene);
    if (res.changed) {
      changedCount += 1;
      // eslint-disable-next-line no-console
      console.log(`normalized ${res.gene.id}: ${prevId} -> ${res.gene.asset_id}`);
    }
    out.push(JSON.stringify(res.gene));
  }
  const output = out.join('\n') + '\n';
  fs.writeFileSync(GENES_PATH, output, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`done. total=${lines.length} changed=${changedCount}`);
}

main();
