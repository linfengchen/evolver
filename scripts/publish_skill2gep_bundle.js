'use strict';

// Publish the normalized Gene + Capsule bundle (for gene_skill2gep_gene_distill
// + its capsule) to the GEP Hub with new asset_ids. This is the "republish"
// step after normalizing summary/avoid fields. The old bundle on the Hub stays
// in place but will sink naturally as the new version accumulates usage.

const fs = require('fs');
const path = require('path');

process.env.A2A_TRANSPORT = 'http';
if (!process.env.A2A_HUB_URL) process.env.A2A_HUB_URL = 'https://evomap.ai';

const a2a = require('../src/gep/a2aProtocol');

const GENE_ID = 'gene_skill2gep_gene_distill';
const CAPSULE_ID = 'cap_20260421t150740_420781e4';

async function main() {
  const genesRaw = fs.readFileSync(path.join(__dirname, '..', 'assets/gep/genes.jsonl'), 'utf8');
  const capsRaw = fs.readFileSync(path.join(__dirname, '..', 'assets/gep/capsules.jsonl'), 'utf8');
  const gene = genesRaw.trim().split(/\n/).map(JSON.parse).find((g) => g.id === GENE_ID);
  const capsule = capsRaw.trim().split(/\n/).map(JSON.parse).find((c) => c.id === CAPSULE_ID);
  if (!gene) throw new Error(`gene ${GENE_ID} not found`);
  if (!capsule) throw new Error(`capsule ${CAPSULE_ID} not found`);

  // eslint-disable-next-line no-console
  console.log('local gene.asset_id =', gene.asset_id);
  // eslint-disable-next-line no-console
  console.log('local capsule.asset_id =', capsule.asset_id);

  // Clone before handing to buildPublishBundle -- it mutates asset_id.
  const geneClone = JSON.parse(JSON.stringify(gene));
  const capsuleClone = JSON.parse(JSON.stringify(capsule));
  const message = a2a.buildPublishBundle({ gene: geneClone, capsule: capsuleClone });

  // eslint-disable-next-line no-console
  console.log('bundle assets asset_ids =', message.payload.assets.map((a) => a.asset_id));

  const transport = a2a.getTransport();
  const res = await transport.send(message);
  // eslint-disable-next-line no-console
  console.log('send result:', JSON.stringify(res, null, 2));
}

main().catch((e) => { console.error('ERROR:', e.message); console.error(e); process.exit(1); });
