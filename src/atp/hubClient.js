// ATP (Agent Transaction Protocol) Hub Client
// Wraps /a2a/atp/* endpoints for evolver-based agents.
// Uses the same _hubPost/_hubGet pattern as a2aProtocol.js.

const { getHubUrl, buildHubHeaders, getNodeId } = require('../gep/a2aProtocol');

function _hubPost(pathSuffix, body, timeoutMs) {
  const hubUrl = getHubUrl();
  if (!hubUrl) return Promise.resolve({ ok: false, error: 'no_hub_url' });
  const endpoint = hubUrl.replace(/\/+$/, '') + pathSuffix;
  const timeout = timeoutMs || require('../config').HTTP_TRANSPORT_TIMEOUT_MS;
  return fetch(endpoint, {
    method: 'POST',
    headers: buildHubHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
    .then(function (res) {
      if (!res.ok) return res.text().then(function (t) { return { ok: false, status: res.status, error: t.slice(0, 400) }; });
      return res.json().then(function (data) { return { ok: true, data: data }; });
    })
    .catch(function (err) { return { ok: false, error: err.message }; });
}

function _hubGet(pathSuffix, timeoutMs) {
  const hubUrl = getHubUrl();
  if (!hubUrl) return Promise.resolve({ ok: false, error: 'no_hub_url' });
  const endpoint = hubUrl.replace(/\/+$/, '') + pathSuffix;
  const timeout = timeoutMs || require('../config').HTTP_TRANSPORT_TIMEOUT_MS;
  return fetch(endpoint, {
    method: 'GET',
    headers: buildHubHeaders(),
    signal: AbortSignal.timeout(timeout),
  })
    .then(function (res) {
      if (!res.ok) return res.text().then(function (t) { return { ok: false, status: res.status, error: t.slice(0, 400) }; });
      return res.json().then(function (data) { return { ok: true, data: data }; });
    })
    .catch(function (err) { return { ok: false, error: err.message }; });
}

/**
 * POST /a2a/atp/order -- place an ATP order with routing
 * @param {object} opts
 * @param {string[]} opts.capabilities - required capabilities
 * @param {number} opts.budget - max credits to spend
 * @param {string} [opts.routingMode] - fastest | cheapest | auction | swarm
 * @param {string} [opts.verifyMode] - auto | ai_judge | bilateral
 * @param {string} [opts.question] - order description
 * @param {string[]} [opts.signals] - matching signals
 * @param {number} [opts.minReputation] - minimum merchant reputation
 */
function placeOrder(opts) {
  const nodeId = getNodeId();
  return _hubPost('/a2a/atp/order', {
    sender_id: nodeId,
    capabilities: opts.capabilities,
    budget: Math.max(1, Math.round(Number(opts.budget) || 10)),
    routing_mode: opts.routingMode || 'fastest',
    verify_mode: opts.verifyMode || 'auto',
    question: opts.question,
    signals: opts.signals,
    min_reputation: opts.minReputation,
  });
}

/**
 * POST /a2a/atp/deliver -- submit delivery proof for an order
 * @param {string} orderId
 * @param {object} proofPayload - delivery evidence (result, output, pass_rate, etc.)
 */
function submitDelivery(orderId, proofPayload) {
  const nodeId = getNodeId();
  return _hubPost('/a2a/atp/deliver', {
    sender_id: nodeId,
    order_id: orderId,
    proof_payload: proofPayload || {},
  });
}

/**
 * POST /a2a/atp/verify -- confirm or trigger AI judge verification
 * @param {string} orderId
 * @param {string} action - 'confirm' | 'ai_judge'
 */
function verifyDelivery(orderId, action) {
  const nodeId = getNodeId();
  return _hubPost('/a2a/atp/verify', {
    sender_id: nodeId,
    order_id: orderId,
    action: action || 'confirm',
  });
}

/**
 * POST /a2a/atp/settle -- force settlement
 * @param {string} orderId
 */
function settleOrder(orderId) {
  const nodeId = getNodeId();
  return _hubPost('/a2a/atp/settle', {
    sender_id: nodeId,
    order_id: orderId,
  });
}

/**
 * POST /a2a/atp/dispute -- raise a dispute
 * @param {string} orderId
 * @param {string} reason - dispute reason (min 10 chars)
 */
function disputeOrder(orderId, reason) {
  const nodeId = getNodeId();
  return _hubPost('/a2a/atp/dispute', {
    sender_id: nodeId,
    order_id: orderId,
    reason: reason,
  });
}

/**
 * GET /a2a/atp/merchant/tier?node_id=... -- query merchant tier
 * @param {string} [nodeId] - defaults to own node
 */
function getMerchantTier(nodeId) {
  const nid = nodeId || getNodeId();
  return _hubGet('/a2a/atp/merchant/tier?node_id=' + encodeURIComponent(nid));
}

/**
 * GET /a2a/atp/order/:orderId -- check order status
 * @param {string} orderId
 */
function getOrderStatus(orderId) {
  return _hubGet('/a2a/atp/order/' + encodeURIComponent(orderId));
}

/**
 * GET /a2a/atp/proofs?node_id=...&role=... -- list delivery proofs
 * @param {object} [opts]
 * @param {string} [opts.role] - merchant | consumer
 * @param {string} [opts.status] - pending | verified | disputed | settled
 * @param {number} [opts.limit]
 */
function listProofs(opts) {
  const params = new URLSearchParams();
  params.set('node_id', getNodeId());
  if (opts && opts.role) params.set('role', opts.role);
  if (opts && opts.status) params.set('status', opts.status);
  if (opts && opts.limit) params.set('limit', String(opts.limit));
  return _hubGet('/a2a/atp/proofs?' + params.toString());
}

/**
 * GET /a2a/atp/policy -- get ATP policy config
 */
function getAtpPolicy() {
  return _hubGet('/a2a/atp/policy');
}

module.exports = {
  placeOrder,
  submitDelivery,
  verifyDelivery,
  settleOrder,
  disputeOrder,
  getMerchantTier,
  getOrderStatus,
  listProofs,
  getAtpPolicy,
};
