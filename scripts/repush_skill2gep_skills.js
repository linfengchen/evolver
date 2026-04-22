'use strict';

// One-off: re-render the 3 remaining skill2gep skills with the new
// geneToSkillMd (dedicated ## Avoid section + fixed extractStepVerb) and push
// them to the Skill Store as new versions.
// - skill_skill2gep_gene_distill
// - skill_skill2gep_capsule_collect
// - skill_skill2gep_publish_route
// skill_vercel_deploy_cicd was soft-deleted earlier; do not touch it here.

const fs = require('fs');
const path = require('path');

process.env.A2A_TRANSPORT = 'http';
if (!process.env.A2A_HUB_URL) process.env.A2A_HUB_URL = 'https://evomap.ai';

const { updateSkillOnHub, geneToSkillMd } = require('../src/gep/skillPublisher');
const { getNodeId } = require('../src/gep/a2aProtocol');

const TARGETS = {
  gene_skill2gep_gene_distill: 'skill_skill2gep_gene_distill',
  gene_skill2gep_capsule_collect: 'skill_skill2gep_capsule_collect',
  gene_skill2gep_publish_route: 'skill_skill2gep_publish_route',
};

async function main() {
  const nodeId = getNodeId();
  // eslint-disable-next-line no-console
  console.log('nodeId=', nodeId);
  const raw = fs.readFileSync(path.join(__dirname, '..', 'assets/gep/genes.jsonl'), 'utf8');
  const genes = raw.trim().split(/\n/).map((l) => JSON.parse(l));
  const byId = Object.fromEntries(genes.map((g) => [g.id, g]));

  for (const [geneId, skillId] of Object.entries(TARGETS)) {
    const gene = byId[geneId];
    if (!gene) {
      console.log(`skip ${geneId}: not found in genes.jsonl`);
      continue;
    }
    const content = geneToSkillMd(gene);
    // eslint-disable-next-line no-console
    console.log(`---- ${skillId} content preview ----`);
    console.log(content.split(/\n/).slice(0, 40).join('\n'));
    console.log('... (truncated)');

    const opts = { category: gene.category || 'innovate', tags: gene.signals_match || [] };
    // eslint-disable-next-line no-console
    process.stdout.write(`pushing ${skillId} ... `);
    const res = await updateSkillOnHub(nodeId, skillId, content, opts, gene);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(res));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
