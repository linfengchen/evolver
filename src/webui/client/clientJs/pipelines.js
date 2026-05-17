'use strict';

exports.pipelinesJs = `
function renderRuns(result) {
  const runs = result.data || [];
  const tbody = document.querySelector('#runsTable tbody');
  if (!runs.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">' + t('message.noRuns') + '</td></tr>';
    renderScoreTrend([]);
    return;
  }
  tbody.innerHTML = runs.map((run) =>
    '<tr data-run="' + esc(run.runId) + '">' +
    '<td><strong>' + esc(run.runId) + '</strong></td>' +
    '<td><span class="status-indicator ' + getStatusClass(run.status) + '"></span>' + esc(valueLabel(run.status)) + '</td>' +
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
      ? t('message.validationReviewPending')
      : runStatus === 'running' || runStatus === 'pending'
        ? t('message.validationPending')
        : t('message.validationMissing');
    return '<div class="detail-block"><h4>' + t('section.validationResult') + '</h4><p class="muted small">' + esc(hint) + '</p></div>';
  }
  const score = typeof validation.score === 'number' ? validation.score : null;
  const statusCls = getStatusClass(validation.status);
  const scoreColor = score === null ? '#888' : score >= 0.7 ? '#28a745' : score >= 0.5 ? '#ffc107' : '#dc3545';
  const dims = (validation.dimensions || []).map((d) =>
    '<span class="pill validation-dim">' + esc(validationLabel(d)) + '</span>'
  ).join('') || '<span class="muted small">' + t('message.noDimensions') + '</span>';

  let html = '<div class="detail-block validation-block"><h4>' + t('section.validationResult') + '</h4>';
  html += '<div class="validation-summary">' +
    '<div class="validation-status"><span class="status-indicator ' + statusCls + '"></span>' +
      '<strong>' + esc(valueLabel(validation.status || 'unknown')) + '</strong>' +
    '</div>';
  if (score !== null) {
    html += '<div class="validation-score-wrap">' +
      '<div class="validation-score-label">' + t('table.score') + '</div>' +
      '<div class="score-bar score-bar-lg">' +
        '<div class="score-bar-fill" style="width:' + (score * 100).toFixed(0) + '%;background:' + scoreColor + '"></div>' +
        '<span class="score-bar-text">' + (score * 100).toFixed(1) + '%</span>' +
      '</div></div>';
  }
  html += '</div>';
  html += '<div class="validation-dims"><span class="muted small">' + t('label.dimensions') + ':</span> ' + dims + '</div>';
  if (validation.observedSignals && validation.observedSignals.length) {
    html += '<div class="validation-observed"><span class="muted small">' + t('label.observedSignals') + ':</span> ' +
      pillList(validation.observedSignals, 'signal') + '</div>';
  }
  if (validation.predictive) {
    const entries = Object.entries(validation.predictive).slice(0, 6);
    html += '<details class="validation-predictive"><summary>' + t('message.predictiveMeasurements') + '</summary>' + kv(entries) + '</details>';
  }
  if (validation.timestamp) {
    html += '<p class="muted small" style="margin-top:8px">' + t('label.validatedAt') + ' ' + esc(formatTime(validation.timestamp)) + '</p>';
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
    el.innerHTML = '<p class="muted small" style="padding:24px 0;text-align:center">' + t('message.noScoredRuns') + '</p>';
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
          t('table.gene') + ': ' + (r.selectedGeneId || '-') + '<br/>' +
          t('table.score') + ': <strong>' + (r.score || 0).toFixed(3) + '</strong><br/>' +
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
        data: [{ yAxis: 0.7, label: { formatter: t('value.pass') + ' >=0.7', color: '#28a745' } }],
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
    '<span>' + t('table.status') + ': <span class="status-indicator ' + getStatusClass(run.status) + '"></span><strong>' + esc(valueLabel(run.status)) + '</strong></span>' +
    '<span>' + t('table.gene') + ': <strong>' + esc(run.selectedGeneId || '-') + '</strong></span>' +
    '<span>' + t('table.updated') + ': <strong>' + esc(formatTime(run.updatedAt)) + '</strong></span>' +
    '</div></div>';

  html += '<div class="run-body">';

  html += '<div><h4>' + t('section.pipelineTimeline') + '</h4><ul class="timeline">';
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

  html += '<div><h4>' + t('section.runGraph') + '</h4><div id="runGraph" class="chart-container" style="height: 360px;"></div></div>';

  html += '</div>';

  if (detail) {
    html += '<div class="run-detail-grid">';
    html += '<div class="detail-block"><h4>' + t('section.triggerSignals') + '</h4>' +
      '<p class="muted small" style="margin:-4px 0 8px 0">' + t('message.triggerSignalsHint') + '</p>' +
      pillList(detail.signals, 'signal') + '</div>';
    if (detail.selector) {
      html += '<div class="detail-block"><h4>' + t('section.selectorReasoning') + '</h4>' +
        kv([
          [t('label.selectedGene'), detail.selector.selected],
          [t('label.path'), detail.selector.selectionPath || detail.selector.selection_path],
          [t('label.memoryUsed'), detail.selector.memoryUsed || detail.selector.memory_used],
        ]) +
        '<ul class="reason-list">' + (detail.selector.reason || []).map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>' +
        '</div>';
    }
    if (detail.mutation) {
      html += '<div class="detail-block"><h4>' + t('label.mutation') + '</h4>' + kv([
        [t('table.id'), detail.mutation.id],
        [t('table.category'), detail.mutation.category],
        [t('label.targetType'), detail.mutation.targetType],
        [t('label.strategySteps'), detail.mutation.strategySteps],
        [t('label.triggerSignals'), (detail.mutation.triggerSignals || []).join(', ') || '-'],
      ]) + '</div>';
    }
    html += renderValidationBlock(detail.validation, run.status);
    if (detail.blastRadius) {
      html += '<div class="detail-block"><h4>' + t('section.blastRadius') + '</h4>' + kv([
        [t('label.files'), detail.blastRadius.files],
        [t('label.lines'), detail.blastRadius.lines],
        [t('label.risk'), detail.blastRadius.risk_level || detail.blastRadius.risk],
      ]) + '</div>';
    }
    if (detail.personalityState) {
      html += '<div class="detail-block"><h4>' + t('section.personalityAtRun') + '</h4>' + kv(
        Object.entries(detail.personalityState).slice(0, 8)
      ) + '</div>';
    }
    if (detail.initialUserPrompt) {
      html += '<div class="detail-block"><h4>' + t('section.initialUserPrompt') + '</h4><pre class="snippet">' + esc(detail.initialUserPrompt) + '</pre></div>';
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
  $('run-detail').innerHTML = '<p class="muted">' + t('message.loadingTrace') + '</p>';
  try {
    const run = await api('/webui/runs/' + encodeURIComponent(runId));
    renderRunDetail(run);
  } catch (err) {
    $('run-detail').innerHTML = '<p class="status-failed">' + esc(t('message.runLoadFailed', { message: err.message })) + '</p>';
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
