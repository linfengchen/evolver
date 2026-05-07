'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { getWorkspaceRoot, getMemoryDir, getSessionScope, getAgentSessionsDir, getEvolutionDir } = require('../../gep/paths');
const { captureLocalState } = require('../../gep/localStateAwareness');
const { collectTranscriptFiles, readRecentLog } = require('../utils');

const MAX_EXEC_BUFFER = 10 * 1024 * 1024;

// Derived constants — same values as the module-level constants in evolve.js
const AGENT_NAME = process.env.AGENT_NAME || 'main';
const AGENT_SESSIONS_DIR = getAgentSessionsDir();
const CURSOR_TRANSCRIPTS_DIR = process.env.EVOLVER_CURSOR_TRANSCRIPTS_DIR || '';
const SESSION_SOURCE = (process.env.EVOLVER_SESSION_SOURCE || 'auto').toLowerCase();
const MEMORY_DIR = getMemoryDir();
const TODAY_LOG = path.join(MEMORY_DIR, new Date().toISOString().split('T')[0] + '.md');
const STATE_FILE = path.join(getEvolutionDir(), 'evolution_state.json');

const WORKSPACE_ROOT = getWorkspaceRoot();
const ROOT_MEMORY = path.join(WORKSPACE_ROOT, 'MEMORY.md');
const DIR_MEMORY = path.join(MEMORY_DIR, 'MEMORY.md');
const MEMORY_FILE = fs.existsSync(ROOT_MEMORY) ? ROOT_MEMORY : (fs.existsSync(DIR_MEMORY) ? DIR_MEMORY : ROOT_MEMORY);
const USER_FILE = path.join(WORKSPACE_ROOT, 'USER.md');

// ---------------------------------------------------------------------------
// Session log formatters
// ---------------------------------------------------------------------------

