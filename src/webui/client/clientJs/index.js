'use strict';

const { commonJs } = require('./common');
const { i18nJs } = require('./i18n');
const { overviewJs } = require('./overview');
const { pipelinesJs } = require('./pipelines');
const { assetsJs } = require('./assets');
const { interactionsJs } = require('./interactions');
const { personalityJs } = require('./personality');
const { versionJs } = require('./version');
const { bootstrapJs } = require('./bootstrap');

const SECTION_HEADERS = {
  overview: '// ---- Overview ----',
  i18n: '// ---- I18n ----',
  pipelines: '// ---- Pipelines ----',
  assets: '// ---- Assets ----',
  interactions: '// ---- Interactions (Hub Activity unified timeline + Agent) ----',
  personality: '// ---- Personality ----',
  version: '// ---- Version Card ----',
  bootstrap: '// ---- Tabs ----',
};

function getClientJs() {
  return [
    commonJs,
    SECTION_HEADERS.i18n, i18nJs,
    SECTION_HEADERS.overview, overviewJs,
    SECTION_HEADERS.pipelines, pipelinesJs,
    SECTION_HEADERS.assets, assetsJs,
    SECTION_HEADERS.interactions, interactionsJs,
    SECTION_HEADERS.personality, personalityJs,
    SECTION_HEADERS.version, versionJs,
    SECTION_HEADERS.bootstrap, bootstrapJs,
  ].join('\n');
}

module.exports = { getClientJs };
