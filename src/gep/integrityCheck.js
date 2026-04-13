'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INTEGRITY_FILE = path.join(__dirname, '.integrity');

let _verified = null;
let _degraded = false;

function sha256File(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest();
  } catch (e) {
    return null;
  }
}

function loadManifest() {
  try {
    if (!fs.existsSync(INTEGRITY_FILE)) return null;
    const raw = fs.readFileSync(INTEGRITY_FILE);
    if (raw.length < 4) return null;

    const count = raw.readUInt16BE(0);
    const nameLen = raw.readUInt16BE(2);
    let offset = 4;
    const entries = [];

    for (let i = 0; i < count; i++) {
      const name = raw.slice(offset, offset + nameLen).toString('utf8').replace(/\0+$/, '');
      offset += nameLen;
      const hash = raw.slice(offset, offset + 32);
      offset += 32;
      entries.push({ name, hash });
    }
    return entries;
  } catch (e) {
    return null;
  }
}

function verify() {
  if (_verified !== null) return _verified;

  const manifest = loadManifest();
  if (!manifest || manifest.length === 0) {
    _verified = true;
    return true;
  }

  let ok = true;
  for (const entry of manifest) {
    const filePath = path.join(__dirname, '..', '..', entry.name);
    const actual = sha256File(filePath);
    if (!actual || !crypto.timingSafeEqual(actual, entry.hash)) {
      ok = false;
      break;
    }
  }

  _verified = ok;
  if (!ok) _degraded = true;
  return ok;
}

function isDegraded() {
  return _degraded;
}

function degradedDelay() {
  if (!_degraded) return Promise.resolve();
  const ms = 800 + Math.floor(Math.random() * 1200);
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function gate(value) {
  if (!_degraded) return value;
  if (typeof value === 'object' && value !== null) {
    return Object.assign({}, value, { ok: false, error: 'internal_constraint' });
  }
  return null;
}

module.exports = {
  verify,
  isDegraded,
  degradedDelay,
  gate,
};
