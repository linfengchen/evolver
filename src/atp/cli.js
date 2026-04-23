// ATP CLI: lightweight argument parsers and runners for the `buy`, `orders`,
// and `verify` subcommands. Separated from index.js so they can be unit-tested
// without booting the full evolver loop.
//
// Public API:
//   parseBuyArgs(args)   -> { ok, opts?, error? }
//   parseOrdersArgs(args)-> { ok, opts?, error? }
//   parseVerifyArgs(args)-> { ok, opts?, error? }
//   runBuy(opts, deps)
//   runOrders(opts, deps)
//   runVerify(opts, deps)
//
// `deps` is an object containing the ATP module (defaults to require('./index')),
// injectable for tests. Each runner returns a Promise that resolves to
// { exitCode: number, output?: string, data?: object }.

function _parseNamed(args, longFlag, shortFlag) {
  const long = args.findIndex(a => typeof a === 'string' && (a === longFlag || a.startsWith(longFlag + '=')));
  if (long !== -1) {
    const token = args[long];
    if (token.startsWith(longFlag + '=')) return token.slice(longFlag.length + 1);
    if (args[long + 1] && !String(args[long + 1]).startsWith('--')) return args[long + 1];
  }
  if (shortFlag) {
    const short = args.indexOf(shortFlag);
    if (short !== -1 && args[short + 1] && !String(args[short + 1]).startsWith('--')) return args[short + 1];
  }
  return null;
}

function _toBool(v) {
  if (typeof v !== 'string') return false;
  const s = v.toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function parseBuyArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    return { ok: false, error: 'buy requires <capabilities>: comma-separated list (e.g. code_review,bug_fix)' };
  }

  // First positional (not starting with --) is the capability list.
  let capabilitiesRaw = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a === 'string' && !a.startsWith('--')) {
      capabilitiesRaw = a;
      break;
    }
  }
  if (!capabilitiesRaw) {
    return { ok: false, error: 'buy requires <capabilities>: comma-separated list' };
  }

  const capabilities = capabilitiesRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (capabilities.length === 0) {
    return { ok: false, error: 'no valid capabilities parsed from: ' + capabilitiesRaw };
  }

  const budgetRaw = _parseNamed(args, '--budget', '-b');
  const budget = Math.max(1, Math.round(Number(budgetRaw) || 10));

  const question = _parseNamed(args, '--question', '-q') || '';
  const routingMode = _parseNamed(args, '--routing', null) || 'fastest';
  const verifyMode = _parseNamed(args, '--verify', null) || 'auto';
  const noWait = args.includes('--no-wait');
  const timeoutMsRaw = _parseNamed(args, '--timeout', null);
  const timeoutMs = timeoutMsRaw ? Math.max(1000, Math.round(Number(timeoutMsRaw) * 1000)) : 300000;

  return {
    ok: true,
    opts: {
      capabilities,
      budget,
      question,
      routingMode,
      verifyMode,
      noWait,
      timeoutMs,
    },
  };
}

function parseOrdersArgs(args) {
  const role = _parseNamed(args, '--role', null);
  if (role && !['consumer', 'merchant'].includes(role)) {
    return { ok: false, error: 'invalid --role: ' + role + ' (expected consumer|merchant)' };
  }
  const status = _parseNamed(args, '--status', null);
  if (status && !['pending', 'verified', 'disputed', 'settled'].includes(status)) {
    return { ok: false, error: 'invalid --status: ' + status };
  }
  const limitRaw = _parseNamed(args, '--limit', null);
  const limit = limitRaw ? Math.max(1, Math.min(100, Math.round(Number(limitRaw)))) : 20;
  const jsonOut = args.includes('--json');
  return {
    ok: true,
    opts: { role: role || 'consumer', status: status || null, limit, jsonOut },
  };
}

function parseVerifyArgs(args) {
  let orderId = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a === 'string' && !a.startsWith('--')) {
      orderId = a;
      break;
    }
  }
  if (!orderId) {
    return { ok: false, error: 'verify requires <orderId>' };
  }
  const action = _parseNamed(args, '--action', null) || 'confirm';
  if (!['confirm', 'ai_judge'].includes(action)) {
    return { ok: false, error: 'invalid --action: ' + action + ' (expected confirm|ai_judge)' };
  }
  return { ok: true, opts: { orderId, action } };
}

