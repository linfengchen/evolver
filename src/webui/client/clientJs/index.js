'use strict';

const { commonJs } = require('./common');
const { overviewJs } = require('./overview');
const { pipelinesJs } = require('./pipelines');
const { assetsJs } = require('./assets');
const { interactionsJs } = require('./interactions');
const { personalityJs } = require('./personality');
const { bootstrapJs } = require('./bootstrap');

const SECTION_HEADERS = {
  overview: '// ---- Overview ----',
  pipelines: '// ---- Pipelines ----',
  assets: '// ---- Assets ----',
  interactions: '// ---- Interactions (Hub Activity unified timeline + Agent) ----',
  personality: '// ---- Personality ----',
  bootstrap: '// ---- Tabs ----',
};

function getClientJs() {
  return [
    commonJs,
    SECTION_HEADERS.overview, overviewJs,
    SECTION_HEADERS.pipelines, pipelinesJs,
    SECTION_HEADERS.assets, assetsJs,
    SECTION_HEADERS.interactions, interactionsJs,
    SECTION_HEADERS.personality, personalityJs,
    SECTION_HEADERS.bootstrap, bootstrapJs,
  ].join('\n');
}

module.exports = { getClientJs };
