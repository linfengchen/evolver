'use strict';

const { discoverProjects } = require('./discover');

function listProjects(opts = {}) {
  const projects = discoverProjects(opts);
  return {
    total: projects.length,
    defaultProjectId: projects[0] ? projects[0].id : null,
    projects,
  };
}

function resolveProject(projectId, opts = {}) {
  const { projects } = listProjects(opts);
  if (!projectId) return projects[0] || null;
  return projects.find((project) => project.id === projectId) || null;
}

module.exports = {
  listProjects,
  resolveProject,
};
