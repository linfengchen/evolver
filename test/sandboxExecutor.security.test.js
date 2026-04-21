'use strict';

// Regression tests for the v1.69.8 security hardening of sandboxExecutor.
// See GH issue #451 (H1 — shell injection via spawn({shell:true})).

const test = require('node:test');
const assert = require('node:assert');

const { parseCommand, ALLOWED_EXECUTABLES } = require('../src/gep/validator/sandboxExecutor');

test('parseCommand splits a simple command', () => {
  const r = parseCommand('node index.js');
  assert.strictEqual(r.executable, 'node');
  assert.deepStrictEqual(r.args, ['index.js']);
});

test('parseCommand handles quoted args with spaces', () => {
  const r = parseCommand('node "my script.js" --flag value');
  assert.strictEqual(r.executable, 'node');
  assert.deepStrictEqual(r.args, ['my script.js', '--flag', 'value']);
});

test('parseCommand rejects shell metacharacters', () => {
  for (const bad of [
    'node idx.js; rm -rf /',
    'node idx.js && echo pwn',
    'node idx.js | tee pwn.log',
    'node idx.js `cat /etc/passwd`',
    'node idx.js $(cat /etc/passwd)',
    'node idx.js > /tmp/x',
    'node idx.js < /tmp/x',
    'node idx.js & background',
  ]) {
    assert.throws(
      () => parseCommand(bad),
      /metacharacter|shell/i,
      'expected ' + bad + ' to be rejected',
    );
  }
});

test('parseCommand rejects empty and non-string input', () => {
  assert.throws(() => parseCommand(''));
  assert.throws(() => parseCommand(null));
  assert.throws(() => parseCommand(123));
});

test('ALLOWED_EXECUTABLES contains only node/npm/npx', () => {
  const allowed = Array.from(ALLOWED_EXECUTABLES).sort();
  assert.deepStrictEqual(allowed, ['node', 'npm', 'npx']);
});

test('ALLOWED_EXECUTABLES rejects shell and arbitrary binaries', () => {
  for (const binary of ['bash', 'sh', 'zsh', 'cmd', 'python', 'curl', 'wget', 'rm']) {
    assert.strictEqual(
      ALLOWED_EXECUTABLES.has(binary),
      false,
      binary + ' must not be in the allowlist',
    );
  }
});
