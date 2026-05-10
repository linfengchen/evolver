'use strict';

exports.pipelinesJs = `
function renderRuns(result) {
  const runs = result.data || [];
  const tbody = document.querySelector('#runsTable tbody');
  if (!runs.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No runs recorded yet.</td></tr>';
    renderScoreTrend([]);
    return;
  }
  tbody.innerHTML = runs.map((run) =>
    '<tr data-run="' + esc(run.runId) + '">' +
    '<td><strong>' + esc(run.runId) + '</strong></td>' +
    '<td><span class="status-indicator ' + getStatusClass(run.status) + '"></span>' + esc(run.status) + '</td>' +
    '<td>' + esc(run.selectedGeneId || '-') + '</td>' +
    '<td>' + scoreBar(run.score) + '</td>' +
    '<td>' + esc(formatTime(run.updatedAt)) + '</td>' +
    '</tr>'
  ).join('');
  document.querySelectorAll('#runsTable tbody tr[data-run]').forEach((tr) => {
    tr.addEventListener('click', () => loadRun(tr.getAttribute('data-run')));
  });
  renderScoreTrend(runs);
}

const VALIDATION_DIMENSION_LABELS = {
  stable_no_error: 'Stable (no errors)',
  heuristic_delta: 'Heuristic delta',
  predictive: 'Predictive match',
  failed: 'Failed',
  unstable: 'Unstable',
};

function renderValidationBlock(validation, runStatus) {
  if (!validation) {
    const hint = runStatus === 'review_pending'
      ? 'Run is awaiting review confirmation — local validation has not run yet.'
      : runStatus === 'running' || runStatus === 'pending'
        ? 'Validation will appear here once the solidify phase emits an outcome event.'
        : 'No validation outcome recorded for this run.';
    return '<div class="detail-block"><h4>Validation result</h4><p class="muted small">' + esc(hint) + '</p></div>';
  }
  const score = typeof validation.score === 'number' ? validation.score : null;
  const statusCls = validation.status === 'success' ? 'success' : validation.status === 'failed' ? 'failed' : 'unknown';
  const scoreColor = score === null ? '#888' : score >= 0.7 ? '#28a745' : score >= 0.5 ? '#ffc107' : '#dc3545';
  const dims = (validation.dimensions || []).map((d) =>
    '<span class="pill validation-dim">' + esc(VALIDATION_DIMENSION_LABELS[d] || d) + '</span>'
  ).join('') || '<span class="muted small">no dimensions recorded</span>';

  let html = '<div class="detail-block validation-block"><h4>Validation result</h4>';
  html += '<div class="validation-summary">' +
    '<div class="validation-status"><span class="status-indicator ' + statusCls + '"></span>' +
      '<strong>' + esc(validation.status || 'unknown') + '</strong>' +
    '</div>';
  if (score !== null) {
    html += '<div class="validation-score-wrap">' +
      '<div class="validation-score-label">Score</div>' +
      '<div class="score-bar score-bar-lg">' +
        '<div class="score-bar-fill" style="width:' + (score * 100).toFixed(0) + '%;background:' + scoreColor + '"></div>' +
        '<span class="score-bar-text">' + (score * 100).toFixed(1) + '%</span>' +
      '</div></div>';
  }
  html += '</div>';
  html += '<div class="validation-dims"><span class="muted small">Dimensions:</span> ' + dims + '</div>';
  if (validation.observedSignals && validation.observedSignals.length) {
    html += '<div class="validation-observed"><span class="muted small">Observed signals after run:</span> ' +
      pillList(validation.observedSignals, 'signal') + '</div>';
  }
  if (validation.predictive) {
    const entries = Object.entries(validation.predictive).slice(0, 6);
    html += '<details class="validation-predictive"><summary>Predictive measurements</summary>' + kv(entries) + '</details>';
  }
  if (validation.timestamp) {
    html += '<p class="muted small" style="margin-top:8px">Validated at ' + esc(formatTime(validation.timestamp)) + '</p>';
  }
  html += '</div>';
  return html;
}

function scoreBar(score) {
  if (typeof score !== 'number') return '<span class="muted small">—</span>';
  const pct = Math.round(score * 100);
  const color = score >= 0.7 ? '#28a745' : score >= 0.5 ? '#ffc107' : '#dc3545';
  return '<div class="score-bar" title="' + score.toFixed(3) + '">' +
    '<div class="score-bar-fill" style="width:' + pct + '%;background:' + color + '"></div>' +
    '<span class="score-bar-text">' + pct + '%</span></div>';
}

function renderScoreTrend(runs) {
  const el = document.getElementById('scoreTrendChart');
  if (!el) return;
  const scored = runs.filter((r) => typeof r.score === 'number')
    .sort((a, b) => new Date(a.finishedAt || a.updatedAt) - new Date(b.finishedAt || b.updatedAt));
  if (!scored.length) {
    el.innerHTML = '<p class="muted small" style="padding:24px 0;text-align:center">No scored runs yet — runs only get a score after solidify produces an outcome event.</p>';
    return;
  }
  const chart = echarts.init(el);
  const textColor = chartTextColor();
  chart.setOption({
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const p = params[0];
        const r = scored[p.dataIndex];
        return '<strong>' + r.runId + '</strong><br/>' +
          'Gene: ' + (r.selectedGeneId || '-') + '<br/>' +
          'Score: <strong>' + (r.score || 0).toFixed(3) + '</strong><br/>' +
          formatTime(r.finishedAt || r.updatedAt);
      },
    },
    xAxis: {
      type: 'category',
      data: scored.map((r) => r.runId.slice(-8)),
      axisLabel: { color: textColor, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      min: 0, max: 1,
      axisLabel: { color: textColor, formatter: (v) => (v * 100).toFixed(0) + '%' },
      splitLine: { lineStyle: { color: isDarkMode() ? '#2a3038' : '#e9ecef' } },
    },
    series: [{
      type: 'line',
      smooth: true,
      data: scored.map((r) => r.score),
      areaStyle: { opacity: 0.2 },
      lineStyle: { width: 2, color: '#3274d9' },
      itemStyle: { color: '#3274d9' },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { type: 'dashed', color: '#28a745' },
        data: [{ yAxis: 0.7, label: { formatter: 'pass ≥0.7', color: '#28a745' } }],
      },
    }],
  });
}

function renderRunDetail(run) {
  const phases = run.phases || [];
  const detail = run.detail || {};

  let html = '<div class="run-header">' +
    '<h3>' + esc(run.runId) + '</h3>' +
    '<div class="run-meta">' +
    '<span>Status: <span class="status-indicator ' + getStatusClass(run.status) + '"></span><strong>' + esc(run.status) + '</strong></span>' +
    '<span>Gene: <strong>' + esc(run.selectedGeneId || '-') + '</strong></span>' +
    '<span>Updated: <strong>' + esc(formatTime(run.updatedAt)) + '</strong></span>' +
    '</div></div>';

  html += '<div class="run-body">';

  html += '<div><h4>Pipeline Timeline</h4><ul class="timeline">';
  html += phases.map((phase) => {
    const cls = phase.status === 'success' ? 'success' :
                phase.status === 'failed' ? 'failed' :
                phase.status === 'running' || phase.status === 'pending' ? 'running' :
                phase.status === 'blocked' ? 'blocked' : '';
    return '<li class="' + cls + '">' +
      '<div class="timeline-title">' + esc(phase.phase) + ' <span class="muted small">' + esc(phase.status) + '</span></div>' +
      '<p class="timeline-desc">' + esc(phase.summary) + '</p>' +
      '</li>';
  }).join('');
  html += '</ul></div>';

  html += '<div><h4>Run Graph</h4><div id="runGraph" class="chart-container" style="height: 360px;"></div></div>';

  html += '</div>';

  if (detail) {
    html += '<div class="run-detail-grid">';
    html += '<div class="detail-block"><h4>Trigger signals</h4>' +
      '<p class="muted small" style="margin:-4px 0 8px 0">Environment snapshot detected at run start (used to pick a matching Gene). Not errors.</p>' +
      pillList(detail.signals, 'signal') + '</div>';
    if (detail.selector) {
      html += '<div class="detail-block"><h4>Selector reasoning</h4>' +
        kv([
          ['Selected', detail.selector.selected],
          ['Path', detail.selector.selectionPath || detail.selector.selection_path],
          ['Memory used', detail.selector.memoryUsed || detail.selector.memory_used],
        ]) +
        '<ul class="reason-list">' + (detail.selector.reason || []).map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>' +
        '</div>';
    }
    if (detail.mutation) {
      html += '<div class="detail-block"><h4>Mutation</h4>' + kv([
        ['ID', detail.mutation.id],
        ['Category', detail.mutation.category],
        ['Target type', detail.mutation.targetType],
        ['Strategy steps', detail.mutation.strategySteps],
        ['Trigger signals', (detail.mutation.triggerSignals || []).join(', ') || '-'],
      ]) + '</div>';
    }
    html += renderValidationBlock(detail.validation, run.status);
    if (detail.blastRadius) {
      html += '<div class="detail-block"><h4>Blast radius</h4>' + kv([
        ['Files', detail.blastRadius.files],
        ['Lines', detail.blastRadius.lines],
        ['Risk', detail.blastRadius.risk_level || detail.blastRadius.risk],
      ]) + '</div>';
    }
    if (detail.personalityState) {
      html += '<div class="detail-block"><h4>Personality at run</h4>' + kv(
        Object.entries(detail.personalityState).slice(0, 8)
      ) + '</div>';
    }
    if (detail.initialUserPrompt) {
      html += '<div class="detail-block"><h4>Initial user prompt</h4><pre class="snippet">' + esc(detail.initialUserPrompt) + '</pre></div>';
    }
    html += '</div>';
  }

  $('run-detail').innerHTML = html;

  setTimeout(() => renderRunGraph(run, detail), 0);
}

function renderRunGraph(run, detail) {
  const chartEl = document.getElementById('runGraph');
  if (!chartEl) return;
  const chart = echarts.init(chartEl);
  const textColor = chartTextColor();
  const isDark = isDarkMode();

  const nodes = [{ id: 'Run', name: 'Run\\n' + run.runId.slice(-8), symbolSize: 56, itemStyle: { color: '#3274d9' }, category: 0 }];
  const edges = [];
  const categories = [{ name: 'Run' }, { name: 'Gene' }, { name: 'Signal' }, { name: 'Event' }, { name: 'Asset' }];

  if (run.selectedGeneId) {
    nodes.push({ id: 'Gene', name: 'Gene\\n' + run.selectedGeneId.replace('gene_gep_', ''), symbolSize: 44, itemStyle: { color: '#28a745' }, category: 1 });
    edges.push({ source: 'Run', target: 'Gene' });
  }
  (detail.signals || []).slice(0, 6).forEach((sig, i) => {
    const id = 'Sig' + i;
    nodes.push({ id, name: sig, symbolSize: 30, itemStyle: { color: '#ffc107' }, category: 2 });
    edges.push({ source: id, target: 'Run' });
    if (run.selectedGeneId) edges.push({ source: id, target: 'Gene', lineStyle: { type: 'dashed' } });
  });
  (run.evidence || []).slice(0, 5).forEach((ev, i) => {
    const id = 'Ev' + i;
    nodes.push({ id, name: 'Event\\n' + (ev.id || '').slice(-6), symbolSize: 28, itemStyle: { color: '#dc3545' }, category: 3 });
    edges.push({ source: 'Run', target: id });
  });
  (run.assets || []).slice(0, 5).forEach((a, i) => {
    const id = 'Ast' + i;
    nodes.push({ id, name: a.action || 'asset', symbolSize: 26, itemStyle: { color: '#6f42c1' }, category: 4 });
    edges.push({ source: 'Run', target: id });
  });

  chart.setOption({
    tooltip: {},
    legend: { data: categories.map(c => c.name), bottom: 0, textStyle: { color: textColor } },
    series: [{
      type: 'graph',
      layout: 'force',
      data: nodes,
      links: edges,
      categories,
      roam: true,
      draggable: true,
      cursor: 'grab',
      label: { show: true, color: textColor, fontSize: 10 },
      lineStyle: { color: isDark ? '#5c6975' : '#cdd3da', width: 1.5, curveness: 0.15 },
      force: { repulsion: 220, edgeLength: 90 },
    }],
  });
}

async function loadRun(runId) {
  state.selectedRunId = runId;
  $('run-detail').innerHTML = '<p class="muted">Loading trace...</p>';
  try {
    const run = await api('/webui/runs/' + encodeURIComponent(runId));
    renderRunDetail(run);
  } catch (err) {
    $('run-detail').innerHTML = '<p class="status-failed">Failed to load run: ' + esc(err.message) + '</p>';
  }
}

async function loadPipelines() {
  try {
    const runs = await api('/webui/runs?limit=50');
    renderRuns(runs);
  } catch (err) {
    console.error(err);
  }
}
`;
