'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Recursively collect .jsonl and .txt transcript files under a directory.
 * @param {string} dir
 * @param {number} maxDepth
 * @returns {{ path: string, name: string, time: number, size: number }[]}
 */
function collectTranscriptFiles(dir, maxDepth) {
  const results = [];
  function walk(d, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.isFile() && (ent.name.endsWith('.jsonl') || ent.name.endsWith('.txt'))) {
        const fp = path.join(d, ent.name);
        try {
          const st = fs.statSync(fp);
          results.push({ path: fp, name: ent.name, time: st.mtime.getTime(), size: st.size });
        } catch { /* skip unreadable */ }
      } else if (ent.isDirectory() && ent.name !== 'subagents' && ent.name !== 'node_modules') {
        walk(path.join(d, ent.name), depth + 1);
      }
    }
  }
  walk(dir, 0);
  return results;
}

/**
 * Read the first maxBytes bytes of a file.
 * @param {string} filePath
 * @param {number} [maxBytes=8192]
 * @returns {string}
 */
function readFileHead(filePath, maxBytes) {
  if (maxBytes === undefined) maxBytes = 8192;
  try {
    if (!fs.existsSync(filePath)) return '';
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    fs.closeSync(fd);
    return buffer.slice(0, bytesRead).toString('utf8');
  } catch (e) {
    return '';
  }
}

/**
 * Read the last `size` bytes of a file (tail read for recent logs).
 * @param {string} filePath
 * @param {number} [size=10000]
 * @returns {string}
 */
function readRecentLog(filePath, size) {
  if (size === undefined) size = 10000;
  try {
    if (!fs.existsSync(filePath)) return `[MISSING] ${filePath}`;
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    if (fileSize === 0) return '';
    const readSize = Math.min(size, fileSize);
    const buffer = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, fileSize - readSize));
    fs.closeSync(fd);
    return buffer.toString('utf8');
  } catch (e) {
    return `[ERROR READING ${filePath}: ${e.message}]`;
  }
}

module.exports = { collectTranscriptFiles, readFileHead, readRecentLog };
