'use strict';

exports.overviewJs = `
function renderStatus(status) {
  const lastRun = status.lastRun || {};
  $('status').innerHTML = kv([
    ['Mode', status.mode],
    ['Proxy', status.proxy?.running ? 'running' : 'not running'],
    ['Heartbeat', status.heartbeat?.phase || 'idle'],
    ['Last run', lastRun.run_id || '-'],
    ['Last activity', formatTime(lastRun.finished_at || lastRun.created_at)],
  ]);
}

function renderSafety(safety) {
  const warnings = safety.warnings?.length
    ? '<ul style="margin-top:8px;padding-left:20px;color:var(--warning)">' + safety.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>'
    : '<p style="margin-top:8px;color:var(--success)">No unsafe automation flags detected.</p>';
  $('safety').innerHTML = '<div style="margin-bottom:8px"><span class="status-indicator ' + (safety.safeMode ? 'status-success' : 'status-warning') + '"></span><strong>' + (safety.safeMode ? 'Safe mode' : 'Review required') + '</strong></div>' + kv([
    ['Autobuy', safety.autobuyEnabled],
    ['Auto publish', safety.autoPublishEnabled],
    ['Validator', safety.validatorEnabled],
    ['Trace level', safety.traceLevel],
  ]) + warnings;
}

function renderInteractions(interactions) {
  $('interactions').innerHTML = kv([
    ['Proxy', interactions.proxy?.running ? interactions.proxy.url : 'not running'],
    ['Mailbox messages', interactions.mailbox?.pagination?.totalItems || 0],
    ['Task metrics', interactions.proxySnapshots?.taskMetrics?.ok ? 'available' : 'not available'],
    ['Sessions', interactions.proxySnapshots?.sessions?.ok ? 'available' : 'not available'],
  ]);
}

function renderOverviewCharts(assets) {
  const isDark = isDarkMode();
  const textColor = chartTextColor();
  const palette = ['#3274d9', '#28a745', '#ffc107', '#dc3545', '#6f42c1', '#17a2b8'];

  ensureChart('genesChart')?.setOption({
    color: palette,
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { color: textColor } },
    series: [{
      type: 'pie',
      radius: ['45%', '72%'],
      itemStyle: { borderRadius: 4, borderColor: isDark ? '#181b1f' : '#fff', borderWidth: 2 },
      label: { show: false },
      labelLine: { show: false },
      data: Object.entries(assets.genesByCategory || {}).map(([name, value]) => ({ name, value })),
    }],
  });

  const capsules = Object.entries(assets.capsulesByOutcome || {});
  ensureChart('capsulesChart')?.setOption({
    color: palette,
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { color: textColor } },
    series: [{
      type: 'pie',
      radius: ['45%', '72%'],
      itemStyle: { borderRadius: 4, borderColor: isDark ? '#181b1f' : '#fff', borderWidth: 2 },
      label: { show: false },
      labelLine: { show: false },
      data: capsules.length ? capsules.map(([name, value]) => ({ name, value })) : [{ name: 'no capsules yet', value: 1, itemStyle: { color: '#444' } }],
    }],
  });

  const calls = Object.entries(assets.assetCallsByAction || {});
  ensureChart('callsChart')?.setOption({
    color: palette,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '4%', bottom: '5%', containLabel: true },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: isDark ? '#2c3235' : '#e4e7eb' } }, axisLabel: { color: textColor } },
    yAxis: { type: 'category', data: calls.length ? calls.map(d => d[0]) : ['no calls'], axisLabel: { color: textColor } },
    series: [{
      type: 'bar',
      data: calls.length ? calls.map(d => d[1]) : [0],
      itemStyle: { color: '#3274d9', borderRadius: [0, 4, 4, 0] },
    }],
  });
}

function renderLatestRun(runs) {
  const list = runs.data || [];
  if (!list.length) {
    $('latest-run').innerHTML = '<p class="muted">No runs recorded yet.</p>';
    return;
  }
  const run = list[0];
  $('latest-run').innerHTML = kv([
    ['Run ID', run.runId],
    ['Status', '<span class="status-indicator ' + getStatusClass(run.status) + '"></span>' + run.status],
    ['Selected Gene', run.selectedGeneId || '-'],
    ['Validation', validationDisplay(run)],
    ['Updated', formatTime(run.updatedAt)],
    ['Requires confirmation', run.requiresConfirmation ? 'yes' : 'no'],
  ]).replace(/&lt;span/g, '<span').replace(/&lt;\\/span&gt;/g, '</span>');
}

function validationDisplay(run) {
  if (run.validationResult === 'pass') return 'pass';
  if (run.validationResult === 'fail') return 'fail';
  if (run.status === 'review_pending') return 'pending review';
  if (run.status === 'running' || run.status === 'pending') return 'in progress';
  if (run.status === 'failed') return 'not run';
  return 'not run';
}

function renderSkills(skills) {
  if (!skills.exists || !skills.items.length) {
    $('skills').innerHTML = '<p class="muted">No local skills installed yet.</p>' +
      '<p class="muted small">Use <code>evolver fetch --skill=&lt;id&gt;</code> to install one from the Hub.</p>';
    return;
  }
  $('skills').innerHTML = '<ul class="skill-list">' + skills.items.map((skill) =>
    '<li><strong>' + esc(skill.name) + '</strong>' +
    (skill.description ? '<p>' + esc(skill.description) + '</p>' : '') +
    '<small class="muted">' + skill.fileCount + ' files · ' + (skill.docFile || 'no doc') + '</small></li>'
  ).join('') + '</ul>';
}

async function loadOverview() {
  try {
    const [status, runs, assets, interactions, skills] = await Promise.all([
      api('/webui/status'),
      api('/webui/runs?limit=20'),
      api('/webui/assets'),
      api('/webui/interactions?limit=20'),
      api('/webui/skills'),
    ]);
    renderStatus(status);
    renderSafety(status.safety || {});
    renderInteractions(interactions);
    renderOverviewCharts(assets);
    renderLatestRun(runs);
    renderSkills(skills);
  } catch (err) {
    console.error(err);
  }
}
`;
