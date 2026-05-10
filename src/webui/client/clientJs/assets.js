'use strict';

exports.assetsJs = `
const ASSET_RENDERERS = {
  genes: (data) => '<table class="data-table"><thead><tr><th>ID</th><th>Category</th><th>Signals</th><th>Strategy</th><th>Validation</th></tr></thead><tbody>' +
    data.map((g) => '<tr><td><strong>' + esc(g.id) + '</strong></td>' +
      '<td><span class="pill ' + esc(g.category) + '">' + esc(g.category) + '</span></td>' +
      '<td>' + pillList(g.signals_match || [], 'signal') + '</td>' +
      '<td><details><summary>' + (g.strategy?.length || 0) + ' steps</summary><ol class="reason-list">' + (g.strategy || []).map(s => '<li>' + esc(s) + '</li>').join('') + '</ol></details></td>' +
      '<td><details><summary>' + (g.validation?.length || 0) + ' cmd(s)</summary><ul class="reason-list">' + (g.validation || []).map(s => '<li><code>' + esc(s) + '</code></li>').join('') + '</ul></details></td>' +
      '</tr>').join('') +
    '</tbody></table>',

  capsules: (data) => data.length
    ? '<table class="data-table"><thead><tr><th>ID</th><th>Gene</th><th>Outcome</th><th>Confidence</th><th>Blast</th></tr></thead><tbody>' +
      data.map((c) => '<tr><td><strong>' + esc(c.id) + '</strong></td><td>' + esc(c.gene || '-') + '</td>' +
        '<td><span class="status-indicator ' + getStatusClass(c.outcome?.status) + '"></span>' + esc(c.outcome?.status || '-') + '</td>' +
        '<td>' + esc(c.confidence ?? '-') + '</td>' +
        '<td>' + esc((c.blast_radius?.files ?? '-') + '/' + (c.blast_radius?.lines ?? '-')) + '</td>' +
        '</tr>').join('') +
      '</tbody></table>'
    : '<p class="muted">No capsules yet. Capsules are created after a successful solidify.</p>',

  events: (data) => data.length
    ? '<ul class="event-list">' + data.map((e) => '<li>' +
      '<div><strong>' + esc(e.id || '-') + '</strong> <span class="muted small">' + esc(formatTime(e.timestamp || e.created_at)) + '</span></div>' +
      '<div>signals: ' + pillList(e.signals || e.signals_matched || [], 'signal') + '</div>' +
      '<div>genes_used: ' + pillList(e.genes_used || [], '') + '</div>' +
      '<div>outcome: <span class="status-indicator ' + getStatusClass(e.outcome?.status) + '"></span>' + esc(e.outcome?.status || '-') + '</div>' +
      '</li>').join('') + '</ul>'
    : '<p class="muted">No solidified events yet. Run <code>evolver solidify</code> to produce events.</p>',

  candidates: (data) => data.length
    ? '<table class="data-table"><thead><tr><th>Source</th><th>Asset ID</th><th>Score</th><th>Time</th></tr></thead><tbody>' +
      data.map((c) => '<tr><td>' + esc(c.source || c.source_node_id || '-') + '</td>' +
        '<td><code>' + esc(c.asset_id || c.id || '-') + '</code></td>' +
        '<td>' + esc(c.score ?? '-') + '</td>' +
        '<td>' + esc(formatTime(c.timestamp)) + '</td></tr>').join('') +
      '</tbody></table>'
    : '<p class="muted">No candidates collected yet.</p>',

  calls: (data) => data.length
    ? '<table class="data-table"><thead><tr><th>Time</th><th>Action</th><th>Asset</th><th>Run</th><th>Score</th></tr></thead><tbody>' +
      data.map((c) => '<tr><td>' + esc(formatTime(c.timestamp)) + '</td>' +
        '<td><span class="pill ' + esc(c.action) + '">' + esc(c.action) + '</span></td>' +
        '<td><code>' + esc(c.asset_id || '-') + '</code></td>' +
        '<td>' + esc(c.run_id || '-') + '</td>' +
        '<td>' + esc(c.score ?? '-') + '</td></tr>').join('') +
      '</tbody></table>'
    : '<p class="muted">No asset calls recorded.</p>',
};

const ASSET_ENDPOINTS = {
  genes: '/webui/assets/genes',
  capsules: '/webui/assets/capsules',
  events: '/webui/assets/events',
  candidates: '/webui/assets/candidates',
  calls: '/webui/assets/calls',
};

async function loadAsset(kind) {
  state.currentAsset = kind;
  $('asset-list').innerHTML = '<p class="muted">Loading ' + esc(kind) + '...</p>';
  document.querySelectorAll('.asset-tab').forEach((b) => b.classList.toggle('active', b.getAttribute('data-asset') === kind));
  try {
    const result = await api(ASSET_ENDPOINTS[kind] + '?limit=200');
    const renderer = ASSET_RENDERERS[kind];
    const total = result.pagination?.totalItems ?? (result.data || []).length;
    $('asset-list').innerHTML =
      '<div class="muted small" style="margin-bottom:12px">' + total + ' record(s)</div>' +
      renderer(result.data || []);
  } catch (err) {
    $('asset-list').innerHTML = '<p class="status-failed">Failed: ' + esc(err.message) + '</p>';
  }
}
`;
