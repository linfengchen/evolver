'use strict';

exports.bootstrapJs = `
const TAB_TITLES = {
  overview: 'Overview',
  pipelines: 'Pipelines',
  assets: 'Assets',
  interactions: 'Interactions',
  personality: 'Personality',
};

function activateTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.getAttribute('data-view') === tab));
  const title = document.getElementById('topbar-title');
  if (title && TAB_TITLES[tab]) title.textContent = TAB_TITLES[tab];
  setTimeout(() => Object.values(state.charts).forEach((c) => c.resize && c.resize()), 50);
  if (tab === 'pipelines') loadPipelines();
  if (tab === 'assets') loadAsset(state.currentAsset);
  if (tab === 'interactions') loadInteractions();
  if (tab === 'personality') loadPersonality();
}

async function refresh() {
  if (state.currentTab === 'overview') return loadOverview();
  if (state.currentTab === 'pipelines') return loadPipelines();
  if (state.currentTab === 'assets') return loadAsset(state.currentAsset);
  if (state.currentTab === 'interactions') return loadInteractions();
  if (state.currentTab === 'personality') return loadPersonality();
}

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => activateTab(b.getAttribute('data-tab'))));
document.querySelectorAll('.asset-tab').forEach((b) => b.addEventListener('click', () => loadAsset(b.getAttribute('data-asset'))));
$('refresh').addEventListener('click', refresh);
window.addEventListener('resize', () => Object.values(state.charts).forEach((c) => c.resize && c.resize()));
window.loadRun = loadRun;
loadOverview();
`;
