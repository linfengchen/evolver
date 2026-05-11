'use strict';

// Inline lucide-style SVG icons (24x24, currentColor stroke).
// Kept in one constant block so the HTML template stays readable.
const ICONS = {
  layout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
  pipeline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
  package: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.5.5 0 0 1-.96 0L9.68 3.18a.5.5 0 0 0-.96 0l-2.35 8.36A2 2 0 0 1 4.44 13H2"/></svg>',
  brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
};

const NAV = [
  { tab: 'overview',     icon: 'layout',   label: 'Overview' },
  { tab: 'pipelines',    icon: 'pipeline', label: 'Pipelines' },
  { tab: 'assets',       icon: 'package',  label: 'Assets' },
  { tab: 'interactions', icon: 'activity', label: 'Interactions' },
  { tab: 'personality',  icon: 'brain',    label: 'Personality' },
];

function navItem({ tab, icon, label }, idx) {
  const active = idx === 0 ? ' active' : '';
  return `<button class="tab nav-item${active}" data-tab="${tab}">
        <span class="nav-icon">${ICONS[icon]}</span>
        <span class="nav-label">${label}</span>
      </button>`;
}

function getIndexHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Evolver Web UI</title>
  <link rel="stylesheet" href="/app.css">
  <script src="/vendor/echarts.min.js"></script>
</head>
<body class="app-atmosphere">
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">E</div>
        <div class="brand-text">
          <span class="brand-title">Evolver</span>
          <span class="brand-eyebrow">local agent</span>
        </div>
      </div>
      <nav class="nav">
        ${NAV.map(navItem).join('\n        ')}
      </nav>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-footer">v1.80 · evolves with you</div>
    </aside>

    <div class="main-col">
      <header class="topbar">
        <div class="topbar-left">
          <h1 class="topbar-title" id="topbar-title">Overview</h1>
          <p class="topbar-eyebrow">EvoMap Evolver · Web UI Observability</p>
        </div>
        <div class="topbar-actions">
          <button id="refresh" class="btn-ghost" title="Refresh all data">
            <span class="nav-icon">${ICONS.refresh}</span>
            <span>Refresh</span>
          </button>
        </div>
      </header>

      <main class="content evox-scroll">
        <section data-view="overview" class="view active">
          <div class="grid-top">
            <div class="card"><h2>Status</h2><div id="status">Loading...</div></div>
            <div class="card"><h2>Safety</h2><div id="safety">Loading...</div></div>
            <div class="card"><h2>Interactions</h2><div id="interactions">Loading...</div></div>
          </div>
          <div class="grid-charts">
            <div class="card"><h2>Genes by Category</h2><div id="genesChart" class="chart-container"></div></div>
            <div class="card"><h2>Capsules by Outcome</h2><div id="capsulesChart" class="chart-container"></div></div>
            <div class="card"><h2>Asset Calls</h2><div id="callsChart" class="chart-container"></div></div>
          </div>
          <div class="grid-bottom">
            <div class="card">
              <h2>Latest Pipeline Run</h2>
              <div id="latest-run">Loading...</div>
            </div>
            <div class="card">
              <h2>Skills</h2>
              <div id="skills">Loading...</div>
            </div>
          </div>
        </section>

        <section data-view="pipelines" class="view">
          <div class="grid-bottom">
            <div class="card">
              <h2>Pipeline Runs</h2>
              <div class="table-wrapper">
                <table id="runsTable">
                  <thead><tr><th>Run ID</th><th>Status</th><th>Gene</th><th>Score</th><th>Updated</th></tr></thead>
                  <tbody></tbody>
                </table>
              </div>
            </div>
            <div class="card">
              <h2>Run Trace</h2>
              <div id="run-detail"><p class="muted">Select a run to inspect its trace.</p></div>
            </div>
          </div>
        </section>

        <section data-view="assets" class="view">
          <div class="asset-tabs">
            <button class="asset-tab active" data-asset="genes">Genes</button>
            <button class="asset-tab" data-asset="capsules">Capsules</button>
            <button class="asset-tab" data-asset="events">Events</button>
            <button class="asset-tab" data-asset="candidates">Candidates</button>
            <button class="asset-tab" data-asset="calls">Asset Calls</button>
          </div>
          <div class="card">
            <div id="asset-list">Loading...</div>
          </div>
        </section>

        <section data-view="interactions" class="view">
          <div class="grid-charts">
            <div class="card"><h2>Hub A2A by Action</h2><div id="hubActionChart" class="chart-container"></div></div>
            <div class="card"><h2>Activity (last 30 days)</h2><div id="activityChart" class="chart-container"></div></div>
            <div class="card"><h2>Mailbox by Type</h2><div id="mailboxChart" class="chart-container"></div></div>
          </div>
          <div class="card">
            <h2>Hub Activity</h2>
            <p class="muted small card-sub">Unified timeline of every Hub interaction — connection lifecycle (hello/heartbeat/fetch), asset calls (search/reuse/publish) and ATP credit flows.</p>
            <div id="hub-activity-summary" class="lifecycle-summary">Loading...</div>
            <div class="filter-bar" id="hub-activity-filters" style="display:none">
              <div class="filter-group">
                <span class="filter-label">Layer</span>
                <button class="filter-pill active" data-filter-layer="all">All</button>
                <button class="filter-pill" data-filter-layer="lifecycle">Lifecycle</button>
                <button class="filter-pill" data-filter-layer="asset">Asset</button>
                <button class="filter-pill" data-filter-layer="atp">ATP</button>
              </div>
              <label class="filter-toggle"><input type="checkbox" id="hide-heartbeats" checked /> Hide heartbeats</label>
            </div>
            <div id="hub-activity">Loading...</div>
          </div>
          <div class="card">
            <h2>Agent Interactions</h2>
            <p class="muted small card-sub">Mailbox messages, sessions and DMs (read-only, redacted).</p>
            <div id="agent-stream">Loading...</div>
          </div>
          <div class="card">
            <h2>Proxy Snapshots</h2>
            <div id="proxy-snapshots" class="snapshot-grid">Loading...</div>
          </div>
        </section>

        <section data-view="personality" class="view">
          <div class="grid-charts">
            <div class="card"><h2>Personality Traits</h2><div id="personalityChart" class="chart-container chart-tall"></div></div>
            <div class="card"><h2>Personality Detail</h2><div id="personality-detail">Loading...</div></div>
          </div>
          <div class="card">
            <h2>Memory Graph (last 100 events)</h2>
            <div id="memory-graph-chart" class="chart-container chart-xl"></div>
          </div>
        </section>
      </main>
    </div>
  </div>
  <script src="/app.js"></script>
</body>
</html>`;
}

module.exports = { getIndexHtml };
