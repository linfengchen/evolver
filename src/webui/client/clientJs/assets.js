'use strict';

exports.assetsJs = `
const ASSET_RENDERERS = {
  genes: (data) => '<table class="data-table">' + tableHeader(['table.id', 'table.category', 'table.signals', 'table.strategy', 'table.validation']) + '<tbody>' +
    data.map((g) => '<tr><td><strong>' + esc(g.id) + '</strong></td>' +
      '<td><span class="pill ' + esc(g.category) + '">' + esc(categoryLabel(g.category)) + '</span></td>' +
      '<td>' + pillList(g.signals_match || [], 'signal') + '</td>' +
      '<td><details><summary>' + t('message.stepsWithCount', { count: g.strategy?.length || 0 }) + '</summary><ol class="reason-list">' + (g.strategy || []).map(s => '<li>' + esc(s) + '</li>').join('') + '</ol></details></td>' +
      '<td><details><summary>' + t('message.commandsWithCount', { count: g.validation?.length || 0 }) + '</summary><ul class="reason-list">' + (g.validation || []).map(s => '<li><code>' + esc(s) + '</code></li>').join('') + '</ul></details></td>' +
      '</tr>').join('') +
    '</tbody></table>',

  capsules: (data) => data.length
    ? '<table class="data-table">' + tableHeader(['table.id', 'table.gene', 'table.outcome', 'table.confidence', 'table.blast']) + '<tbody>' +
      data.map((c) => '<tr><td><strong>' + esc(c.id) + '</strong></td><td>' + esc(c.gene || '-') + '</td>' +
        '<td><span class="status-indicator ' + getStatusClass(c.outcome?.status) + '"></span>' + esc(valueLabel(c.outcome?.status || '-')) + '</td>' +
        '<td>' + esc(c.confidence ?? '-') + '</td>' +
        '<td>' + esc((c.blast_radius?.files ?? '-') + '/' + (c.blast_radius?.lines ?? '-')) + '</td>' +
        '</tr>').join('') +
      '</tbody></table>'
    : '<p class="muted">' + t('message.noCapsules') + '</p>',

  events: (data) => data.length
    ? '<ul class="event-list">' + data.map((e) => '<li>' +
      '<div><strong>' + esc(e.id || '-') + '</strong> <span class="muted small">' + esc(formatTime(e.timestamp || e.created_at)) + '</span></div>' +
      '<div>' + t('table.signals') + ': ' + pillList(e.signals || e.signals_matched || [], 'signal') + '</div>' +
      '<div>' + t('label.genesUsed') + ': ' + pillList(e.genes_used || [], '') + '</div>' +
      '<div>' + t('table.outcome') + ': <span class="status-indicator ' + getStatusClass(e.outcome?.status) + '"></span>' + esc(valueLabel(e.outcome?.status || '-')) + '</div>' +
      '</li>').join('') + '</ul>'
    : '<p class="muted">' + t('message.noEvents') + '</p>',

  candidates: (data) => data.length
    ? '<table class="data-table">' + tableHeader(['table.source', 'table.assetId', 'table.score', 'table.time']) + '<tbody>' +
      data.map((c) => '<tr><td>' + esc(c.source || c.source_node_id || '-') + '</td>' +
        '<td><code>' + esc(c.asset_id || c.id || '-') + '</code></td>' +
        '<td>' + esc(c.score ?? '-') + '</td>' +
        '<td>' + esc(formatTime(c.timestamp)) + '</td></tr>').join('') +
      '</tbody></table>'
    : '<p class="muted">' + t('message.noCandidates') + '</p>',

  calls: (data) => data.length
    ? '<table class="data-table">' + tableHeader(['table.time', 'table.action', 'table.asset', 'table.run', 'table.score']) + '<tbody>' +
      data.map((c) => '<tr><td>' + esc(formatTime(c.timestamp)) + '</td>' +
        '<td><span class="pill ' + esc(c.action) + '">' + esc(c.action) + '</span></td>' +
        '<td><code>' + esc(c.asset_id || '-') + '</code></td>' +
        '<td>' + esc(c.run_id || '-') + '</td>' +
        '<td>' + esc(c.score ?? '-') + '</td></tr>').join('') +
      '</tbody></table>'
    : '<p class="muted">' + t('message.noAssetCalls') + '</p>',
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
  $('asset-list').innerHTML = '<p class="muted">' + t('message.loadingKind', { kind: assetKindLabel(kind) }) + '</p>';
  document.querySelectorAll('.asset-tab').forEach((b) => b.classList.toggle('active', b.getAttribute('data-asset') === kind));
  try {
    const result = await api(ASSET_ENDPOINTS[kind] + '?limit=200');
    const renderer = ASSET_RENDERERS[kind];
    const total = result.pagination?.totalItems ?? (result.data || []).length;
    $('asset-list').innerHTML =
      '<div class="muted small" style="margin-bottom:12px">' + t('message.recordCount', { count: total }) + '</div>' +
      renderer(result.data || []);
  } catch (err) {
    $('asset-list').innerHTML = '<p class="status-failed">' + esc(t('message.failed', { message: err.message })) + '</p>';
  }
}
`;
