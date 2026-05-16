'use strict';

exports.bootstrapJs = `
const TAB_TITLE_KEYS = {
  overview: 'nav.overview',
  pipelines: 'nav.pipelines',
  assets: 'nav.assets',
  interactions: 'nav.interactions',
  personality: 'nav.personality',
};

function activateTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.getAttribute('data-view') === tab));
  const title = document.getElementById('topbar-title');
  if (title && TAB_TITLE_KEYS[tab]) {
    title.setAttribute('data-i18n', TAB_TITLE_KEYS[tab]);
    title.textContent = t(TAB_TITLE_KEYS[tab]);
  }
  setTimeout(() => Object.values(state.charts).forEach((c) => c.resize && c.resize()), 50);
  // Reload current tab so it works after toggleTheme/toggleLocale has
  // disposed all chart instances (otherwise switching back to Overview
  // would show empty chart slots).
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

function disposeAllCharts() {
  for (const id of Object.keys(state.charts)) {
    state.charts[id].dispose && state.charts[id].dispose();
    delete state.charts[id];
  }
}

function toggleTheme() {
  const root = document.documentElement;
  const next = root.classList.contains('dark') ? 'light' : 'dark';
  root.classList.toggle('dark', next === 'dark');
  try { localStorage.setItem('evolver-theme', next); } catch (_) {}
  // ECharts colors are baked at init time, so dispose + re-render the
  // active tab so chart text/axes pick up the new palette.
  disposeAllCharts();
  refresh();
}

function syncLocaleGlyph() {
  const glyph = document.querySelector('#locale-toggle .locale-glyph');
  if (!glyph) return;
  // Glyph shows the *target* locale (what you'll switch to), matching
  // common bilingual UI conventions (e.g. evox-desktop).
  glyph.textContent = getLocale() === 'zh' ? 'EN' : '中';
}

function toggleLocale() {
  const next = getLocale() === 'zh' ? 'en' : 'zh';
  setLocale(next);
  applyI18nDom();
  syncLocaleGlyph();
  // Charts contain locale-baked labels (axis names, legends, tooltips
  // built from t() calls), so dispose + re-render to pick up the new
  // strings. Same pattern as toggleTheme.
  disposeAllCharts();
  refresh();
}

async function loadProjects() {
  const select = $('project-select');
  if (!select) return;
  try {
    const payload = await api('/webui/projects');
    state.projects = payload.projects || [];
    const stored = localStorage.getItem('evolver-project-id');
    const hasStored = state.projects.some((project) => project.id === stored);
    state.selectedProjectId = hasStored ? stored : payload.defaultProjectId;
    select.innerHTML = state.projects.map((project) => {
      const sources = (project.agentSources || []).join(',');
      return '<option value="' + esc(project.id) + '">' + esc(project.label + (sources ? ' · ' + sources : '')) + '</option>';
    }).join('');
    select.value = state.selectedProjectId || '';
    select.disabled = state.projects.length <= 1;
  } catch (err) {
    select.innerHTML = '<option value="">' + esc(t('project.select.failed')) + '</option>';
    select.disabled = true;
  }
}

function onProjectChange() {
  const select = $('project-select');
  if (!select) return;
  state.selectedProjectId = select.value || null;
  try {
    localStorage.setItem('evolver-project-id', state.selectedProjectId || '');
  } catch (_) {
    // localStorage can be disabled; the in-memory selection still works.
  }
  disposeAllCharts();
  refresh();
}

// Initial paint — set glyph + apply translations to the static markup.
syncLocaleGlyph();
applyI18nDom();

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => activateTab(b.getAttribute('data-tab'))));
document.querySelectorAll('.asset-tab').forEach((b) => b.addEventListener('click', () => loadAsset(b.getAttribute('data-asset'))));
$('refresh').addEventListener('click', refresh);
const themeBtn = $('theme-toggle');
if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
const localeBtn = $('locale-toggle');
if (localeBtn) localeBtn.addEventListener('click', toggleLocale);
const projectSelect = $('project-select');
if (projectSelect) projectSelect.addEventListener('change', onProjectChange);
window.addEventListener('resize', () => Object.values(state.charts).forEach((c) => c.resize && c.resize()));
window.loadRun = loadRun;
loadProjects().then(loadOverview);
`;
