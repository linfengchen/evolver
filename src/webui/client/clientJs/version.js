'use strict';

exports.versionJs = `
function initializeVersionCard() {
  const card = $('version-card');
  if (!card) return;
  card.addEventListener('click', openVersionModal);
}

async function loadVersionCard() {
  try {
    const info = await apiPost('/webui/version/check', {});
    state.versionInfo = info;
    renderVersionCard(info);
  } catch (err) {
    try {
      const info = await api('/webui/version');
      state.versionInfo = info;
      renderVersionCard(info);
    } catch (fallbackErr) {
      renderVersionCard(null, fallbackErr);
    }
  }
}

function renderVersionCard(info, err) {
  const pkg = $('version-card-package');
  const status = $('version-card-status');
  if (!pkg || !status) return;

  if (err || !info) {
    pkg.textContent = '@evomap/evolver v-';
    status.innerHTML = '<span class="status-indicator status-failed"></span>' + esc(t('message.versionCardUnavailable'));
    return;
  }

  pkg.textContent = info.displayVersion || ((info.packageName || '@evomap/evolver') + ' v' + (info.currentVersion || '-'));
  const proxyRunning = !!(info.proxy && info.proxy.running);
  const dotClass = proxyRunning ? 'status-success' : 'status-warning';
  const sourceText = info.versionSource === 'npm' ? t('label.officialRelease') : t('label.localSource');
  status.innerHTML = '<span class="status-indicator ' + dotClass + '"></span>' +
    esc(sourceText) + ' · ' +
    esc(t('label.webui')) + ' ' + esc(t('value.running')) + ' · ' +
    esc(t('label.proxy')) + ' ' + esc(t(proxyRunning ? 'value.running' : 'value.not_running'));
}

function ensureVersionModal() {
  let modal = $('version-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'version-modal';
  modal.className = 'version-modal-backdrop';
  modal.hidden = true;
  modal.innerHTML = '<div class="version-modal" role="dialog" aria-modal="true" aria-labelledby="version-modal-title">' +
    '<button id="version-modal-close" class="version-modal-close" type="button" aria-label="' + esc(t('action.close')) + '">x</button>' +
    '<h3 id="version-modal-title"></h3>' +
    '<p id="version-modal-version" class="version-modal-version"></p>' +
    '<div id="version-modal-grid" class="version-modal-grid"></div>' +
    '<div class="version-modal-actions">' +
      '<button id="version-check-button" type="button"></button>' +
      '<button id="version-update-button" type="button"></button>' +
    '</div>' +
    '<p id="version-modal-status" class="version-modal-status"></p>' +
  '</div>';
  document.body.appendChild(modal);

  $('version-modal-close').addEventListener('click', closeVersionModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeVersionModal();
  });
  $('version-check-button').addEventListener('click', () => checkVersionFromModal());
  $('version-update-button').addEventListener('click', () => updateRestartFromModal());
  return modal;
}

function openVersionModal() {
  const modal = ensureVersionModal();
  renderVersionModal(state.versionInfo);
  modal.hidden = false;
  checkVersionFromModal();
}

function closeVersionModal() {
  const modal = $('version-modal');
  if (modal) modal.hidden = true;
}

function renderVersionModal(info) {
  ensureVersionModal();
  const title = $('version-modal-title');
  const version = $('version-modal-version');
  const grid = $('version-modal-grid');
  const checkButton = $('version-check-button');
  const updateButton = $('version-update-button');
  if (!title || !version || !grid || !checkButton || !updateButton) return;

  title.textContent = t('section.versionCheck');
  checkButton.textContent = t('action.checkVersion');
  updateButton.textContent = t('action.updateRestart');

  if (!info) {
    version.textContent = '@evomap/evolver v-';
    grid.innerHTML = '';
    setVersionModalStatus(t('message.versionUnknown'), '');
    return;
  }

  version.textContent = info.displayVersion || ((info.packageName || '@evomap/evolver') + ' v' + (info.currentVersion || '-'));
  const proxyRunning = !!(info.proxy && info.proxy.running);
  const update = info.update || {};
  const latestVersion = info.officialVersion || update.latestVersion || '';
  const latest = latestVersion ? ((info.packageName || '@evomap/evolver') + ' v' + latestVersion) : '-';
  const checkedAt = update.checkedAt ? formatTime(update.checkedAt) : '-';
  const webuiPort = info.webui && info.webui.port ? ':' + info.webui.port : '-';
  const rows = [
    versionStat(t('label.officialVersion'), latest),
    versionStat(t('label.webui'), t('value.running') + ' · ' + webuiPort),
    versionStat(t('label.proxy'), t(proxyRunning ? 'value.running' : 'value.not_running')),
    versionStat(t('label.processId'), info.webui && info.webui.pid || '-'),
    versionStat(t('label.checkedAt'), checkedAt),
  ];
  if (update.updateAvailable === true) rows.push(versionStat(t('label.updateCommand'), update.command || '-'));
  grid.innerHTML = rows.join('');

  if (update.updateAvailable === true) {
    setVersionModalStatus(t('message.versionUpdateAvailable', { version: latest }), 'success');
  } else if (update.updateAvailable === false) {
    setVersionModalStatus(t('message.versionOfficialActive'), 'success');
  } else {
    setVersionModalStatus(t('message.versionCheckPending'), '');
  }
  setVersionButtonsDisabled(!!(state.versionChecking || state.versionUpdating));
}

function versionStat(label, value) {
  return '<div class="version-modal-stat"><strong>' + esc(label) + '</strong><span>' + esc(value) + '</span></div>';
}

async function checkVersionFromModal() {
  if (state.versionChecking || state.versionUpdating) return;
  state.versionChecking = true;
  setVersionButtonsDisabled(true);
  setVersionModalStatus(t('message.versionChecking'), '');
  try {
    const info = await apiPost('/webui/version/check', {});
    state.versionInfo = info;
    renderVersionCard(info);
    renderVersionModal(info);
  } catch (err) {
    setVersionModalStatus(t('message.versionCheckFailed', { message: err.message }), 'error');
  } finally {
    state.versionChecking = false;
    setVersionButtonsDisabled(false);
  }
}

async function updateRestartFromModal() {
  if (state.versionUpdating) return;
  if (!canRunVersionUpdate()) {
    setVersionModalStatus(t('message.versionNoOfficialUpdate'), '');
    return;
  }
  if (!window.confirm(t('message.updateRestartConfirm'))) return;
  state.versionUpdating = true;
  setVersionButtonsDisabled(true);
  setVersionModalStatus(t('message.updateRestarting'), '');
  try {
    const result = await apiPost('/webui/version/update-restart', {});
    const port = result.restart && result.restart.port || '';
    setVersionModalStatus(t('message.updateRestartScheduled', { port }), 'success');
    pollVersionAfterRestart();
  } catch (err) {
    state.versionUpdating = false;
    setVersionButtonsDisabled(false);
    setVersionModalStatus(t('message.updateRestartFailed', { message: err.message }), 'error');
  }
}

function setVersionButtonsDisabled(disabled) {
  const checkButton = $('version-check-button');
  const updateButton = $('version-update-button');
  if (checkButton) checkButton.disabled = !!disabled;
  if (updateButton) updateButton.disabled = !!disabled || !canRunVersionUpdate();
}

function canRunVersionUpdate() {
  const update = state.versionInfo && state.versionInfo.update;
  return !!(update && update.updateAvailable === true);
}

function setVersionModalStatus(text, className) {
  const status = $('version-modal-status');
  if (!status) return;
  status.className = 'version-modal-status' + (className ? ' ' + className : '');
  status.textContent = text || '';
}

async function pollVersionAfterRestart() {
  for (let attempt = 0; attempt < 35; attempt++) {
    await delay(1000);
    try {
      const res = await fetch('/webui/version?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch (_) {
      // Service is expected to be briefly unavailable while it restarts.
    }
  }
  state.versionUpdating = false;
  setVersionButtonsDisabled(false);
  setVersionModalStatus(t('message.restartPolling'), 'error');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`;
