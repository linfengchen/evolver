"use strict";

/**
 * First-run prompt that introduces the ATP autoBuyer to interactive users.
 *
 * Triggers when ALL conditions hold:
 *   - process.stdin.isTTY === true (skipped under systemd, Docker, CI)
 *   - EVOLVER_ATP_AUTOBUY is not already set (neither on nor off)
 *   - ack file memory/atp-autobuy-ack.json does not exist (already decided)
 *
 * Outcomes:
 *   - user answers y         -> enabled=true written, session opts in immediately
 *   - user answers n         -> enabled=false written, prompt never shown again
 *   - user answers later     -> no file written, prompt shown next time
 *   - any non-TTY/ack branch -> silent no-op
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ACK_FILE_NAME = "atp-autobuy-ack.json";

function _getMemoryDir() {
  try {
    return require("../gep/paths").getMemoryDir();
  } catch (_) {
    return process.env.MEMORY_DIR || path.join(process.cwd(), "memory");
  }
}

function _getAckPath() {
  return path.join(_getMemoryDir(), ACK_FILE_NAME);
}

function _readAck() {
  try {
    const raw = fs.readFileSync(_getAckPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function _writeAck(enabled) {
  const p = _getAckPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const body = {
      enabled: !!enabled,
      acknowledged_at: new Date().toISOString(),
      version: 1,
    };
    fs.writeFileSync(p, JSON.stringify(body, null, 2) + "\n", "utf8");
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @returns {"ack_present"|"env_set"|"non_tty"|"eligible"}
 */
function classify(env, stdin) {
  const envVal = env && env.EVOLVER_ATP_AUTOBUY;
  if (typeof envVal === "string" && envVal.trim().length > 0) {
    return "env_set";
  }
  if (!stdin || !stdin.isTTY) {
    return "non_tty";
  }
  if (_readAck()) {
    return "ack_present";
  }
  return "eligible";
}

function _ask(question, { input, output }) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || "").trim().toLowerCase());
    });
  });
}

/**
 * Synchronously decide whether to prompt (TTY + no ack + env unset) and,
 * if prompting, block on user answer. Resolves with:
 *   { prompted: bool, decision: "yes"|"no"|"later"|null, reason: string }
 *
 * Should be called at most once per `evolver run` invocation, BEFORE the
 * autoBuyer.start() branch in the run loop.
 *
 * @param {object} [opts]
 * @param {NodeJS.ReadableStream} [opts.input]
 * @param {NodeJS.WritableStream} [opts.output]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(q: string, io: object) => Promise<string>} [opts.ask]
 * @returns {Promise<{ prompted: boolean, decision: string|null, reason: string }>}
 */
async function runPrompt(opts) {
  opts = opts || {};
  const input = opts.input || process.stdin;
  const output = opts.output || process.stdout;
  const env = opts.env || process.env;
  const ask = typeof opts.ask === "function" ? opts.ask : _ask;

  const state = classify(env, input);
  if (state !== "eligible") {
    return { prompted: false, decision: null, reason: state };
  }

  try {
    output.write("\n");
    output.write("[ATP-AutoBuyer] Your evolver can automatically place small-priced\n");
    output.write("ATP orders when it detects a capability gap (default ON).\n");
    output.write("  - daily hard cap:   ATP_AUTOBUY_DAILY_CAP_CREDITS (default applies)\n");
    output.write("  - per-order cap:    ATP_AUTOBUY_PER_ORDER_CAP_CREDITS\n");
    output.write("  - set EVOLVER_ATP_AUTOBUY=off and restart to disable at any time.\n");
    output.write("\n");
  } catch (_) {
    return { prompted: false, decision: null, reason: "io_error" };
  }

  let answer;
  try {
    answer = await ask("Keep autoBuyer enabled for this session? [y/n/later] ", {
      input,
      output,
    });
  } catch (_) {
    return { prompted: true, decision: null, reason: "ask_error" };
  }

  if (answer === "y" || answer === "yes") {
    _writeAck(true);
    env.EVOLVER_ATP_AUTOBUY = "on";
    return { prompted: true, decision: "yes", reason: "user_accepted" };
  }
  if (answer === "n" || answer === "no") {
    _writeAck(false);
    env.EVOLVER_ATP_AUTOBUY = "off";
    return { prompted: true, decision: "no", reason: "user_declined" };
  }
  return { prompted: true, decision: "later", reason: "user_postponed" };
}

module.exports = {
  runPrompt,
  classify,
  __internals: {
    ACK_FILE_NAME,
    _readAck,
    _writeAck,
    _getAckPath,
  },
};
