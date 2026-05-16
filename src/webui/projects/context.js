'use strict';

const { runWithPathContext, getCurrentPathContext } = require('../../gep/pathContext');

function runWithProject(project, fn) {
  return runWithPathContext(project || null, fn);
}

function getCurrentProject() {
  return getCurrentPathContext();
}

module.exports = {
  runWithProject,
  getCurrentProject,
};
