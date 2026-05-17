'use strict';

exports.overviewJs = `
function renderStatus(status) {
  const lastRun = status.lastRun || {};
  $('status').innerHTML = kv([
    [t('label.mode'), status.mode],
    [t('label.proxy'), status.proxy?.running ? 'running' : 'not running'],
    [t('label.heartbeat'), status.heartbeat?.phase || 'idle'],
    [t('label.lastRun'), lastRun.run_id || '-'],
    [t('label.lastActivity'), formatTime(lastRun.finished_at || lastRun.created_at)],
  ]);
}

function renderSafety(safety) {
  const warnings = safety.warnings?.length
    ? '<ul style="margin-top:8px;padding-left:20px;color:var(--warning)">' + safety.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>'
    : '<p style="margin-top:8px;color:var(--success)">' + t('message.noUnsafeFlags') + '</p>';
  $('safety').innerHTML = '<div style="margin-bottom:8px"><span class="status-indicator ' + (safety.safeMode ? 'status-success' : 'status-warning') + '"></span><strong>' + (safety.safeMode ? t('message.safeMode') : t('message.reviewRequired')) + '</strong></div>' + kv([
    [t('label.autobuy'), safety.autobuyEnabled],
    [t('label.autoPublish'), safety.autoPublishEnabled],
    [t('label.validator'), safety.validatorEnabled],
    [t('label.traceLevel'), safety.traceLevel],
  ]) + warnings;
}

function renderInteractions(interactions) {
  $('interactions').innerHTML = kv([
    [t('label.proxy'), interactions.proxy?.running ? interactions.proxy.url : 'not running'],
    [t('label.mailboxMessages'), interactions.mailbox?.pagination?.totalItems || 0],
    [t('label.taskMetrics'), interactions.proxySnapshots?.taskMetrics?.ok ? 'available' : 'not available'],
    [t('label.sessions'), interactions.proxySnapshots?.sessions?.ok ? 'available' : 'not available'],
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
      data: Object.entries(assets.genesByCategory || {}).map(([name, value]) => ({ name: categoryLabel(name), value })),
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
      data: capsules.length ? capsules.map(([name, value]) => ({ name: valueLabel(name), value })) : [{ name: t('message.noCapsules'), value: 1, itemStyle: { color: '#444' } }],
    }],
  });

  const calls = Object.entries(assets.assetCallsByAction || {});
  ensureChart('callsChart')?.setOption({
    color: palette,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '4%', bottom: '5%', containLabel: true },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: isDark ? '#2c3235' : '#e4e7eb' } }, axisLabel: { color: textColor } },
    yAxis: { type: 'category', data: calls.length ? calls.map(d => d[0]) : [t('value.no_calls')], axisLabel: { color: textColor } },
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
    $('latest-run').innerHTML = '<p class="muted">' + t('message.noRuns') + '</p>';
    return;
  }
  const run = list[0];
  $('latest-run').innerHTML = kv([
    [t('table.runId'), run.runId],
    [t('table.status'), '<span class="status-indicator ' + getStatusClass(run.status) + '"></span>' + valueLabel(run.status)],
    [t('label.selectedGene'), run.selectedGeneId || '-'],
    [t('table.validation'), validationDisplay(run)],
    [t('table.updated'), formatTime(run.updatedAt)],
    [t('label.requiresConfirmation'), run.requiresConfirmation],
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
    $('skills').innerHTML = '<p class="muted">' + t('message.noLocalSkills') + '</p>' +
      '<p class="muted small">' + t('message.installSkill') + '</p>' +
      '<div class="skill-install">' +
        '<label class="skill-install-label" for="skill-fetch-id">' + t('label.skillId') + '</label>' +
        '<div class="skill-install-row">' +
          '<input id="skill-fetch-id" class="skill-install-input" type="text" autocomplete="off" placeholder="' + esc(t('placeholder.skillId')) + '">' +
          '<button id="skill-fetch-button" type="button">' + t('action.installSkill') + '</button>' +
        '</div>' +
        '<div id="skill-fetch-status" class="muted small skill-install-status">' + t('message.skillInstallHint') + '</div>' +
      '</div>';
    bindSkillFetchForm();
    return;
  }
  $('skills').innerHTML = '<ul class="skill-list">' + skills.items.map((skill) =>
    '<li><strong>' + esc(skill.name) + '</strong>' +
    (skill.description ? '<p>' + esc(skill.description) + '</p>' : '') +
    '<small class="muted">' + t('message.filesWithCount', { count: skill.fileCount }) + ' · ' + esc(skill.docFile || t('message.noDoc')) + '</small></li>'
  ).join('') + '</ul>';
}

function bindSkillFetchForm() {
  const input = $('skill-fetch-id');
  const button = $('skill-fetch-button');
  const status = $('skill-fetch-status');
  if (!input || !button || !status) return;

  const submit = async () => {
    const skillId = input.value.trim();
    if (!skillId) {
      status.className = 'small skill-install-status error';
      status.textContent = t('message.skillIdRequired');
      input.focus();
      return;
    }
    button.disabled = true;
    input.disabled = true;
    status.className = 'muted small skill-install-status';
    status.textContent = t('message.skillFetchInProgress');
    try {
      await apiPost('/webui/skills/fetch', { skillId });
      status.className = 'small skill-install-status success';
      status.textContent = t('message.skillFetchSucceeded', { skillId });
      await loadOverview();
    } catch (err) {
      status.className = 'small skill-install-status error';
      status.textContent = err.message || t('message.skillFetchFailed');
      button.disabled = false;
      input.disabled = false;
      input.focus();
    }
  };

  button.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
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
