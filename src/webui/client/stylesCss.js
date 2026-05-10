'use strict';

function getStylesCss() {
  return `
:root {
  --bg-color: #111217;
  --panel-bg: #181b1f;
  --border-color: #2c3235;
  --text-main: #c7d0d9;
  --text-muted: #8e99a4;
  --accent: #3274d9;
  --success: #28a745;
  --warning: #ffc107;
  --danger: #dc3545;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg-color: #f4f5f5;
    --panel-bg: #ffffff;
    --border-color: #e4e7eb;
    --text-main: #24292e;
    --text-muted: #5c6975;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg-color); color: var(--text-main); font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
header { display: flex; justify-content: space-between; align-items: center; padding: 12px 24px; background: var(--panel-bg); border-bottom: 1px solid var(--border-color); gap: 16px; }
h1 { font-size: 1.1rem; margin: 0; font-weight: 600; }
h2 { font-size: 0.85rem; margin: 0 0 14px 0; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
h3 { font-size: 1rem; margin: 0 0 8px 0; }
h4 { font-size: 0.85rem; margin: 0 0 8px 0; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.eyebrow { font-size: 0.7rem; color: var(--text-muted); margin: 0 0 2px 0; text-transform: uppercase; letter-spacing: 0.1em; }
main { padding: 24px; }

.tabs { display: flex; gap: 4px; flex: 1; justify-content: center; }
.tab { background: transparent; color: var(--text-muted); border: 1px solid transparent; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.9rem; }
.tab.active { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
.tab:hover { color: var(--text-main); }

.view { display: none; flex-direction: column; gap: 24px; }
.view.active { display: flex; }
.grid-top { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; }
.grid-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; }
.grid-bottom { display: grid; grid-template-columns: 1fr 2fr; gap: 24px; }
@media (max-width: 1100px) { .grid-bottom { grid-template-columns: 1fr; } }

.panel { background: var(--panel-bg); border: 1px solid var(--border-color); border-radius: 6px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.chart-container { width: 100%; height: 240px; }
button { background: var(--accent); color: #fff; border: none; border-radius: 4px; padding: 7px 14px; cursor: pointer; font-weight: 500; font-size: 0.85rem; transition: opacity 0.2s; }
button:hover { opacity: 0.9; }
code { background: color-mix(in srgb, var(--text-main) 8%, transparent); padding: 1px 6px; border-radius: 3px; font-size: 0.85em; }
.muted { color: var(--text-muted); }
.small { font-size: 0.78rem; }

dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: 0.88rem; }
dt { color: var(--text-muted); }
dd { margin: 0; font-weight: 500; word-break: break-all; }

.table-wrapper { overflow-x: auto; margin: -18px; margin-top: 0; }
table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
th, td { padding: 10px 18px; text-align: left; border-bottom: 1px solid var(--border-color); vertical-align: top; }
th { color: var(--text-muted); font-weight: 500; background: color-mix(in srgb, var(--panel-bg) 95%, var(--text-main) 5%); position: sticky; top: 0; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
tr:last-child td { border-bottom: none; }
#runsTable tbody tr:hover td { background: color-mix(in srgb, var(--text-main) 4%, transparent); cursor: pointer; }

.data-table { width: 100%; }
.data-table td details summary { cursor: pointer; color: var(--accent); }

.status-indicator { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
.status-success { background: var(--success); }
.status-running { background: var(--accent); }
.status-failed { background: var(--danger); }
.status-blocked { background: var(--warning); }
.status-skipped { background: var(--text-muted); }
.status-warning { background: var(--warning); }
.status-abandoned { background: color-mix(in srgb, var(--warning) 60%, var(--text-muted)); }

.pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); margin: 2px 2px 2px 0; }
.pill.repair { background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }
.pill.optimize { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
.pill.innovate { background: color-mix(in srgb, var(--success) 18%, transparent); color: var(--success); }
.pill.explore { background: color-mix(in srgb, var(--warning) 22%, transparent); color: var(--warning); }
.pill.signal { background: color-mix(in srgb, var(--warning) 16%, transparent); color: var(--warning); }
.pill.asset_publish, .pill.asset_publish_skip { background: color-mix(in srgb, var(--success) 18%, transparent); color: var(--success); }
.pill.hub_search_hit { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
.pill.asset_reuse, .pill.asset_reference { background: color-mix(in srgb, #6f42c1 22%, transparent); color: #b388f7; }

.timeline { list-style: none; padding: 0; margin: 0; position: relative; }
.timeline::before { content: ''; position: absolute; left: 11px; top: 4px; bottom: 0; width: 2px; background: var(--border-color); }
.timeline li { position: relative; padding: 0 0 18px 32px; }
.timeline li:last-child { padding-bottom: 0; }
.timeline li::before { content: ''; position: absolute; left: 6px; top: 4px; width: 12px; height: 12px; border-radius: 50%; background: var(--panel-bg); border: 2px solid var(--border-color); z-index: 1; }
.timeline li.success::before { border-color: var(--success); background: var(--success); }
.timeline li.running::before { border-color: var(--accent); background: var(--accent); }
.timeline li.failed::before { border-color: var(--danger); background: var(--danger); }
.timeline li.blocked::before { border-color: var(--warning); background: var(--warning); }
.timeline-title { font-weight: 600; font-size: 0.95rem; margin-bottom: 4px; line-height: 1; }
.timeline-desc { font-size: 0.85rem; color: var(--text-muted); margin: 0; line-height: 1.4; }

.run-header { margin-bottom: 16px; }
.run-meta { display: flex; gap: 18px; font-size: 0.85rem; color: var(--text-muted); flex-wrap: wrap; margin-top: 4px; }
.run-meta strong { color: var(--text-main); }
.run-body { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 18px; }
@media (max-width: 1000px) { .run-body { grid-template-columns: 1fr; } }
.run-detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; padding-top: 16px; border-top: 1px solid var(--border-color); }
.detail-block { background: color-mix(in srgb, var(--panel-bg) 96%, var(--text-main) 4%); border: 1px solid var(--border-color); border-radius: 6px; padding: 14px; }
.detail-block h4 { margin: 0 0 8px 0; }
.reason-list { padding-left: 18px; margin: 4px 0; font-size: 0.83rem; }
.reason-list li { margin: 2px 0; }
.snippet { font-size: 0.78rem; background: color-mix(in srgb, var(--text-main) 8%, transparent); padding: 8px; border-radius: 4px; max-height: 180px; overflow: auto; white-space: pre-wrap; word-break: break-word; }

.filter-bar { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; padding: 8px 0 12px 0; border-bottom: 1px solid var(--border-color); margin-bottom: 12px; }
.filter-group { display: flex; gap: 6px; align-items: center; }
.filter-label { font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.filter-pill { background: transparent; color: var(--text-muted); border: 1px solid var(--border-color); padding: 4px 12px; border-radius: 999px; cursor: pointer; font-size: 0.8rem; }
.filter-pill:hover { color: var(--text-main); border-color: var(--accent); }
.filter-pill.active { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.filter-toggle { display: flex; gap: 6px; align-items: center; font-size: 0.82rem; color: var(--text-muted); cursor: pointer; }

.lifecycle-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 14px; }
.stat-box { background: color-mix(in srgb, var(--panel-bg) 95%, var(--text-main) 5%); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px 12px; }
.stat-box.success { border-color: color-mix(in srgb, #28a745 40%, var(--border-color)); }
.stat-box.pending { border-color: color-mix(in srgb, #ffc107 40%, var(--border-color)); }
.stat-box.failed { border-color: color-mix(in srgb, #dc3545 40%, var(--border-color)); }
.stat-label { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.stat-value { font-size: 1.05rem; font-weight: 600; margin-top: 4px; }
.lifecycle-last-error { grid-column: 1 / -1; padding: 8px 12px; border-radius: 4px; background: color-mix(in srgb, #dc3545 10%, transparent); border: 1px solid color-mix(in srgb, #dc3545 30%, transparent); font-size: 0.85rem; }
.lifecycle-table { font-size: 0.82rem; }
.lifecycle-table tr.fail td { color: #dc3545; }
.lifecycle-error { font-family: ui-monospace, monospace; font-size: 0.78rem; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pill.hello { background: color-mix(in srgb, #3274d9 20%, transparent); color: #3274d9; }
.pill.heartbeat { background: color-mix(in srgb, #28a745 20%, transparent); color: #28a745; }
.pill.fetch { background: color-mix(in srgb, #6f42c1 20%, transparent); color: #6f42c1; }
.pill.lifecycle { background: color-mix(in srgb, #3274d9 18%, transparent); color: #3274d9; }
.pill.asset { background: color-mix(in srgb, #e3a008 20%, transparent); color: #e3a008; }
.pill.atp { background: color-mix(in srgb, #6f42c1 18%, transparent); color: #6f42c1; }

.score-bar { position: relative; display: inline-block; width: 90px; height: 16px; background: color-mix(in srgb, var(--text-main) 10%, transparent); border-radius: 4px; overflow: hidden; vertical-align: middle; }
.score-bar-lg { width: 240px; height: 22px; }
.score-bar-fill { height: 100%; transition: width 0.4s ease; }
.score-bar-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 600; color: var(--text-main); text-shadow: 0 0 2px var(--panel-bg); }
.validation-block { grid-column: span 2; }
.validation-summary { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; margin-bottom: 10px; }
.validation-status { display: flex; align-items: center; gap: 6px; font-size: 0.95rem; }
.validation-score-wrap { display: flex; align-items: center; gap: 10px; }
.validation-score-label { font-size: 0.78rem; color: var(--text-muted); }
.validation-dims { margin: 6px 0; }
.validation-dim { background: color-mix(in srgb, #28a745 20%, transparent) !important; color: #28a745 !important; }
.validation-observed { margin-top: 6px; font-size: 0.82rem; }
.validation-predictive { margin-top: 8px; font-size: 0.82rem; }
.validation-predictive summary { cursor: pointer; color: var(--accent); }

.skill-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.skill-list li { padding: 10px 0; border-bottom: 1px solid var(--border-color); }
.skill-list li:last-child { border: none; }
.skill-list p { margin: 4px 0; font-size: 0.85rem; }

.asset-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.asset-tab { background: var(--panel-bg); color: var(--text-muted); border: 1px solid var(--border-color); padding: 6px 14px; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 0.85rem; }
.asset-tab.active { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 30%, transparent); border-bottom-color: transparent; }

.event-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.event-list li { padding: 12px; background: color-mix(in srgb, var(--panel-bg) 96%, var(--text-main) 4%); border-radius: 6px; font-size: 0.85rem; display: flex; flex-direction: column; gap: 4px; }

.stream-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; max-height: 540px; overflow-y: auto; }
.stream-item { padding: 10px 12px; background: color-mix(in srgb, var(--panel-bg) 96%, var(--text-main) 4%); border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0; font-size: 0.85rem; }
.stream-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.stream-title { font-weight: 500; word-break: break-all; }
.snapshot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.snapshot-grid .snapshot-empty { grid-column: 1 / -1; margin: 0; white-space: nowrap; }
.snapshot-card { padding: 12px; background: color-mix(in srgb, var(--panel-bg) 96%, var(--text-main) 4%); border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.85rem; }
`;
}

module.exports = { getStylesCss };
