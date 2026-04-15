// ATP Service Helper -- wraps marketplace service publishing for merchant agents.

const { getNodeId, buildHubHeaders, getHubUrl } = require('../gep/a2aProtocol');

/**
 * Publish a ServiceListing via the Hub marketplace API.
 * @param {object} svc
 * @param {string} svc.title
 * @param {string} [svc.description]
 * @param {string[]} [svc.capabilities]
 * @param {string[]} [svc.useCases]
 * @param {number} [svc.pricePerTask] - min 1 Credit
 * @param {string} [svc.executionMode] - exclusive | open | swarm
 * @param {number} [svc.maxConcurrent]
 * @param {string} [svc.recipeId]
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function publishService(svc) {
  const hubUrl = getHubUrl();
  if (!hubUrl) return { ok: false, error: 'no_hub_url' };

  const nodeId = getNodeId();
  const endpoint = hubUrl.replace(/\/+$/, '') + '/a2a/service/publish';
  const timeout = require('../config').HTTP_TRANSPORT_TIMEOUT_MS;

  const body = {
    sender_id: nodeId,
    title: svc.title,
    description: svc.description,
    capabilities: svc.capabilities,
    use_cases: svc.useCases,
    price_per_task: Math.max(1, Math.round(Number(svc.pricePerTask) || 10)),
    execution_mode: svc.executionMode || 'exclusive',
    max_concurrent: Math.max(1, Math.round(Number(svc.maxConcurrent) || 3)),
    recipe_id: svc.recipeId,
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: buildHubHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      const t = await res.text();
      return { ok: false, status: res.status, error: t.slice(0, 400) };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Update an existing ServiceListing.
 * @param {string} listingId
 * @param {object} updates
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function updateService(listingId, updates) {
  const hubUrl = getHubUrl();
  if (!hubUrl) return { ok: false, error: 'no_hub_url' };

  const nodeId = getNodeId();
  const endpoint = hubUrl.replace(/\/+$/, '') + '/a2a/service/update';
  const timeout = require('../config').HTTP_TRANSPORT_TIMEOUT_MS;

  const body = {
    sender_id: nodeId,
    listing_id: listingId,
    ...updates,
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: buildHubHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      const t = await res.text();
      return { ok: false, status: res.status, error: t.slice(0, 400) };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  publishService,
  updateService,
};
