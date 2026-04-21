// Tests for config.resolveHubUrl() introduced in v1.69.7.
//
// Before v1.69.7, several modules bound their HUB_URL at require()-time from
// process.env.A2A_HUB_URL || process.env.EVOMAP_HUB_URL || 'https://evomap.ai'.
// That meant setting A2A_HUB_URL at runtime (e.g. in tests or wrappers) did
// nothing. The new resolveHubUrl() re-reads env on every call.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

function freshConfig() {
  const resolved = require.resolve('../src/config');
  delete require.cache[resolved];
  return require(resolved);
}

describe('config.resolveHubUrl', () => {
  const savedEnv = {};
  const envKeys = ['A2A_HUB_URL', 'EVOMAP_HUB_URL', 'EVOLVER_DEFAULT_HUB_URL'];

  beforeEach(() => {
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
  });

  it('falls back to PUBLIC_DEFAULT_HUB_URL when no env is set', () => {
    const { resolveHubUrl, PUBLIC_DEFAULT_HUB_URL } = freshConfig();
    assert.equal(resolveHubUrl(), 'https://evomap.ai');
    assert.equal(PUBLIC_DEFAULT_HUB_URL, 'https://evomap.ai');
  });

  it('A2A_HUB_URL takes highest priority', () => {
    process.env.A2A_HUB_URL = 'http://primary.example.com';
    process.env.EVOMAP_HUB_URL = 'http://secondary.example.com';
    process.env.EVOLVER_DEFAULT_HUB_URL = 'http://deployment.example.com';
    const { resolveHubUrl } = freshConfig();
    assert.equal(resolveHubUrl(), 'http://primary.example.com');
  });

  it('EVOMAP_HUB_URL wins when A2A_HUB_URL is empty', () => {
    process.env.EVOMAP_HUB_URL = 'http://legacy.example.com';
    process.env.EVOLVER_DEFAULT_HUB_URL = 'http://deployment.example.com';
    const { resolveHubUrl } = freshConfig();
    assert.equal(resolveHubUrl(), 'http://legacy.example.com');
  });

  it('EVOLVER_DEFAULT_HUB_URL is honored for air-gapped deployments', () => {
    process.env.EVOLVER_DEFAULT_HUB_URL = 'http://private-hub.internal';
    const { resolveHubUrl } = freshConfig();
    assert.equal(resolveHubUrl(), 'http://private-hub.internal');
  });

  it('re-reads env on every call (lazy)', () => {
    const { resolveHubUrl } = freshConfig();
    assert.equal(resolveHubUrl(), 'https://evomap.ai');

    process.env.A2A_HUB_URL = 'http://first.example.com';
    assert.equal(resolveHubUrl(), 'http://first.example.com');

    process.env.A2A_HUB_URL = 'http://second.example.com';
    assert.equal(resolveHubUrl(), 'http://second.example.com');

    delete process.env.A2A_HUB_URL;
    assert.equal(resolveHubUrl(), 'https://evomap.ai');
  });

  it('treats empty-string env vars the same as unset', () => {
    process.env.A2A_HUB_URL = '';
    process.env.EVOMAP_HUB_URL = '';
    const { resolveHubUrl } = freshConfig();
    assert.equal(resolveHubUrl(), 'https://evomap.ai');
  });
});