function formatSessionLog(jsonlContent) {
  const result = [];
  const lines = jsonlContent.split('\n');
  let lastLine = '';
  let repeatCount = 0;

  const flushRepeats = () => {
    if (repeatCount > 0) {
      result.push(`   ... [Repeated ${repeatCount} times] ...`);
      repeatCount = 0;
    }
  };

  function extractContentArray(arr) {
    if (!Array.isArray(arr)) return '';
    return arr.map(c => {
      if (c.type === 'text' || c.type === 'input_text' || c.type === 'output_text')
        return c.text || '';
      if (c.type === 'tool_use' || c.type === 'toolCall' || c.type === 'function_call')
        return `[TOOL: ${c.name || 'unknown'}]`;
      if (c.type === 'tool_result')
        return c.is_error ? `[TOOL ERROR] ${String(c.content || '').slice(0, 200)}` : '';
      if (c.type === 'thinking') return '';
      return '';
    }).filter(Boolean).join(' ');
  }

  function extractContent(data) {
    const msg = data.message || {};
    const raw = msg.content || data.content;
    if (Array.isArray(raw)) return extractContentArray(raw);
    if (typeof raw === 'string') return raw;
    return '';
  }

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line);
      let entry = '';

      const isClaudeCode = data.type === 'user' || data.type === 'assistant';
      const isOpenClaw = data.type === 'message' && data.message && data.message.role !== 'toolResult';
      const isCursor = !data.type && data.role && data.message;
      const isCodexItem = (data.type === 'item.added' || data.type === 'item.completed') && data.item;
      const isManus = data.type === 'user_message' || data.type === 'assistant_message';
      const isManusToolUsed = data.type === 'tool_used';
      const isToolResult = data.type === 'tool_result' || (data.message && data.message.role === 'toolResult');

      if (isClaudeCode || isOpenClaw || isCursor) {
        const role = (
          (data.message && data.message.role) || data.role || data.type || 'unknown'
        ).toUpperCase();
        let content = extractContent(data);

        if (data.message && data.message.errorMessage) {
          const errMsg = typeof data.message.errorMessage === 'string'
            ? data.message.errorMessage
            : JSON.stringify(data.message.errorMessage);
          content = `[LLM ERROR] ${errMsg.replace(/\n+/g, ' ').slice(0, 300)}`;
        }

        if (content.trim() === 'HEARTBEAT_OK') continue;
        if (content.includes('NO_REPLY') && !(data.message && data.message.errorMessage)) continue;
        if (data.isMeta) continue;

        content = content.replace(/\n+/g, ' ').slice(0, 300);
        if (content.trim()) {
          entry = `**${role}**: ${content}`;
        }

      } else if (isCodexItem) {
        const item = data.item;
        if (item.type === 'message') {
          const role = (item.role || 'unknown').toUpperCase();
          const content = Array.isArray(item.content)
            ? extractContentArray(item.content)
            : (typeof item.content === 'string' ? item.content : '');
          if (content.trim()) {
            entry = `**${role}**: ${content.replace(/\n+/g, ' ').slice(0, 300)}`;
          }
        } else if (item.type === 'function_call') {
          entry = `[TOOL: ${item.name || item.call_id || 'unknown'}]`;
        } else if (item.type === 'function_call_output') {
          const out = (item.output || '').replace(/\n+/g, ' ').slice(0, 200);
          if (out.trim() && !(out.length < 50 && (out.includes('success') || out.includes('done')))) {
            entry = `[TOOL RESULT] ${out}${(item.output || '').length > 200 ? '...' : ''}`;
          }
        }

      } else if (isManus) {
        const payload = data[data.type] || {};
        const role = data.type === 'user_message' ? 'USER' : 'ASSISTANT';
        const content = (typeof payload.content === 'string' ? payload.content : '')
          .replace(/\n+/g, ' ').slice(0, 300);
        if (content.trim()) entry = `**${role}**: ${content}`;

      } else if (isManusToolUsed) {
        const tool = data.tool_used || {};
        entry = `[TOOL: ${tool.name || 'unknown'}]`;

      } else if (isToolResult) {
        let resContent = '';
        if (data.tool_result) {
          resContent = data.tool_result.output || JSON.stringify(data.tool_result);
        }
        if (data.content) {
          resContent = typeof data.content === 'string'
            ? data.content : JSON.stringify(data.content);
        }
        if (resContent.length < 50 && (resContent.includes('success') || resContent.includes('done'))) continue;
        if (resContent.trim() === '' || resContent === '{}') continue;
        const preview = resContent.replace(/\n+/g, ' ').slice(0, 200);
        entry = `[TOOL RESULT] ${preview}${resContent.length > 200 ? '...' : ''}`;
      }

      if (entry) {
        if (entry === lastLine) {
          repeatCount++;
        } else {
          flushRepeats();
          result.push(entry);
          lastLine = entry;
        }
      }
    } catch (_) { /* non-JSON line, skip */ }
  }
  flushRepeats();
  return result.join('\n');
}

function formatCursorTranscript(raw) {
  const lines = raw.split('\n');
  const result = [];
  let skipUntilNextBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === 'user:' || trimmed.startsWith('A:')) {
      skipUntilNextBlock = false;
      result.push(trimmed);
      continue;
    }

    if (trimmed.startsWith('[Tool call]')) {
      skipUntilNextBlock = true;
      result.push(`[Tool call] ${trimmed.replace('[Tool call]', '').trim()}`);
      continue;
    }

    if (trimmed.startsWith('[Tool result]')) {
      skipUntilNextBlock = true;
      continue;
    }

    if (skipUntilNextBlock) continue;

    if (trimmed.startsWith('<') && trimmed.endsWith('>')) continue;
    if (trimmed) {
      result.push(trimmed.slice(0, 300));
    }
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Session readers
// ---------------------------------------------------------------------------

