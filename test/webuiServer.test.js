'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { WebUiServer } = require('../src/webui');

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const body = opts.body ? JSON.stringify(opts.body) : null;
    const req = http.request(url, {
      method: opts.method || 'GET',
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      } : undefined,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, body: raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('WebUiServer', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = new WebUiServer({
      port: 39921,
      logger: { log: () => {}, error: () => {}, warn: () => {} },
    });
    const info = await server.start();
    baseUrl = info.url;
  });

  after(async () => {
    await server.stop();
  });

  it('serves the dashboard shell', async () => {
    const res = await request(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /Evolver Web UI/);
  });

  it('serves read-only status API with structured JSON', async () => {
    const res = await request(`${baseUrl}/webui/status`);
    const body = JSON.parse(res.body);
    assert.equal(res.status, 200);
    assert.ok(body.safety);
    assert.ok(body.filesPresent);
  });

  it('serves current version and service status', async () => {
    const res = await request(`${baseUrl}/webui/version`);
    const body = JSON.parse(res.body);
    assert.equal(res.status, 200);
    assert.equal(body.packageName, '@evomap/evolver');
    assert.match(body.currentVersion, /^\d+\.\d+\.\d+/);
    assert.equal(body.webui.running, true);
    assert.equal(body.webui.port, 39921);
    assert.ok(body.update.command);
  });

  it('uses structured API errors', async () => {
    const res = await request(`${baseUrl}/webui/runs/missing-run-id`);
    const body = JSON.parse(res.body);
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'RUN_NOT_FOUND');
  });

  it('rejects unsafe skill fetch ids before executing', async () => {
    const res = await request(`${baseUrl}/webui/skills/fetch`, {
      method: 'POST',
      body: { skillId: '../bad' },
    });
    const body = JSON.parse(res.body);
    assert.equal(res.status, 400);
    assert.equal(body.error.code, 'INVALID_SKILL_ID');
  });
});
