'use strict';

exports.interactionsJs = `
const HUB_ACTIVITY_STATE = { layer: 'all', hideHeartbeats: true, events: [] };
const SNAPSHOT_SERVICE_META = {
  status: {
    title: 'snapshot.status.title',
    description: 'snapshot.status.description',
    features: 'snapshot.status.features',
    endpoint: '/proxy/status',
  },
  hubStatus: {
    title: 'snapshot.hubStatus.title',
    description: 'snapshot.hubStatus.description',
    features: 'snapshot.hubStatus.features',
    endpoint: '/proxy/hub-status',
  },
  taskMetrics: {
    title: 'snapshot.taskMetrics.title',
    description: 'snapshot.taskMetrics.description',
    features: 'snapshot.taskMetrics.features',
    endpoint: '/task/metrics',
  },
  assetSubmissions: {
    title: 'snapshot.assetSubmissions.title',
    description: 'snapshot.assetSubmissions.description',
    features: 'snapshot.assetSubmissions.features',
    endpoint: '/asset/submissions?limit=20',
  },
  sessions: {
    title: 'snapshot.sessions.title',
    description: 'snapshot.sessions.description',
    features: 'snapshot.sessions.features',
    endpoint: '/session/list?limit=20',
  },
  dms: {
    title: 'snapshot.dms.title',
    description: 'snapshot.dms.description',
    features: 'snapshot.dms.features',
    endpoint: '/dm/list?limit=20',
  },
  atpPolicy: {
    title: 'snapshot.atpPolicy.title',
    description: 'snapshot.atpPolicy.description',
    features: 'snapshot.atpPolicy.features',
    endpoint: '/atp/policy',
  },
  atpProofs: {
    title: 'snapshot.atpProofs.title',
    description: 'snapshot.atpProofs.description',
    features: 'snapshot.atpProofs.features',
    endpoint: '/atp/proofs?limit=20',
  },
};

function buildHubActivityEvents(calls, atpProofs, atpOrders, lifecycleEvents) {
  const events = [];
  (lifecycleEvents || []).forEach((e) => events.push({
    layer: 'lifecycle',
    time: e.ts,
    kind: e.kind,
    outcome: e.outcome,
    statusCode: e.status_code,
    latencyMs: e.latency_ms,
    error: e.error,
    title: e.kind === 'fetch' && e.extra?.skill_id ? 'skill: ' + e.extra.skill_id : (e.node_id || '-'),
  }));
  (calls || []).forEach((c) => events.push({
    layer: 'asset',
    time: c.timestamp,
    kind: c.action,
    outcome: inferAssetOutcome(c.action),
    title: c.asset_id || c.reason || '-',
    meta: c.run_id ? t('table.run') + ' ' + c.run_id : null,
    score: c.score,
  }));
  (atpProofs || []).forEach((p) => events.push({
    layer: 'atp',
    time: p.created_at || p.timestamp,
    kind: 'proof_' + (p.status || 'pending'),
    outcome: p.status === 'verified' || p.status === 'accepted' ? 'ok' : (p.status || 'pending'),
    title: p.delivery_id || p.order_id || '-',
    meta: (p.role || 'consumer') + (p.amount != null ? ' · ' + p.amount + ' credits' : ''),
  }));
  (atpOrders || []).forEach((o) => events.push({
    layer: 'atp',
    time: o.created_at || o.updated_at,
    kind: 'order_' + (o.status || 'pending'),
    outcome: o.status === 'completed' ? 'ok' : (o.status || 'pending'),
    title: o.order_id || o.id || '-',
    meta: (o.routing || '-') + (o.budget != null ? ' · ' + o.budget + ' credits' : ''),
  }));
  return events.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
}

function inferAssetOutcome(action) {
  if (!action) return 'unknown';
  if (action.endsWith('_hit') || action === 'asset_reuse' || action === 'asset_reference' || action === 'asset_publish') return 'ok';
  if (action.endsWith('_miss') || action.endsWith('_skip')) return 'miss';
  return action;
}

function summarizeHubActivity(events) {
  const now = Date.now();
  const last24h = events.filter((e) => Date.parse(e.time || 0) >= now - 24 * 60 * 60 * 1000);
  const heartbeats = events.filter((e) => e.layer === 'lifecycle' && e.kind === 'heartbeat');
  const heartbeatOk = heartbeats.filter((e) => e.outcome === 'ok' || e.outcome === 'recovered');
  const heartbeatHealthPct = heartbeats.length === 0 ? null : Math.round((heartbeatOk.length / heartbeats.length) * 100);
  const latencies = events.filter((e) => typeof e.latencyMs === 'number').map((e) => e.latencyMs);
  const lastHelloOk = events.find((e) => e.layer === 'lifecycle' && e.kind === 'hello' && e.outcome === 'ok')?.time;
  const lastHeartbeatOk = events.find((e) => e.layer === 'lifecycle' && e.kind === 'heartbeat' && (e.outcome === 'ok' || e.outcome === 'recovered'))?.time;
  const assetEvents = events.filter((e) => e.layer === 'asset');
  const assetHits = assetEvents.filter((e) => e.outcome === 'ok').length;
  const assetHitRate = assetEvents.length === 0 ? null : Math.round((assetHits / assetEvents.length) * 100);

  return {
    total: events.length,
    last24h: last24h.length,
    heartbeatHealthPct,
    assetHitRate,
    lastHelloOk,
    lastHeartbeatOk,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
  };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

function renderHubActivity(events, hasProxy) {
  HUB_ACTIVITY_STATE.events = events;
  HUB_ACTIVITY_STATE.hasProxy = !!hasProxy;
  renderHubActivitySummary(summarizeHubActivity(events));
  bindHubActivityFilters();
  renderHubActivityTable();
}

function renderHubActivitySummary(s) {
  const healthCls = s.heartbeatHealthPct == null ? '' : s.heartbeatHealthPct >= 95 ? 'success' : s.heartbeatHealthPct >= 70 ? 'pending' : 'failed';
  const hitCls = s.assetHitRate == null ? '' : s.assetHitRate >= 50 ? 'success' : s.assetHitRate >= 20 ? 'pending' : 'failed';
  $('hub-activity-summary').innerHTML =
    statBox(t('label.heartbeatHealth'), s.heartbeatHealthPct == null ? '—' : s.heartbeatHealthPct + '%', healthCls) +
    statBox(t('label.assetHitRate'), s.assetHitRate == null ? '—' : s.assetHitRate + '%', hitCls) +
    statBox(t('label.events24h'), String(s.last24h ?? 0)) +
    statBox(t('label.latencyP50P95'), s.latencyP50 == null ? '—' : (s.latencyP50 + ' / ' + (s.latencyP95 ?? '—') + ' ms')) +
    statBox(t('label.lastHelloOk'), formatTime(s.lastHelloOk)) +
    statBox(t('label.lastHeartbeatOk'), formatTime(s.lastHeartbeatOk));
}

function bindHubActivityFilters() {
  const bar = $('hub-activity-filters');
  if (!bar) return;
  bar.style.display = HUB_ACTIVITY_STATE.events.length ? 'flex' : 'none';
  bar.querySelectorAll('[data-filter-layer]').forEach((btn) => {
    if (btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', () => {
      HUB_ACTIVITY_STATE.layer = btn.getAttribute('data-filter-layer');
      bar.querySelectorAll('[data-filter-layer]').forEach((b) => b.classList.toggle('active', b === btn));
      renderHubActivityTable();
    });
  });
  const cb = $('hide-heartbeats');
  if (cb && !cb._bound) {
    cb._bound = true;
    cb.checked = HUB_ACTIVITY_STATE.hideHeartbeats;
    cb.addEventListener('change', () => {
      HUB_ACTIVITY_STATE.hideHeartbeats = cb.checked;
      renderHubActivityTable();
    });
  }
}

function renderHubActivityTable() {
  const filtered = HUB_ACTIVITY_STATE.events.filter((e) => {
    if (HUB_ACTIVITY_STATE.layer !== 'all' && e.layer !== HUB_ACTIVITY_STATE.layer) return false;
    if (HUB_ACTIVITY_STATE.hideHeartbeats && e.layer === 'lifecycle' && e.kind === 'heartbeat' && (e.outcome === 'ok' || e.outcome === 'recovered')) return false;
    return true;
  }).slice(0, 150);

  if (!filtered.length) {
    $('hub-activity').innerHTML = HUB_ACTIVITY_STATE.events.length
      ? '<p class="muted">' + t('message.noFilterEvents') + '</p>'
      : hubEmptyHint(HUB_ACTIVITY_STATE.hasProxy);
    return;
  }

  const rows = filtered.map((e) => {
    const ok = e.outcome === 'ok' || e.outcome === 'recovered';
    const fail = e.outcome && (String(e.outcome).startsWith('fail') || String(e.outcome).startsWith('auth_failed') || String(e.outcome).startsWith('http_'));
    const cls = ok ? 'ok' : fail ? 'fail' : 'neutral';
    return '<tr class="' + cls + '">' +
      '<td>' + esc(formatTime(e.time)) + '</td>' +
      '<td><span class="pill ' + esc(e.layer) + '">' + esc(t('filter.' + e.layer, {}, e.layer)) + '</span></td>' +
      '<td><span class="pill ' + esc(e.kind || '-') + '">' + esc(e.kind || '-') + '</span></td>' +
      '<td><span class="status-indicator ' + (ok ? 'status-success' : fail ? 'status-failed' : 'status-skipped') + '"></span>' + esc(valueLabel(e.outcome || '-')) + '</td>' +
      '<td>' + (e.statusCode ?? '—') + '</td>' +
      '<td>' + (e.latencyMs == null ? '—' : e.latencyMs + ' ms') + '</td>' +
      '<td class="lifecycle-error">' + esc(e.title || '') + (e.meta ? ' <span class="muted small">' + esc(e.meta) + '</span>' : '') + (e.error ? ' <span class="status-failed">' + esc(e.error) + '</span>' : '') + '</td>' +
      '</tr>';
  }).join('');

  $('hub-activity').innerHTML = '<table class="data-table lifecycle-table">' +
    tableHeader(['table.time', 'table.layer', 'table.kind', 'table.outcome', 'table.status', 'table.latency', 'table.detail']) +
    '<tbody>' + rows + '</tbody></table>';
}

function hubEmptyHint(hasProxy) {
  if (hasProxy) {
    return '<p class="muted">' + t('message.proxyRunningNoHub') + '</p>';
  }
  return '<p class="muted">' + t('message.noHubActivity') + '</p>';
}

function renderAgentStream(mailbox, sessions, dms) {
  const items = [];
  (mailbox || []).forEach((m) => items.push({
    kind: 'mailbox',
    time: m.timestamp,
    action: 'mb_' + (m.direction || 'msg'),
    title: m.summary || m.type || '-',
    meta: (m.type || '-') + ' · ' + (m.status || '-'),
    detail: m,
  }));
  (sessions || []).forEach((s) => items.push({
    kind: 'session',
    time: s.created_at || s.updated_at,
    action: 'session_' + (s.status || 'active'),
    title: s.session_id || s.id || '-',
    meta: t('label.withPeer') + ' ' + (s.peer || s.peer_node_id || '-'),
    detail: s,
  }));
  (dms || []).forEach((d) => items.push({
    kind: 'dm',
    time: d.created_at,
    action: 'dm_' + (d.direction || 'msg'),
    title: d.title || d.message_id || '-',
    meta: (d.from || '-') + ' → ' + (d.to || '-'),
    detail: d,
  }));

  if (!items.length) {
    $('agent-stream').innerHTML = '<p class="muted">' + t('message.noAgentInteractions') + '</p>';
    return;
  }
  items.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
  $('agent-stream').innerHTML = '<ul class="stream-list">' + items.slice(0, 60).map(streamItem).join('') + '</ul>';
}

function streamItem(item) {
  return '<li class="stream-item">' +
    '<div class="stream-head">' +
      '<span class="pill ' + esc(item.action) + '">' + esc(item.action) + '</span>' +
      '<span class="muted small">' + esc(formatTime(item.time)) + '</span>' +
    '</div>' +
    '<div class="stream-title">' + esc(item.title) + '</div>' +
    '<div class="muted small">' + esc(item.meta) + '</div>' +
    '</li>';
}

function renderInteractionCharts(calls, atpProofs, mailbox) {
  const textColor = chartTextColor();
  const isDark = isDarkMode();

  const actionCounts = {};
  (calls || []).forEach((c) => { actionCounts[c.action] = (actionCounts[c.action] || 0) + 1; });
  ensureChart('hubActionChart')?.setOption({
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      itemStyle: { borderRadius: 4, borderColor: isDark ? '#181b1f' : '#fff', borderWidth: 2 },
      label: { show: false },
      labelLine: { show: false },
      data: Object.keys(actionCounts).length
        ? Object.entries(actionCounts).map(([name, value]) => ({ name, value }))
        : [{ name: t('value.no_calls'), value: 1, itemStyle: { color: '#444' } }],
    }],
  });

  const dayBuckets = bucketByDay([...(calls || []), ...(atpProofs || []), ...(mailbox || [])], 30);
  ensureChart('activityChart')?.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '8%', containLabel: true },
    xAxis: { type: 'category', data: dayBuckets.labels, axisLabel: { color: textColor, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: textColor }, splitLine: { lineStyle: { color: isDark ? '#2c3235' : '#e4e7eb' } } },
    series: [{
      type: 'line', data: dayBuckets.values, smooth: true, areaStyle: { opacity: 0.18, color: '#3274d9' },
      lineStyle: { color: '#3274d9', width: 2 }, itemStyle: { color: '#3274d9' },
    }],
  });

  const typeCounts = {};
  (mailbox || []).forEach((m) => { typeCounts[m.type || 'unknown'] = (typeCounts[m.type || 'unknown'] || 0) + 1; });
  ensureChart('mailboxChart')?.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '5%', containLabel: true },
    xAxis: { type: 'value', axisLabel: { color: textColor }, splitLine: { lineStyle: { color: isDark ? '#2c3235' : '#e4e7eb' } } },
    yAxis: { type: 'category', data: Object.keys(typeCounts).length ? Object.keys(typeCounts) : [t('value.no_messages')], axisLabel: { color: textColor } },
    series: [{
      type: 'bar',
      data: Object.keys(typeCounts).length ? Object.values(typeCounts) : [0],
      itemStyle: { color: '#28a745', borderRadius: [0, 4, 4, 0] },
    }],
  });
}

function bucketByDay(items, days) {
  const today = new Date(); today.setHours(0,0,0,0);
  const labels = [], counts = new Array(days).fill(0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    labels.push((d.getMonth()+1) + '/' + d.getDate());
  }
  items.forEach((it) => {
    const t = new Date(it.timestamp || it.time || it.created_at || 0);
    if (isNaN(t.getTime())) return;
    t.setHours(0,0,0,0);
    const diff = Math.round((today - t) / 86400000);
    if (diff >= 0 && diff < days) counts[days - 1 - diff]++;
  });
  return { labels, values: counts };
}

function renderProxySnapshots(snapshots) {
  if (!snapshots || !Object.keys(snapshots).length) {
    $('proxy-snapshots').innerHTML = proxyStartEmptyMarkup();
    bindProxyStartButton();
    return;
  }
  $('proxy-snapshots').innerHTML = Object.entries(snapshots).map(([key, snap]) => {
    const dot = '<span class="status-indicator ' + snapshotStatusClass(snap) + '"></span>';
    return '<div class="snapshot-card">' +
      '<button class="snapshot-detail-button" type="button" data-snapshot-detail="' + esc(key) + '" title="' + esc(t('action.viewDetails')) + '" aria-label="' + esc(t('action.viewDetails')) + '">i</button>' +
      '<div class="snapshot-card-title">' + dot + '<strong>' + esc(snapshotServiceTitle(key)) + '</strong></div>' +
      '<div class="muted small">' + esc(snapshotSummary(snap)) + '</div></div>';
  }).join('');
  bindSnapshotDetails(snapshots);
}

function proxyStartEmptyMarkup() {
  return '<div class="proxy-start snapshot-empty">' +
    '<p class="muted">' + t('message.proxyNotRunningSnapshots') + '</p>' +
    '<div class="proxy-start-actions">' +
      '<button id="proxy-start-button" type="button">' + esc(t('action.startProxy')) + '</button>' +
      '<span id="proxy-start-status" class="muted small proxy-start-status">' + esc(t('message.proxyStartHint')) + '</span>' +
    '</div>' +
    '</div>';
}

function bindProxyStartButton() {
  const button = $('proxy-start-button');
  const status = $('proxy-start-status');
  if (!button || !status || button._bound) return;
  button._bound = true;
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.className = 'muted small proxy-start-status';
    status.textContent = t('message.proxyStarting');
    try {
      const result = await apiPost('/webui/proxy/start', {});
      status.className = 'small proxy-start-status success';
      status.textContent = result.alreadyRunning ? t('message.proxyAlreadyRunning') : t('message.proxyStarted');
      await loadInteractions();
    } catch (err) {
      status.className = 'small proxy-start-status error';
      status.textContent = t('message.proxyStartFailed', { message: err.message });
      button.disabled = false;
    }
  });
}

function snapshotServiceMeta(key) {
  return SNAPSHOT_SERVICE_META[key] || {
    title: '',
    description: 'snapshot.unknown.description',
    features: 'snapshot.unknown.features',
    endpoint: '-',
  };
}

function snapshotServiceTitle(key) {
  const meta = snapshotServiceMeta(key);
  return meta.title ? t(meta.title, {}, key) : key;
}

function snapshotServiceFeatures(key) {
  const raw = t(snapshotServiceMeta(key).features, {}, '');
  return String(raw || '').split('|').map((item) => item.trim()).filter(Boolean);
}

function isHubNotConfiguredSnapshot(snap) {
  const text = String(snap?.error || snap?.body?.error || snap?.body?.status || snap?.body?.note || '');
  return snap?.body?.hub_configured === false || /hub[_ ]not[_ ]configured|Hub not configured/i.test(text);
}

function snapshotStatusClass(snap) {
  if (!snap || !snap.ok) return 'status-failed';
  if (isHubNotConfiguredSnapshot(snap)) return 'status-warning';
  if (snap.body && snap.body.error) return 'status-warning';
  return 'status-success';
}

function snapshotStateLabel(snap) {
  if (!snap || !snap.ok) return t('state.unavailable');
  if (isHubNotConfiguredSnapshot(snap)) return t('state.hubNotConfigured');
  if (snap.body && snap.body.error) return valueLabel(snap.body.error);
  return t('state.available');
}

function snapshotSummary(snap) {
  if (!snap) return t('message.unavailable');
  if (!snap.ok) return snap.error || snap.body?.error || t('message.unavailable');
  if (isHubNotConfiguredSnapshot(snap)) return t('message.hubNotConfigured');
  if (snap.body && snap.body.error) return valueLabel(snap.body.error);
  if (!snap.body) return t('message.noSnapshotBody');
  if (Array.isArray(snap.body)) return t('message.itemsWithCount', { count: snap.body.length });
  if (typeof snap.body === 'object') {
    if (typeof snap.body.count === 'number') return t('message.itemsWithCount', { count: snap.body.count });
    return t('message.fieldsWithCount', { count: Object.keys(snap.body).length });
  }
  return String(snap.body);
}

function bindSnapshotDetails(snapshots) {
  document.querySelectorAll('[data-snapshot-detail]').forEach((button) => {
    if (button._bound) return;
    button._bound = true;
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-snapshot-detail');
      openSnapshotDetails(key, snapshots[key]);
    });
  });
}

function ensureSnapshotDetailModal() {
  let modal = $('snapshot-detail-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'snapshot-detail-modal';
  modal.className = 'snapshot-modal-backdrop';
  modal.hidden = true;
  modal.innerHTML = '<div class="snapshot-modal" role="dialog" aria-modal="true" aria-labelledby="snapshot-detail-title">' +
    '<button id="snapshot-detail-close" class="snapshot-modal-close" type="button" aria-label="' + esc(t('action.close')) + '">x</button>' +
    '<div class="eyebrow" id="snapshot-detail-eyebrow"></div>' +
    '<h3 id="snapshot-detail-title"></h3>' +
    '<p id="snapshot-detail-description" class="muted"></p>' +
    '<dl class="snapshot-detail-meta">' +
      '<dt id="snapshot-detail-endpoint-label"></dt><dd id="snapshot-detail-endpoint"></dd>' +
      '<dt id="snapshot-detail-state-label"></dt><dd id="snapshot-detail-state"></dd>' +
    '</dl>' +
    '<h4 id="snapshot-detail-features-label"></h4>' +
    '<ul id="snapshot-detail-features" class="snapshot-detail-list"></ul>' +
    '<h4 id="snapshot-detail-payload-label"></h4>' +
    '<pre id="snapshot-detail-payload" class="snapshot-detail-payload"></pre>' +
    '</div>';
  document.body.appendChild(modal);
  $('snapshot-detail-close').addEventListener('click', closeSnapshotDetails);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeSnapshotDetails();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeSnapshotDetails();
  });
  return modal;
}

function openSnapshotDetails(key, snap) {
  const modal = ensureSnapshotDetailModal();
  const meta = snapshotServiceMeta(key);
  $('snapshot-detail-eyebrow').textContent = t('label.proxyService');
  $('snapshot-detail-title').textContent = snapshotServiceTitle(key);
  $('snapshot-detail-description').textContent = t(meta.description, {}, '');
  $('snapshot-detail-endpoint-label').textContent = t('label.endpoint');
  $('snapshot-detail-endpoint').textContent = meta.endpoint || '-';
  $('snapshot-detail-state-label').textContent = t('label.currentState');
  $('snapshot-detail-state').textContent = snapshotStateLabel(snap);
  $('snapshot-detail-features-label').textContent = t('label.serviceFeatures');
  $('snapshot-detail-features').innerHTML = snapshotServiceFeatures(key).map((item) => '<li>' + esc(item) + '</li>').join('');
  $('snapshot-detail-payload-label').textContent = t('label.currentReturn');
  $('snapshot-detail-payload').textContent = snapshotPayloadPreview(snap);
  modal.hidden = false;
  $('snapshot-detail-close').focus();
}

function closeSnapshotDetails() {
  const modal = $('snapshot-detail-modal');
  if (modal) modal.hidden = true;
}

function snapshotPayloadPreview(snap) {
  if (!snap) return t('message.unavailable');
  const source = snap.body === undefined ? snap : snap.body;
  try {
    const json = JSON.stringify(source, null, 2);
    return json.length > 2400 ? json.slice(0, 2400) + '\\n...' : json;
  } catch (_) {
    return String(source);
  }
}

async function loadInteractions() {
  $('hub-activity').innerHTML = '<p class="muted">' + t('state.loading') + '</p>';
  $('agent-stream').innerHTML = '<p class="muted">' + t('state.loading') + '</p>';
  try {
    const [callsResult, interactions, lifecycle] = await Promise.all([
      api('/webui/assets/calls?limit=500'),
      api('/webui/interactions?last=200'),
      api('/webui/lifecycle?last=500'),
    ]);
    const calls = callsResult.data || [];
    const proofs = interactions.proxySnapshots?.atpProofs?.body?.proofs || interactions.proxySnapshots?.atpProofs?.body || [];
    const orders = interactions.proxySnapshots?.atpProofs?.body?.orders || [];
    const sessions = interactions.proxySnapshots?.sessions?.body?.sessions || interactions.proxySnapshots?.sessions?.body || [];
    const dms = interactions.proxySnapshots?.dms?.body?.dms || interactions.proxySnapshots?.dms?.body || [];
    const mailbox = interactions.mailbox?.data || [];
    const lifecycleEvents = lifecycle?.events || [];

    const unified = buildHubActivityEvents(
      calls,
      Array.isArray(proofs) ? proofs : [],
      Array.isArray(orders) ? orders : [],
      lifecycleEvents,
    );
    renderHubActivity(unified, interactions.proxy?.running);
    renderAgentStream(mailbox, Array.isArray(sessions) ? sessions : [], Array.isArray(dms) ? dms : []);
    renderInteractionCharts(calls, Array.isArray(proofs) ? proofs : [], mailbox);
    renderProxySnapshots(interactions.proxySnapshots);
  } catch (err) {
    $('hub-activity').innerHTML = '<p class="status-failed">' + esc(t('message.failed', { message: err.message })) + '</p>';
  }
}

function statBox(label, value, cls) {
  return '<div class="stat-box ' + (cls || '') + '">' +
    '<div class="stat-label">' + esc(label) + '</div>' +
    '<div class="stat-value">' + esc(value) + '</div>' +
    '</div>';
}
`;
