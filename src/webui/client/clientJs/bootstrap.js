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
  // Reload current tab so it works after toggleTheme has disposed all
  // chart instances (otherwise switching back to Overview would show
  // empty chart slots in dark mode).
  if (tab === 'overview') loadOverview();
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

function toggleTheme() {
  const root = document.documentElement;
  const next = root.classList.contains('dark') ? 'light' : 'dark';
  root.classList.toggle('dark', next === 'dark');
  try { localStorage.setItem('evolver-theme', next); } catch (_) {}
  // ECharts colors are baked at init time, so dispose + re-render the
  // active tab so chart text/axes pick up the new palette. Cheaper than
  // tracking every chart instance manually.
  for (const id of Object.keys(state.charts)) {
    state.charts[id].dispose && state.charts[id].dispose();
    delete state.charts[id];
  }
  refresh();
}

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => activateTab(b.getAttribute('data-tab'))));
document.querySelectorAll('.asset-tab').forEach((b) => b.addEventListener('click', () => loadAsset(b.getAttribute('data-asset'))));
$('refresh').addEventListener('click', refresh);
const themeBtn = $('theme-toggle');
if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
window.addEventListener('resize', () => Object.values(state.charts).forEach((c) => c.resize && c.resize()));
window.loadRun = loadRun;
loadOverview();
`;
