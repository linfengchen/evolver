// ATP (Agent Transaction Protocol) Module
// Low-commission agent-to-agent transaction network.
//
// Sub-modules:
//   hubClient       - Hub API client for ATP endpoints
//   merchantAgent   - ready-to-use merchant agent template
//   consumerAgent   - ready-to-use consumer agent template
//   serviceHelper   - service publishing helper
//   defaultHandler  - default order handler + config helpers for auto-ATP

const hubClient = require('./hubClient');
const merchantAgent = require('./merchantAgent');
const consumerAgent = require('./consumerAgent');
const serviceHelper = require('./serviceHelper');
const defaultHandler = require('./defaultHandler');

module.exports = {
  hubClient,
  merchantAgent,
  consumerAgent,
  serviceHelper,
  defaultHandler,
};
