'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/**
 * @internal
 * Run a function with request-local Evolver path overrides.
 */
function runWithPathContext(context, fn) {
  return storage.run(context || null, fn);
}

/**
 * @internal
 * Return the active request-local path overrides, if any.
 */
function getCurrentPathContext() {
  return storage.getStore() || null;
}

module.exports = {
  runWithPathContext,
  getCurrentPathContext,
};
