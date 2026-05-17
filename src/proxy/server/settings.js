'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_DIR = path.join(os.homedir(), '.evolver');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

function getSettingsDir() {
  return process.env.EVOLVER_SETTINGS_DIR || SETTINGS_DIR;
}

function getSettingsFile() {
  return process.env.EVOLVER_SETTINGS_FILE || path.join(getSettingsDir(), 'settings.json');
}

function readSettings() {
  try {
    const settingsFile = getSettingsFile();
    if (fs.existsSync(settingsFile)) {
      return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    }
  } catch {}
  return {};
}

function writeSettings(data) {
  const settingsFile = getSettingsFile();
  const settingsDir = path.dirname(settingsFile);
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }
  const current = readSettings();
  const merged = { ...current, ...data };
  fs.writeFileSync(settingsFile, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function clearSettings() {
  try {
    const settingsFile = getSettingsFile();
    if (fs.existsSync(settingsFile)) {
      const current = readSettings();
      delete current.proxy;
      fs.writeFileSync(settingsFile, JSON.stringify(current, null, 2), 'utf8');
    }
  } catch {}
}

function isStaleProxy() {
  const settings = readSettings();
  const pid = settings.proxy?.pid;
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

function clearIfStale() {
  if (isStaleProxy()) {
    clearSettings();
    return true;
  }
  return false;
}

function getProxyUrl() {
  const settings = readSettings();
  return settings.proxy?.url || null;
}

module.exports = {
  readSettings,
  writeSettings,
  clearSettings,
  clearIfStale,
  isStaleProxy,
  getProxyUrl,
  getSettingsDir,
  getSettingsFile,
  SETTINGS_DIR,
  SETTINGS_FILE,
};
