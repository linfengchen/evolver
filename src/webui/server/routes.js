'use strict';

const observer = require('../observer');

function buildWebUiRoutes() {
  return {
    'GET /webui/status': async () => ({ body: observer.getStatus() }),
    'GET /webui/safety': async () => ({ body: observer.getSafetyState() }),
    'GET /webui/runs': async ({ query }) => ({ body: observer.listRuns(query) }),
    'GET /webui/runs/:runId': async ({ params }) => {
      const run = observer.getRun(params.runId);
      if (!run) throw httpError(404, 'RUN_NOT_FOUND', 'Run not found');
      return { body: run };
    },
    'GET /webui/assets': async ({ query }) => ({ body: observer.getAssetOverview(query) }),
    'GET /webui/assets/genes': async ({ query }) => ({ body: observer.listGenes(query) }),
    'GET /webui/assets/capsules': async ({ query }) => ({ body: observer.listCapsules(query) }),
    'GET /webui/assets/events': async ({ query }) => ({ body: observer.listEvents(query) }),
    'GET /webui/assets/candidates': async ({ query }) => ({ body: observer.listCandidates(query) }),
    'GET /webui/assets/calls': async ({ query }) => ({ body: observer.listAssetCalls(query) }),
    'GET /webui/assets/lineage/:id': async ({ params }) => ({ body: observer.getLineage(params.id) }),
    'GET /webui/interactions': async ({ query }) => ({ body: await observer.getInteractions(query) }),
    'GET /webui/personality': async () => ({ body: observer.getPersonality() }),
    'GET /webui/memory-graph': async ({ query }) => ({ body: observer.getMemoryGraph(query) }),
    'GET /webui/skills': async () => ({ body: observer.listSkills() }),
    'GET /webui/logs/evolver': async ({ query }) => ({ body: observer.getEvolverLog(query) }),
    'GET /webui/observability/spans': async ({ query }) => ({ body: observer.listObservabilitySpans(query) }),
    'GET /webui/observability/traces/:traceId': async ({ params }) => {
      const trace = observer.getObservabilityTrace(params.traceId);
      if (!trace) throw httpError(404, 'TRACE_NOT_FOUND', 'Trace not found');
      return { body: trace };
    },
  };
}

function httpError(statusCode, code, message, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  err.details = details || {};
  return err;
}

module.exports = {
  buildWebUiRoutes,
  httpError,
};