function readCursorTranscripts() {
  if (!CURSOR_TRANSCRIPTS_DIR) return '';
  try {
    if (!fs.existsSync(CURSOR_TRANSCRIPTS_DIR)) return '';

    const now = Date.now();
    const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    const TARGET_BYTES = 120000;
    const PER_FILE_BYTES = 20000;
    const RECENCY_GUARD_MS = 30 * 1000;

    let files = collectTranscriptFiles(CURSOR_TRANSCRIPTS_DIR, 3)
      .filter(f => (now - f.time) < ACTIVE_WINDOW_MS)
      .sort((a, b) => b.time - a.time);

    if (files.length === 0) return '';

    if (files.length > 1 && (now - files[0].time) < RECENCY_GUARD_MS) {
      files = files.slice(1);
    }

    const maxFiles = Math.min(files.length, 6);
    const sections = [];
    let totalBytes = 0;

    for (let i = 0; i < maxFiles && totalBytes < TARGET_BYTES; i++) {
      const f = files[i];
      const bytesLeft = TARGET_BYTES - totalBytes;
      const readSize = Math.min(PER_FILE_BYTES, bytesLeft);
      const raw = readRecentLog(f.path, readSize);
      if (raw.trim() && !raw.startsWith('[MISSING]')) {
        const isJsonl = f.name.endsWith('.jsonl');
        const formatted = isJsonl ? formatSessionLog(raw) : formatCursorTranscript(raw);
        if (formatted.trim()) {
          const label = isJsonl ? 'SESSION' : 'CURSOR SESSION';
          sections.push(`--- ${label} (${f.name}) ---\n${formatted}`);
          totalBytes += formatted.length;
        }
      }
    }

    return sections.join('\n\n');
  } catch (e) {
    console.warn(`[CursorTranscripts] Read failed: ${e.message}`);
    return '';
  }
}

