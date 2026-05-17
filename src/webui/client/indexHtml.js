'use strict';

function getIndexHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Evolver Web UI</title>
  <link rel="stylesheet" href="/app.css">
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <p class="eyebrow">EvoMap Evolver</p>
        <h1 data-i18n="app.heading">Web UI Observability</h1>
      </div>
      <nav class="tabs" aria-label="Main navigation">
        <button class="tab active" data-tab="overview" data-i18n="nav.overview">Overview</button>
        <button class="tab" data-tab="pipelines" data-i18n="nav.pipelines">Pipelines</button>
        <button class="tab" data-tab="assets" data-i18n="nav.assets">Assets</button>
        <button class="tab" data-tab="interactions" data-i18n="nav.interactions">Interactions</button>
        <button class="tab" data-tab="personality" data-i18n="nav.personality">Personality</button>
      </nav>
      <div class="sidebar-footer">
        <button id="version-card" class="version-card" type="button">
          <span class="version-card-heading" data-i18n="section.versionCheck">Version Check</span>
          <span id="version-card-package" class="version-card-package">@evomap/evolver v-</span>
          <span id="version-card-status" class="version-card-status">
            <span class="status-indicator status-skipped"></span>
            <span data-i18n="state.loading">Loading...</span>
          </span>
        </button>
      </div>
    </aside>
    <div class="content-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow" data-i18n="app.subtitle">Local observability console</p>
          <h1 data-i18n="app.heading">Web UI Observability</h1>
        </div>
        <div class="topbar-actions">
          <div class="language-switcher" aria-label="Language">
            <span class="language-label" data-i18n="language.label">Language</span>
            <button class="language-option" data-lang="zh">中</button>
            <button class="language-option" data-lang="en">英</button>
            <button class="language-option" data-lang="ja">日</button>
          </div>
          <button id="refresh" data-i18n="action.refresh">Refresh</button>
        </div>
      </header>
      <main>
    <section data-view="overview" class="view active">
      <div class="grid-top">
        <div class="panel"><h2 data-i18n="section.status">Status</h2><div id="status" data-i18n="state.loading">Loading...</div></div>
        <div class="panel"><h2 data-i18n="section.safety">Safety</h2><div id="safety" data-i18n="state.loading">Loading...</div></div>
        <div class="panel"><h2 data-i18n="section.interactions">Interactions</h2><div id="interactions" data-i18n="state.loading">Loading...</div></div>
      </div>
      <div class="grid-charts">
        <div class="panel"><h2 data-i18n="section.genesByCategory">Genes by Category</h2><div id="genesChart" class="chart-container"></div></div>
        <div class="panel"><h2 data-i18n="section.capsulesByOutcome">Capsules by Outcome</h2><div id="capsulesChart" class="chart-container"></div></div>
        <div class="panel"><h2 data-i18n="section.assetCalls">Asset Calls</h2><div id="callsChart" class="chart-container"></div></div>
      </div>
      <div class="grid-bottom">
        <div class="panel">
          <h2 data-i18n="section.latestPipelineRun">Latest Pipeline Run</h2>
          <div id="latest-run" data-i18n="state.loading">Loading...</div>
        </div>
        <div class="panel">
          <h2 data-i18n="section.skills">Skills</h2>
          <div id="skills" data-i18n="state.loading">Loading...</div>
        </div>
      </div>
    </section>

    <section data-view="pipelines" class="view">
      <div class="panel" style="margin-bottom: 16px;">
        <h2 data-i18n="section.validationTrend">Validation Score Trend</h2>
        <p class="muted small" style="margin:-8px 0 8px 0" data-i18n="hint.validationTrend">Local validation outcome score per run (0.0 - 1.0). Higher = more stable + better heuristic delta + better predictive match.</p>
        <div id="scoreTrendChart" class="chart-container" style="height: 220px;"></div>
      </div>
      <div class="grid-bottom">
        <div class="panel">
          <h2 data-i18n="section.pipelineRuns">Pipeline Runs</h2>
          <div class="table-wrapper">
            <table id="runsTable">
              <thead><tr><th data-i18n="table.runId">Run ID</th><th data-i18n="table.status">Status</th><th data-i18n="table.gene">Gene</th><th data-i18n="table.score">Score</th><th data-i18n="table.updated">Updated</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <h2 data-i18n="section.runTrace">Run Trace</h2>
          <div id="run-detail"><p style="color: var(--text-muted)" data-i18n="hint.selectRun">Select a run to inspect its trace.</p></div>
        </div>
      </div>
    </section>

    <section data-view="assets" class="view">
      <div class="asset-tabs">
        <button class="asset-tab active" data-asset="genes" data-i18n="asset.genes">Genes</button>
        <button class="asset-tab" data-asset="capsules" data-i18n="asset.capsules">Capsules</button>
        <button class="asset-tab" data-asset="events" data-i18n="asset.events">Events</button>
        <button class="asset-tab" data-asset="candidates" data-i18n="asset.candidates">Candidates</button>
        <button class="asset-tab" data-asset="calls" data-i18n="asset.calls">Asset Calls</button>
      </div>
      <div class="panel">
        <div id="asset-list" data-i18n="state.loading">Loading...</div>
      </div>
    </section>

    <section data-view="interactions" class="view">
      <div class="grid-charts">
        <div class="panel"><h2 data-i18n="section.hubA2AByAction">Hub A2A by Action</h2><div id="hubActionChart" class="chart-container"></div></div>
        <div class="panel"><h2 data-i18n="section.activity30Days">Activity (last 30 days)</h2><div id="activityChart" class="chart-container"></div></div>
        <div class="panel"><h2 data-i18n="section.mailboxByType">Mailbox by Type</h2><div id="mailboxChart" class="chart-container"></div></div>
      </div>
      <div class="panel">
        <h2 data-i18n="section.hubActivity">Hub Activity</h2>
        <p class="muted small" style="margin:-8px 0 12px 0" data-i18n="hint.hubActivity">Unified timeline of every Hub interaction: connection lifecycle (hello/heartbeat/fetch), asset calls (search/reuse/publish) and ATP credit flows.</p>
        <div id="hub-activity-summary" class="lifecycle-summary" data-i18n="state.loading">Loading...</div>
        <div class="filter-bar" id="hub-activity-filters" style="display:none">
          <div class="filter-group">
            <span class="filter-label" data-i18n="filter.layer">Layer</span>
            <button class="filter-pill active" data-filter-layer="all" data-i18n="filter.all">All</button>
            <button class="filter-pill" data-filter-layer="lifecycle" data-i18n="filter.lifecycle">Lifecycle</button>
            <button class="filter-pill" data-filter-layer="asset" data-i18n="filter.asset">Asset</button>
            <button class="filter-pill" data-filter-layer="atp" data-i18n="filter.atp">ATP</button>
          </div>
          <label class="filter-toggle"><input type="checkbox" id="hide-heartbeats" checked /> <span data-i18n="filter.hideHeartbeats">Hide heartbeats</span></label>
        </div>
        <div id="hub-activity" data-i18n="state.loading">Loading...</div>
      </div>
      <div class="panel">
        <h2 data-i18n="section.agentInteractions">Agent Interactions</h2>
        <p class="muted small" style="margin:-8px 0 12px 0" data-i18n="hint.agentInteractions">Mailbox messages, sessions and DMs (read-only, redacted).</p>
        <div id="agent-stream" data-i18n="state.loading">Loading...</div>
      </div>
      <div class="panel">
        <h2 data-i18n="section.proxySnapshots">Proxy Snapshots</h2>
        <div id="proxy-snapshots" class="snapshot-grid" data-i18n="state.loading">Loading...</div>
      </div>
    </section>

    <section data-view="personality" class="view">
      <div class="grid-charts">
        <div class="panel"><h2 data-i18n="section.personalityTraits">Personality Traits</h2><div id="personalityChart" class="chart-container" style="height: 320px"></div></div>
        <div class="panel"><h2 data-i18n="section.personalityDetail">Personality Detail</h2><div id="personality-detail" data-i18n="state.loading">Loading...</div></div>
      </div>
      <div class="panel">
        <h2 data-i18n="section.memoryGraph">Memory Graph (last 100 events)</h2>
        <div id="memory-graph-chart" class="chart-container" style="height: 480px"></div>
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
