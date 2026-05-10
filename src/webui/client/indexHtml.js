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
  <header>
    <div>
      <p class="eyebrow">EvoMap Evolver</p>
      <h1>Web UI Observability</h1>
    </div>
    <nav class="tabs">
      <button class="tab active" data-tab="overview">Overview</button>
      <button class="tab" data-tab="pipelines">Pipelines</button>
      <button class="tab" data-tab="assets">Assets</button>
      <button class="tab" data-tab="interactions">Interactions</button>
      <button class="tab" data-tab="personality">Personality</button>
    </nav>
    <button id="refresh">Refresh</button>
  </header>
  <main>
    <section data-view="overview" class="view active">
      <div class="grid-top">
        <div class="panel"><h2>Status</h2><div id="status">Loading...</div></div>
        <div class="panel"><h2>Safety</h2><div id="safety">Loading...</div></div>
        <div class="panel"><h2>Interactions</h2><div id="interactions">Loading...</div></div>
      </div>
      <div class="grid-charts">
        <div class="panel"><h2>Genes by Category</h2><div id="genesChart" class="chart-container"></div></div>
        <div class="panel"><h2>Capsules by Outcome</h2><div id="capsulesChart" class="chart-container"></div></div>
        <div class="panel"><h2>Asset Calls</h2><div id="callsChart" class="chart-container"></div></div>
      </div>
      <div class="grid-bottom">
        <div class="panel">
          <h2>Latest Pipeline Run</h2>
          <div id="latest-run">Loading...</div>
        </div>
        <div class="panel">
          <h2>Skills</h2>
          <div id="skills">Loading...</div>
        </div>
      </div>
    </section>

    <section data-view="pipelines" class="view">
      <div class="panel" style="margin-bottom: 16px;">
        <h2>Validation Score Trend</h2>
        <p class="muted small" style="margin:-8px 0 8px 0">Local validation outcome score per run (0.0 – 1.0). Higher = more stable + better heuristic delta + better predictive match.</p>
        <div id="scoreTrendChart" class="chart-container" style="height: 220px;"></div>
      </div>
      <div class="grid-bottom">
        <div class="panel">
          <h2>Pipeline Runs</h2>
          <div class="table-wrapper">
            <table id="runsTable">
              <thead><tr><th>Run ID</th><th>Status</th><th>Gene</th><th>Score</th><th>Updated</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <h2>Run Trace</h2>
          <div id="run-detail"><p style="color: var(--text-muted)">Select a run to inspect its trace.</p></div>
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
      <div class="panel">
        <div id="asset-list">Loading...</div>
      </div>
    </section>

    <section data-view="interactions" class="view">
      <div class="grid-charts">
        <div class="panel"><h2>Hub A2A by Action</h2><div id="hubActionChart" class="chart-container"></div></div>
        <div class="panel"><h2>Activity (last 30 days)</h2><div id="activityChart" class="chart-container"></div></div>
        <div class="panel"><h2>Mailbox by Type</h2><div id="mailboxChart" class="chart-container"></div></div>
      </div>
      <div class="panel">
        <h2>Hub Activity</h2>
        <p class="muted small" style="margin:-8px 0 12px 0">Unified timeline of every Hub interaction — connection lifecycle (hello/heartbeat/fetch), asset calls (search/reuse/publish) and ATP credit flows.</p>
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
      <div class="panel">
        <h2>Agent Interactions</h2>
        <p class="muted small" style="margin:-8px 0 12px 0">Mailbox messages, sessions and DMs (read-only, redacted).</p>
        <div id="agent-stream">Loading...</div>
      </div>
      <div class="panel">
        <h2>Proxy Snapshots</h2>
        <div id="proxy-snapshots" class="snapshot-grid">Loading...</div>
      </div>
    </section>

    <section data-view="personality" class="view">
      <div class="grid-charts">
        <div class="panel"><h2>Personality Traits</h2><div id="personalityChart" class="chart-container" style="height: 320px"></div></div>
        <div class="panel"><h2>Personality Detail</h2><div id="personality-detail">Loading...</div></div>
      </div>
      <div class="panel">
        <h2>Memory Graph (last 100 events)</h2>
        <div id="memory-graph-chart" class="chart-container" style="height: 480px"></div>
      </div>
    </section>
  </main>
  <script src="/app.js"></script>
</body>
</html>`;
}

module.exports = { getIndexHtml };