function readOpenClawSessions() {
  try {
    if (!fs.existsSync(AGENT_SESSIONS_DIR)) return '';
    const now = Date.now();
    const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
    const TARGET_BYTES = 120000;
    const PER_SESSION_BYTES = 20000;

    const sessionScope = getSessionScope();

    let files = fs
      .readdirSync(AGENT_SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl') && !f.includes('.lock'))
      .map(f => {
        try {
          const st = fs.statSync(path.join(AGENT_SESSIONS_DIR, f));
          return { name: f, time: st.mtime.getTime(), size: st.size };
        } catch (e) {
          return null;
        }
      })
      .filter(f => f && (now - f.time) < ACTIVE_WINDOW_MS)
      .sort((a, b) => b.time - a.time);

    if (files.length === 0) return '';

    let nonEvolverFiles = files.filter(f => !f.name.startsWith('evolver_hand_'));

    if (sessionScope && nonEvolverFiles.length > 0) {
      const scopeLower = sessionScope.toLowerCase();
      const scopedFiles = nonEvolverFiles.filter(f => f.name.toLowerCase().includes(scopeLower));
      if (scopedFiles.length > 0) {
        nonEvolverFiles = scopedFiles;
        console.log(`[SessionScope] Filtered to ${scopedFiles.length} session(s) matching scope "${sessionScope}".`);
      } else {
        console.log(`[SessionScope] No sessions match scope "${sessionScope}". Using all ${nonEvolverFiles.length} session(s) (fallback).`);
      }
    }

    const activeFiles = nonEvolverFiles.length > 0 ? nonEvolverFiles : files.slice(0, 1);
    const maxSessions = Math.min(activeFiles.length, 6);
    const sections = [];
    let totalBytes = 0;

    for (let i = 0; i < maxSessions && totalBytes < TARGET_BYTES; i++) {
      const f = activeFiles[i];
      const bytesLeft = TARGET_BYTES - totalBytes;
      const readSize = Math.min(PER_SESSION_BYTES, bytesLeft);
      const raw = readRecentLog(path.join(AGENT_SESSIONS_DIR, f.name), readSize);
      const formatted = formatSessionLog(raw);
      if (formatted.trim()) {
        sections.push(`--- SESSION (${f.name}) ---\n${formatted}`);
        totalBytes += formatted.length;
      }
    }

    return sections.join('\n\n');
  } catch (e) {
    console.warn(`[OpenClawSessions] Read failed: ${e.message}`);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Session source diagnosis + one-shot empty warning
// ---------------------------------------------------------------------------

// Diagnose why session source resolution produced no content. Used both by
// readRealSessionLog (to emit a one-shot warn per process) and by startup
// banners. Pure function: no I/O side effects beyond `fs.existsSync` and
// `fs.readdirSync` on well-known paths; returns a serializable report so
// tests can assert on the shape.
function diagnoseSessionSourceEmpty(opts) {
  const homedir = (opts && opts.homedir) || os.homedir();
  const agentName = (opts && opts.agentName != null) ? opts.agentName : AGENT_NAME;
  const agentSessionsDir = (opts && opts.agentSessionsDir) ||
    (agentName === AGENT_NAME && homedir === os.homedir()
      ? AGENT_SESSIONS_DIR
      : path.join(homedir, `.openclaw/agents/${agentName}/sessions`));
  const sessionSource = (opts && opts.sessionSource) || SESSION_SOURCE;
  const cursorTranscriptsDir = (opts && opts.cursorTranscriptsDir != null)
    ? opts.cursorTranscriptsDir : CURSOR_TRANSCRIPTS_DIR;

  const diagnosis = {
    sessionSource,
    agentName,
    agentSessionsDir,
    agentSessionsDirExists: false,
    cursorTranscriptsDir: cursorTranscriptsDir || '',
    cursorDirExists: false,
    claudeDirExists: false,
    codexDirExists: false,
    availableOpenClawAgents: [],
    hints: [],
  };

  try { diagnosis.agentSessionsDirExists = fs.existsSync(agentSessionsDir); } catch (_e) {}
  try { diagnosis.cursorDirExists = fs.existsSync(path.join(homedir, '.cursor')); } catch (_e) {}
  try { diagnosis.claudeDirExists = fs.existsSync(path.join(homedir, '.claude')); } catch (_e) {}
  try { diagnosis.codexDirExists = fs.existsSync(path.join(homedir, '.codex')); } catch (_e) {}

  try {
    const agentsRoot = path.join(homedir, '.openclaw', 'agents');
    if (fs.existsSync(agentsRoot)) {
      diagnosis.availableOpenClawAgents = fs.readdirSync(agentsRoot).filter(name => {
        try { return fs.statSync(path.join(agentsRoot, name)).isDirectory(); } catch (_e) { return false; }
      });
    }
  } catch (_e) {}

  const availableAgents = diagnosis.availableOpenClawAgents;
  const hasAnyCursorIde = diagnosis.cursorDirExists || diagnosis.claudeDirExists ||
    diagnosis.codexDirExists || Boolean(cursorTranscriptsDir);

  if (!diagnosis.agentSessionsDirExists && availableAgents.length > 0) {
    const others = availableAgents.filter(n => n !== agentName);
    if (others.length > 0) {
      diagnosis.hints.push(
        `AGENT_NAME="${agentName}" resolves to a missing directory. Available OpenClaw agents under ~/.openclaw/agents/: ${others.join(', ')}. ` +
        `Set AGENT_NAME=<one of those> or AGENT_SESSIONS_DIR=<absolute path> to the agent actually doing work.`
      );
    }
  }

  if (!diagnosis.agentSessionsDirExists && availableAgents.length === 0 && !hasAnyCursorIde) {
    diagnosis.hints.push(
      'No session sources detected. If you are running inside OpenClaw, confirm ~/.openclaw/agents/<AGENT_NAME>/sessions/ exists for the agent actually producing sessions. ' +
      'If you are using Cursor / Claude Code / Codex, confirm ~/.cursor, ~/.claude or ~/.codex exists, or set EVOLVER_CURSOR_TRANSCRIPTS_DIR.'
    );
  }

  if (sessionSource === 'openclaw' && !diagnosis.agentSessionsDirExists) {
    diagnosis.hints.push(
      `EVOLVER_SESSION_SOURCE=openclaw forces OpenClaw-only, but ${agentSessionsDir} does not exist. ` +
      `Either fix AGENT_NAME/AGENT_SESSIONS_DIR, switch to EVOLVER_SESSION_SOURCE=auto, or unset it.`
    );
  }

  if (sessionSource === 'cursor' && !hasAnyCursorIde) {
    diagnosis.hints.push(
      'EVOLVER_SESSION_SOURCE=cursor forces Cursor/Claude/Codex transcripts, but none of ~/.cursor, ~/.claude, ~/.codex exist and EVOLVER_CURSOR_TRANSCRIPTS_DIR is unset.'
    );
  }

  return diagnosis;
}

// One-shot warn across the process lifetime to avoid log spam on every cycle.
let _sessionSourceEmptyWarned = false;

function warnSessionSourceEmptyOnce() {
  if (_sessionSourceEmptyWarned) return;
  _sessionSourceEmptyWarned = true;
  try {
    const diag = diagnoseSessionSourceEmpty();
    const lines = [
      '[SessionSource] No real session logs were found. evolver will fall back to its own memory/logs, which typically looks like "empty cycling" to users.',
      `  EVOLVER_SESSION_SOURCE=${diag.sessionSource}`,
      `  AGENT_NAME=${diag.agentName}`,
      `  AGENT_SESSIONS_DIR=${diag.agentSessionsDir} (exists=${diag.agentSessionsDirExists})`,
    ];
    if (diag.availableOpenClawAgents.length > 0) {
      lines.push(`  ~/.openclaw/agents/ candidates: ${diag.availableOpenClawAgents.join(', ')}`);
    }
    if (diag.cursorTranscriptsDir) {
      lines.push(`  EVOLVER_CURSOR_TRANSCRIPTS_DIR=${diag.cursorTranscriptsDir}`);
    }
    lines.push(
      `  Cursor/Claude/Codex dirs: .cursor=${diag.cursorDirExists} .claude=${diag.claudeDirExists} .codex=${diag.codexDirExists}`
    );
    for (const hint of diag.hints) {
      lines.push(`  HINT: ${hint}`);
    }
    lines.push(
      '  Note: `evolver --loop` (daemon mode) is for background self-maintenance (validator / worker / ATP). ' +
      'If you want real-time assist for a running agent (e.g. OpenClaw), invoke `evolver run` from inside the agent session instead of daemonizing.'
    );
    console.warn(lines.join('\n'));
  } catch (_e) {}
}

// Reset for unit tests / long-lived embedders that want to re-arm the warn.
function resetSessionSourceWarning() {
  _sessionSourceEmptyWarned = false;
}

// ---------------------------------------------------------------------------
// Main session log reader — respects EVOLVER_SESSION_SOURCE
// ---------------------------------------------------------------------------

function readRealSessionLog() {
  try {
    // SESSION_SOURCE controls which transcript source to use:
    //   'auto'     = detect available sources: OpenClaw if present, Cursor/IDE if present, both if both
    //   'cursor'   = Cursor/Codex/Claude Code transcripts only (skip OpenClaw)
    //   'openclaw' = OpenClaw sessions only (explicit)
    //   'merge'    = combine both sources, newest sections first
    if (SESSION_SOURCE === 'cursor') {
      const content = readCursorTranscripts();
      if (content) return content;
      warnSessionSourceEmptyOnce();
      return '[NO SESSION LOGS FOUND]';
    }

    if (SESSION_SOURCE === 'openclaw') {
      const content = readOpenClawSessions();
      if (content) return content;
      warnSessionSourceEmptyOnce();
      return '[NO SESSION LOGS FOUND]';
    }

    if (SESSION_SOURCE === 'merge') {
      const ocContent = readOpenClawSessions();
      const cursorContent = readCursorTranscripts();
      if (ocContent && cursorContent) return ocContent + '\n\n' + cursorContent;
      if (ocContent || cursorContent) return ocContent || cursorContent;
      warnSessionSourceEmptyOnce();
      return '[NO SESSION LOGS FOUND]';
    }

    // 'auto': detect which sources have data
    const hasOpenClaw = fs.existsSync(AGENT_SESSIONS_DIR);
    const hasCursorDir = CURSOR_TRANSCRIPTS_DIR || process.env.CURSOR_TRACE_DIR ||
      fs.existsSync(path.join(os.homedir(), '.cursor')) ||
      fs.existsSync(path.join(os.homedir(), '.claude')) ||
      fs.existsSync(path.join(os.homedir(), '.codex'));

    if (hasOpenClaw && hasCursorDir) {
      const ocContent = readOpenClawSessions();
      const cursorContent = readCursorTranscripts();
      if (ocContent || cursorContent) return ocContent || cursorContent;
      warnSessionSourceEmptyOnce();
      return '[NO SESSION LOGS FOUND]';
    }

    if (hasOpenClaw) {
      const ocContent = readOpenClawSessions();
      if (ocContent) return ocContent;
    }

    if (hasCursorDir) {
      const cursorContent = readCursorTranscripts();
      if (cursorContent) return cursorContent;
    }

    warnSessionSourceEmptyOnce();
    return '[NO SESSION LOGS FOUND]';
  } catch (e) {
    return `[ERROR READING SESSION LOGS: ${e.message}]`;
  }
}

// ---------------------------------------------------------------------------
// Memory / user snippet readers
// ---------------------------------------------------------------------------

// Read MEMORY.md and USER.md from the WORKSPACE root (not the evolver plugin dir).
// This avoids symlink breakage if the target file is temporarily deleted.
function readMemorySnippet() {
  try {
    const scope = getSessionScope();
    let memFile = MEMORY_FILE;
    if (scope) {
      const scopedMemory = path.join(MEMORY_DIR, 'scopes', scope, 'MEMORY.md');
      if (fs.existsSync(scopedMemory)) {
        memFile = scopedMemory;
        console.log(`[SessionScope] Reading scoped MEMORY.md for "${scope}".`);
      } else {
        console.log(`[SessionScope] No scoped MEMORY.md for "${scope}". Using global MEMORY.md.`);
      }
    }
    if (!fs.existsSync(memFile)) return '[MEMORY.md MISSING]';
    const content = fs.readFileSync(memFile, 'utf8');
    return content.length > 50000
      ? content.slice(0, 50000) + `\n... [TRUNCATED: ${content.length - 50000} chars remaining]`
      : content;
  } catch (e) {
    return '[ERROR READING MEMORY.md]';
  }
}

function readUserSnippet() {
  try {
    if (!fs.existsSync(USER_FILE)) return '[USER.md MISSING]';
    return fs.readFileSync(USER_FILE, 'utf8');
  } catch (e) {
    return '[ERROR READING USER.md]';
  }
}

// ---------------------------------------------------------------------------
// Cycle ID
// ---------------------------------------------------------------------------

function getNextCycleId() {
  let state = { cycleCount: 0, lastRun: 0 };
  try {
    if (fs.existsSync(STATE_FILE)) {
      state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('[Evolve] Failed to read state file:', e && e.message || e);
  }

  state.cycleCount = (state.cycleCount || 0) + 1;
  state.lastRun = Date.now();

  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn('[Evolve] Failed to write state file:', e && e.message || e);
  }

  return String(state.cycleCount).padStart(4, '0');
}

// ---------------------------------------------------------------------------
// Mutation directive (signal hints from log)
// ---------------------------------------------------------------------------

function getMutationDirective(logContent) {
  const errorMatches = logContent.match(/\[ERROR|Error:|Exception:|FAIL|Failed|"isError":true/gi) || [];
  const errorCount = errorMatches.length;
  const isUnstable = errorCount > 2;
  const recommendedIntent = isUnstable ? 'repair' : 'optimize';

  return `
[Signal Hints]
- recent_error_count: ${errorCount}
- stability: ${isUnstable ? 'unstable' : 'stable'}
- recommended_intent: ${recommendedIntent}
`;
}

// ---------------------------------------------------------------------------
// System health report
// ---------------------------------------------------------------------------

function checkSystemHealth() {
  const report = [];
  try {
    const uptime = (os.uptime() / 3600).toFixed(1);
    report.push(`Uptime: ${uptime}h`);
    report.push(`Node: ${process.version}`);

    const mem = process.memoryUsage();
    const rssMb = (mem.rss / 1024 / 1024).toFixed(1);
    report.push(`Agent RSS: ${rssMb}MB`);

    if (fs.statfsSync) {
      const stats = fs.statfsSync('/');
      const total = stats.blocks * stats.bsize;
      const free = stats.bfree * stats.bsize;
      const used = total - free;
      const freeGb = (free / 1024 / 1024 / 1024).toFixed(1);
      const usedPercent = Math.round((used / total) * 100);
      report.push(`Disk: ${usedPercent}% (${freeGb}G free)`);
    }
  } catch (e) {}

  try {
    if (process.platform === 'win32') {
      const wmic = execSync('tasklist /FI "IMAGENAME eq node.exe" /NH', {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000, windowsHide: true, maxBuffer: MAX_EXEC_BUFFER,
      });
      const count = wmic.split('\n').filter(l => l.trim() && !l.includes('INFO:')).length;
      report.push(`Node Processes: ${count}`);
    } else {
      try {
        const pgrep = execSync('pgrep -c node', {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000, maxBuffer: MAX_EXEC_BUFFER,
        });
        report.push(`Node Processes: ${pgrep.trim()}`);
      } catch (e) {
        const ps = execSync('ps aux | grep node | grep -v grep | wc -l', {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000, maxBuffer: MAX_EXEC_BUFFER,
        });
        report.push(`Node Processes: ${ps.trim()}`);
      }
    }
  } catch (e) {}

  try {
    const issues = [];
    if (process.env.INTEGRATION_STATUS_CMD) {
      try {
        const status = execSync(process.env.INTEGRATION_STATUS_CMD, {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000, windowsHide: true, maxBuffer: MAX_EXEC_BUFFER,
        });
        if (status.trim()) issues.push(status.trim());
      } catch (e) {}
    }
    report.push(issues.length > 0 ? `Integrations: ${issues.join(', ')}` : 'Integrations: Nominal');
  } catch (e) {}

  return report.length ? report.join(' | ') : 'Health Check Unavailable';
}

// ---------------------------------------------------------------------------
// Skills listing (with 6-hour cache)
// ---------------------------------------------------------------------------

function listSkills() {
  const skillsDir = path.join(WORKSPACE_ROOT, 'skills');
  const SKILLS_CACHE_FILE = path.join(MEMORY_DIR, 'skills_list_cache.json');
  let fileList = '';

  try {
    if (fs.existsSync(skillsDir)) {
      let useCache = false;
      const dirStats = fs.statSync(skillsDir);
      if (fs.existsSync(SKILLS_CACHE_FILE)) {
        const cacheStats = fs.statSync(SKILLS_CACHE_FILE);
        const CACHE_TTL = 1000 * 60 * 60 * 6;
        const isFresh = Date.now() - cacheStats.mtimeMs < CACHE_TTL;
        if (isFresh && cacheStats.mtimeMs > dirStats.mtimeMs) {
          try {
            const cached = JSON.parse(fs.readFileSync(SKILLS_CACHE_FILE, 'utf8'));
            fileList = cached.list;
            useCache = true;
          } catch (e) {}
        }
      }

      if (!useCache) {
        const skills = fs
          .readdirSync(skillsDir, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => {
            const name = dirent.name;
            let desc = 'No description';
            try {
              const pkg = require(path.join(skillsDir, name, 'package.json'));
              if (pkg.description) desc = pkg.description.slice(0, 100) + (pkg.description.length > 100 ? '...' : '');
            } catch (e) {
              try {
                const skillMdPath = path.join(skillsDir, name, 'SKILL.md');
                if (fs.existsSync(skillMdPath)) {
                  const skillMd = fs.readFileSync(skillMdPath, 'utf8');
                  const yamlMatch = skillMd.match(/^description:\s*(.*)$/m);
                  if (yamlMatch) {
                    desc = yamlMatch[1].trim();
                  } else {
                    const lines = skillMd.split('\n');
                    for (const line of lines) {
                      const trimmed = line.trim();
                      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---') && !trimmed.startsWith('```')) {
                        desc = trimmed;
                        break;
                      }
                    }
                  }
                  if (desc.length > 100) desc = desc.slice(0, 100) + '...';
                }
              } catch (e2) {}
            }
            return `- **${name}**: ${desc}`;
          });
        fileList = skills.join('\n');

        try {
          fs.writeFileSync(SKILLS_CACHE_FILE, JSON.stringify({ list: fileList }, null, 2));
        } catch (e) {}
      }
    }
  } catch (e) {
    fileList = `Error listing skills: ${e.message}`;
  }

  return fileList;
}

// ---------------------------------------------------------------------------
// Reporting directive builder
// ---------------------------------------------------------------------------

function buildReportingDirective(cycleId, isReviewMode) {
  let reportingDirective = `Report requirement:
  - Use \`message\` tool.
  - Title: Evolution ${cycleId}
  - Status: [SUCCESS]
  - Changes: Detail exactly what was improved.`;

  if (process.env.EVOLVE_REPORT_DIRECTIVE) {
    reportingDirective = process.env.EVOLVE_REPORT_DIRECTIVE.replace('__CYCLE_ID__', cycleId);
  } else if (process.env.EVOLVE_REPORT_CMD) {
    reportingDirective = `Report requirement (custom):
  - Execute the custom report command:
    \`\`\`
    ${process.env.EVOLVE_REPORT_CMD.replace('__CYCLE_ID__', cycleId)}
    \`\`\`
  - Ensure you pass the status and action details.`;
  }

  if (isReviewMode) {
    reportingDirective +=
      '\n  - REVIEW PAUSE: After generating the fix but BEFORE applying significant edits, ask the user for confirmation.';
  }

  return reportingDirective;
}

// ---------------------------------------------------------------------------
// Stage 2 orchestrator: collect all context, return enriched ctx
// ---------------------------------------------------------------------------

async function collectContext(ctx) {
  const isReviewMode = ctx.isReviewMode || false;
  const isDryRun = ctx.isDryRun || false;

  const recentMasterLog = readRealSessionLog();
  const todayLog = readRecentLog(TODAY_LOG);
  const memorySnippet = readMemorySnippet();
  const userSnippet = readUserSnippet();

  const cycleNum = getNextCycleId();
  const cycleId = `Cycle #${cycleNum}`;

  const mutationDirective = getMutationDirective(recentMasterLog);
  const healthReport = checkSystemHealth();
  const fileList = listSkills();
  const reportingDirective = buildReportingDirective(cycleId, isReviewMode);

  let moodStatus = 'Mood: Unknown';
  try {
    const moodFile = path.join(MEMORY_DIR, 'mood.json');
    if (fs.existsSync(moodFile)) {
      const moodData = JSON.parse(fs.readFileSync(moodFile, 'utf8'));
      moodStatus = `Mood: ${moodData.current_mood || 'Neutral'} (Intensity: ${moodData.intensity || 0})`;
    }
  } catch (e) {}

  const memorySize = fs.existsSync(MEMORY_FILE) ? fs.statSync(MEMORY_FILE).size : 0;

  const skillsDir = path.join(WORKSPACE_ROOT, 'skills');
  const hasGitSync = fs.existsSync(path.join(skillsDir, 'git-sync'));
  const syncDirective = hasGitSync
    ? 'Workspace sync: run skills/git-sync/sync.sh "Evolution: Workspace Sync"'
    : 'Workspace sync: optional/disabled in this environment.';

  let localStateSummary = '';
  try {
    localStateSummary = captureLocalState();
  } catch (e) {
    console.warn('[LocalState] Capture failed (non-fatal): ' + (e && e.message ? e.message : e));
    localStateSummary = '(local state capture unavailable)';
  }

  return Object.assign({}, ctx, {
    recentMasterLog,
    todayLog,
    memorySnippet,
    userSnippet,
    cycleNum,
    cycleId,
    mutationDirective,
    healthReport,
    fileList,
    reportingDirective,
    moodStatus,
    memorySize,
    syncDirective,
    localStateSummary,
  });
}

module.exports = {
  collectContext,
  // Exported for direct use by evolve.js (backward compat) and tests.
  readRealSessionLog,
  readCursorTranscripts,
  readOpenClawSessions,
  diagnoseSessionSourceEmpty,
  resetSessionSourceWarning,
  readMemorySnippet,
  readUserSnippet,
  getNextCycleId,
  getMutationDirective,
  checkSystemHealth,
  formatSessionLog,
  formatCursorTranscript,
  listSkills,
  buildReportingDirective,
};
