'use strict';

var _envSnapshot = null;
var _shieldActive = false;
var _degraded = false;

var WATCHED_ENV_KEYS = [
  'EVOLVER_SOLIDIFY_VERIFY',
  'A2A_HUB_URL',
  'NODE_OPTIONS',
  'NODE_DEBUG',
];

var DEBUG_FLAGS = [
  '--inspect', '--inspect-brk', '--inspect-port',
  '--debug', '--debug-brk', '--debug-port',
];

function detectDebugger() {
  var execArgv = process.execArgv || [];
  for (var i = 0; i < execArgv.length; i++) {
    var arg = String(execArgv[i]).toLowerCase();
    for (var j = 0; j < DEBUG_FLAGS.length; j++) {
      if (arg.indexOf(DEBUG_FLAGS[j]) === 0) return true;
    }
  }

  if (typeof global !== 'undefined' && global.v8debug) return true;

  var nodeOpts = String(process.env.NODE_OPTIONS || '').toLowerCase();
  for (var k = 0; k < DEBUG_FLAGS.length; k++) {
    if (nodeOpts.indexOf(DEBUG_FLAGS[k]) !== -1) return true;
  }

  try {
    var inspector = require('inspector');
    if (inspector.url && inspector.url()) return true;
  } catch (e) {}

  return false;
}

function snapshotEnv() {
  var snap = {};
  for (var i = 0; i < WATCHED_ENV_KEYS.length; i++) {
    var key = WATCHED_ENV_KEYS[i];
    snap[key] = process.env[key] || '';
  }
  return snap;
}

function envTampered() {
  if (!_envSnapshot) return false;
  for (var i = 0; i < WATCHED_ENV_KEYS.length; i++) {
    var key = WATCHED_ENV_KEYS[i];
    var current = process.env[key] || '';
    if (current !== _envSnapshot[key]) return true;
  }
  return false;
}

function freezeExports(moduleObj) {
  if (!moduleObj || typeof moduleObj !== 'object') return;
  var keys = Object.keys(moduleObj);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (typeof moduleObj[key] === 'function') {
      try {
        Object.defineProperty(moduleObj, key, {
          value: moduleObj[key],
          writable: false,
          configurable: false,
        });
      } catch (e) {}
    }
  }
  try { Object.freeze(moduleObj); } catch (e) {}
}

function activate() {
  if (_shieldActive) return;
  _shieldActive = true;
  _envSnapshot = snapshotEnv();

  if (detectDebugger()) {
    _degraded = true;
  }
}

function check() {
  if (!_shieldActive) return;
  if (_degraded) return;

  if (detectDebugger()) {
    _degraded = true;
    return;
  }

  if (envTampered()) {
    _degraded = true;
  }
}

function isDegraded() {
  return _degraded;
}

function protectModule(mod) {
  freezeExports(mod);
}

var _self = module.exports = {
  activate,
  check,
  isDegraded,
  protectModule,
};

try { Object.freeze(_self); } catch (e) {}
