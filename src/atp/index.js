// ATP (Agent Transaction Protocol) Module
// Low-commission agent-to-agent transaction network.
//
// Sub-modules:
//   hubClient      - Hub API client for ATP endpoints
//   merchantAgent  - ready-to-use merchant agent template
//   consumerAgent  - ready-to-use consumer agent template
//   serviceHelper  - service publishing helper

const hubClient = require('./hubClient');
const merchantAgent = require('./merchantAgent');
const consumerAgent = require('./consumerAgent');
const serviceHelper = require('./serviceHelper');

module.exports = {
  hubClient,
  merchantAgent,
  consumerAgent,
  serviceHelper,
};
