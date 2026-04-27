const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

let tmpMemoryDir;
const savedEnv = {};
const envKeys = ["EVOLVER_ATP_AUTOBUY", "MEMORY_DIR"];

function makeTmpMemoryDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cli-autobuy-prompt-"));
}

function freshModule() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes("/src/atp/") || k.includes("/src/gep/paths")) {
      delete require.cache[k];
    }
  }
  return require("../src/atp/cliAutobuyPrompt");
}

function makeTTY(preset) {
  return {
    isTTY: true,
    _answer: preset,
  };
}

function makeNonTTY() {
  return { isTTY: false };
}

function collectingStream() {
  const chunks = [];
  return {
    write(x) {
      chunks.push(String(x));
      return true;
    },
    read() {
      return chunks.join("");
    },
  };
}

beforeEach(() => {
  for (const k of envKeys) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  tmpMemoryDir = makeTmpMemoryDir();
  process.env.MEMORY_DIR = tmpMemoryDir;
});

afterEach(() => {
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  try {
    fs.rmSync(tmpMemoryDir, { recursive: true, force: true });
  } catch (_) {}
});

describe("cliAutobuyPrompt", () => {
  it("skips completely when stdin is not a TTY", async () => {
    const mod = freshModule();
    const output = collectingStream();
    const fakeAsk = async () => {
      throw new Error("ask should not be called in non-TTY mode");
    };

    const res = await mod.runPrompt({
      input: makeNonTTY(),
      output,
      env: { ...process.env },
      ask: fakeAsk,
    });

    assert.equal(res.prompted, false);
    assert.equal(res.reason, "non_tty");
    assert.equal(res.decision, null);
    assert.equal(output.read(), "");
    assert.equal(fs.existsSync(mod.__internals._getAckPath()), false);
  });

  it("skips when EVOLVER_ATP_AUTOBUY is already set (any value)", async () => {
    const mod = freshModule();
    const output = collectingStream();
    const env = { EVOLVER_ATP_AUTOBUY: "off" };

    const res = await mod.runPrompt({
      input: makeTTY("y"),
      output,
      env,
      ask: async () => {
        throw new Error("ask should not be called when env is set");
      },
    });

    assert.equal(res.prompted, false);
    assert.equal(res.reason, "env_set");
    assert.equal(output.read(), "");
  });

  it("skips when an ack file already exists", async () => {
    const mod = freshModule();
    fs.mkdirSync(tmpMemoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpMemoryDir, mod.__internals.ACK_FILE_NAME),
      JSON.stringify({ enabled: false, acknowledged_at: "2026-04-20", version: 1 }),
    );
    const output = collectingStream();

    const res = await mod.runPrompt({
      input: makeTTY("y"),
      output,
      env: { ...process.env, EVOLVER_ATP_AUTOBUY: undefined },
      ask: async () => {
        throw new Error("ask should not be called when ack exists");
      },
    });

    assert.equal(res.prompted, false);
    assert.equal(res.reason, "ack_present");
  });

  it("on answer='y' writes ack enabled=true and flips env to on", async () => {
    const mod = freshModule();
    const output = collectingStream();
    const env = { ...process.env };
    delete env.EVOLVER_ATP_AUTOBUY;

    const res = await mod.runPrompt({
      input: makeTTY("y"),
      output,
      env,
      ask: async () => "y",
    });

    assert.equal(res.prompted, true);
    assert.equal(res.decision, "yes");
    assert.equal(env.EVOLVER_ATP_AUTOBUY, "on");
    const ack = JSON.parse(fs.readFileSync(mod.__internals._getAckPath(), "utf8"));
    assert.equal(ack.enabled, true);
    assert.equal(ack.version, 1);
    assert.match(output.read(), /\[ATP-AutoBuyer\]/);
  });

  it("on answer='n' writes ack enabled=false and flips env to off", async () => {
    const mod = freshModule();
    const output = collectingStream();
    const env = { ...process.env };
    delete env.EVOLVER_ATP_AUTOBUY;

    const res = await mod.runPrompt({
      input: makeTTY("n"),
      output,
      env,
      ask: async () => "n",
    });

    assert.equal(res.prompted, true);
    assert.equal(res.decision, "no");
    assert.equal(env.EVOLVER_ATP_AUTOBUY, "off");
    const ack = JSON.parse(fs.readFileSync(mod.__internals._getAckPath(), "utf8"));
    assert.equal(ack.enabled, false);
  });

  it("on answer='later' (or anything else) writes NO ack and keeps env untouched", async () => {
    const mod = freshModule();
    const output = collectingStream();
    const env = { ...process.env };
    delete env.EVOLVER_ATP_AUTOBUY;

    const res = await mod.runPrompt({
      input: makeTTY("later"),
      output,
      env,
      ask: async () => "later",
    });

    assert.equal(res.prompted, true);
    assert.equal(res.decision, "later");
    assert.equal(env.EVOLVER_ATP_AUTOBUY, undefined);
    assert.equal(fs.existsSync(mod.__internals._getAckPath()), false);

    const res2 = await mod.runPrompt({
      input: makeTTY(""),
      output,
      env,
      ask: async () => "",
    });
    assert.equal(res2.decision, "later");
    assert.equal(fs.existsSync(mod.__internals._getAckPath()), false);
  });

  it("classify() returns the precedence order (env_set > non_tty > ack > eligible)", async () => {
    const mod = freshModule();

    assert.equal(
      mod.classify({ EVOLVER_ATP_AUTOBUY: "on" }, makeNonTTY()),
      "env_set",
      "env takes priority over TTY",
    );
    assert.equal(
      mod.classify({}, makeNonTTY()),
      "non_tty",
      "non-TTY comes before ack/eligible when env is unset",
    );
    assert.equal(
      mod.classify({}, makeTTY("y")),
      "eligible",
      "fresh install on a TTY is eligible",
    );

    fs.mkdirSync(tmpMemoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpMemoryDir, mod.__internals.ACK_FILE_NAME),
      JSON.stringify({ enabled: false, acknowledged_at: "2026-04-20", version: 1 }),
    );
    assert.equal(
      mod.classify({}, makeTTY("y")),
      "ack_present",
      "ack file demotes eligible to ack_present",
    );
  });
});
