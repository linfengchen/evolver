'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { WebUiServer } = require('../src/webui');

function request(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, body: raw });
      });
    }).on('error', reject);
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
    // Dashboard must load echarts from the vendored local route, not from a
    // third-party CDN. Privacy + offline-availability requirement.
    assert.match(res.body, /<script src="\/vendor\/echarts\.min\.js"><\/script>/);
    assert.doesNotMatch(res.body, /cdn\.jsdelivr\.net|unpkg\.com/);
  });

  it('serves the vendored echarts bundle with the Apache-2.0 header', async () => {
    const res = await request(`${baseUrl}/vendor/echarts.min.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/javascript/);
    // First-line ASF license banner is preserved by the upstream minifier;
    // its presence is a cheap integrity hint that we shipped the real file
    // (and a license-attribution check).
    assert.match(res.body.slice(0, 200), /Apache Software Foundation/);
    assert.ok(res.body.length > 500000, 'vendored echarts looks truncated');
  });

  it('serves read-only status API with structured JSON', async () => {
    const res = await request(`${baseUrl}/webui/status`);
    const body = JSON.parse(res.body);
    assert.equal(res.status, 200);
    assert.ok(body.safety);
    assert.ok(body.filesPresent);
  });

  it('uses structured API errors', async () => {
    const res = await request(`${baseUrl}/webui/runs/missing-run-id`);
    const body = JSON.parse(res.body);
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'RUN_NOT_FOUND');
  });
});