async function runBuy(opts, deps) {
  const atp = (deps && deps.atp) || require('./index');
  const consumerAgent = atp.consumerAgent;
  const log = (deps && deps.log) || console.log;
  const err = (deps && deps.err) || console.error;

  log('[ATP] Placing order: capabilities=' + opts.capabilities.join(',') + ' budget=' + opts.budget + ' mode=' + opts.routingMode);

  try {
    if (opts.noWait) {
      const result = await consumerAgent.orderService({
        capabilities: opts.capabilities,
        budget: opts.budget,
        routingMode: opts.routingMode,
        verifyMode: opts.verifyMode,
        question: opts.question,
      });
      if (!result.ok) {
        err('[ATP] Order failed: ' + (result.error || 'unknown'));
        return { exitCode: 1, data: result };
      }
      log('[ATP] Order placed: ' + result.data.order_id);
      return { exitCode: 0, data: result.data };
    }

    const result = await consumerAgent.orderAndWait({
      capabilities: opts.capabilities,
      budget: opts.budget,
      routingMode: opts.routingMode,
      verifyMode: opts.verifyMode,
      question: opts.question,
      timeoutMs: opts.timeoutMs,
    });

    if (!result.ok) {
      err('[ATP] Order lifecycle failed: ' + (result.error || 'unknown'));
      return { exitCode: 1, data: result };
    }
    log('[ATP] Order settled: ' + (result.order && result.order.order_id));
    if (result.finalStatus) {
      log('[ATP] Final status: ' + JSON.stringify(result.finalStatus, null, 2));
    }
    return { exitCode: 0, data: result };
  } catch (e) {
    err('[ATP] buy error: ' + (e && e.message || e));
    return { exitCode: 1, error: String(e) };
  }
}

async function runOrders(opts, deps) {
  const atp = (deps && deps.atp) || require('./index');
  const hubClient = atp.hubClient;
  const log = (deps && deps.log) || console.log;
  const err = (deps && deps.err) || console.error;

  try {
    const result = await hubClient.listProofs({
      role: opts.role,
      status: opts.status || undefined,
      limit: opts.limit,
    });
    if (!result.ok) {
      err('[ATP] listProofs failed: ' + (result.error || 'unknown'));
      return { exitCode: 1, data: result };
    }

    const proofs = (result.data && result.data.proofs) || result.data || [];
    if (opts.jsonOut) {
      log(JSON.stringify(proofs, null, 2));
      return { exitCode: 0, data: proofs };
    }
    if (!Array.isArray(proofs) || proofs.length === 0) {
      log('[ATP] No orders found for role=' + opts.role + (opts.status ? ' status=' + opts.status : ''));
      return { exitCode: 0, data: [] };
    }
    log('[ATP] Showing ' + proofs.length + ' order(s):');
    for (const p of proofs) {
      const when = p.createdAt || p.created_at || 'unknown';
      log('  - ' + (p.taskId || p.order_id || p.id) + ' | status=' + p.status + ' | created=' + when);
    }
    return { exitCode: 0, data: proofs };
  } catch (e) {
    err('[ATP] orders error: ' + (e && e.message || e));
    return { exitCode: 1, error: String(e) };
  }
}

async function runVerify(opts, deps) {
  const atp = (deps && deps.atp) || require('./index');
  const consumerAgent = atp.consumerAgent;
  const log = (deps && deps.log) || console.log;
  const err = (deps && deps.err) || console.error;

  try {
    const fn = opts.action === 'ai_judge' ? consumerAgent.requestAiJudge : consumerAgent.confirmDelivery;
    const result = await fn(opts.orderId);
    if (!result.ok) {
      err('[ATP] verify failed: ' + (result.error || 'unknown'));
      return { exitCode: 1, data: result };
    }
    log('[ATP] verify ok (' + opts.action + '): ' + JSON.stringify(result.data));
    return { exitCode: 0, data: result.data };
  } catch (e) {
    err('[ATP] verify error: ' + (e && e.message || e));
    return { exitCode: 1, error: String(e) };
  }
}

function printUsage() {
  return [
    'ATP subcommands:',
    '  evolver buy <caps> [--budget=N] [--question "..."] [--routing=fastest|cheapest|auction|swarm]',
    '              [--verify=auto|ai_judge|bilateral] [--no-wait] [--timeout=<seconds>]',
    '  evolver orders [--role=consumer|merchant] [--status=pending|verified|disputed|settled]',
    '                 [--limit=N] [--json]',
    '  evolver verify <orderId> [--action=confirm|ai_judge]',
  ].join('\n');
}

module.exports = {
  parseBuyArgs,
  parseOrdersArgs,
  parseVerifyArgs,
  runBuy,
  runOrders,
  runVerify,
  printUsage,
};
