'use strict';

exports.commonJs = `
const state = { selectedRunId: null, charts: {}, currentTab: 'overview', currentAsset: 'genes' };
const $ = (id) => document.getElementById(id);

async function api(path) {
  const res = await fetch(path);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || 'Request failed');
  return body;
}

function isDarkMode() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function chartTextColor() {
  return isDarkMode() ? '#c7d0d9' : '#5c6975';
}

function ensureChart(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  if (!state.charts[id]) state.charts[id] = echarts.init(el);
  return state.charts[id];
}

function getStatusClass(status) {
  if (status === 'success' || status === 'completed') return 'status-success';
  if (status === 'running' || status === 'pending') return 'status-running';
  if (status === 'failed') return 'status-failed';
  if (status === 'blocked' || status === 'review_pending') return 'status-blocked';
  if (status === 'abandoned') return 'status-abandoned';
  if (status === 'selected') return 'status-running';
  return 'status-skipped';
}

function kv(rows) {
  return '<dl>' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(format(v)) + '</dd>').join('') + '</dl>';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function format(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function formatTime(value) {
  if (!value) return '-';
  const t = new Date(value);
  if (isNaN(t.getTime()) || t.getTime() === 0) return '-';
  return t.toLocaleString();
}

function pillList(items, kind) {
  if (!items || !items.length) return '<span class="muted">none</span>';
  return items.map((item) => '<span class="pill ' + (kind || '') + '">' + esc(item) + '</span>').join(' ');
}
`;
