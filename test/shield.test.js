const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('shield', function () {
  const shield = require('../src/gep/shield');

  it('exports expected functions', function () {
    assert.strictEqual(typeof shield.activate, 'function');
    assert.strictEqual(typeof shield.check, 'function');
    assert.strictEqual(typeof shield.isDegraded, 'function');
    assert.strictEqual(typeof shield.protectModule, 'function');
  });

  it('isDegraded returns false when no debugger attached', function () {
    assert.strictEqual(shield.isDegraded(), false);
  });

  it('activate does not throw', function () {
    assert.doesNotThrow(function () { shield.activate(); });
  });

  it('check does not throw', function () {
    assert.doesNotThrow(function () { shield.check(); });
  });

  it('protectModule freezes an object', function () {
    const mod = { fn: function () {} };
    shield.protectModule(mod);
    assert.ok(Object.isFrozen(mod));
  });

  it('protectModule handles null gracefully', function () {
    assert.doesNotThrow(function () { shield.protectModule(null); });
  });

  it('module exports are frozen', function () {
    assert.ok(Object.isFrozen(shield));
  });
});
