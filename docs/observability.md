# Evolver Observability (OpenTelemetry, local-first)

Evolver records spans for three observability links so reviewers can replay
what happened in a given evolution cycle:

1. **Agent ↔ Evolver** — session source resolution, GEP prompt build,
   `sessions_spawn` bridge handoff to the executor agent.
2. **Asset evolution pipeline** — `evolve.run` plus its six stages (collect,
   signals, hub, enrich, select, dispatch), and (planned) `solidify.*`
   sub-stages.
3. **Evolver ↔ EvoMap Hub** — Proxy lifecycle (hello/heartbeat) and asset
   reuse/search/publish requests (planned: slice 6).

All spans land in `memory/evolution/obs_spans.jsonl` first. Remote export is
opt-in and **never** carries sensitive payloads.

## Data model: two buckets per span

Every span has two independent payload buckets:

| Bucket | Examples | Exported via OTLP? |
|---|---|---|
| `exportable` | `trace_id`, `span_id`, `run_id`, `cycle_id`, `gene_id`, `prompt_length`, `prompt_sha256`, `hub_response_bytes`, `duration_ms`, HTTP status | **Yes** |
| `local_only` | `initial_user_prompt` (full text), `gep_prompt_text` (full GEP prompt), `hub_response_body` (full JSON body) | **No (hard contract)** |

The contract is enforced in three layers:

1. **Facade**: `setLocalOnlyPayload` never touches the OTel span object; the
   value lives on a separate field in `obs_spans.jsonl`.
2. **Facade strip**: when an OTLP exporter is registered, `endSpan` clones
   the record and removes the `local_only` field before invoking
   `exporter.onSpanEnd`.
3. **OTLP exporter**: additionally drops every attribute whose key starts
   with `evolver.local.` (covers callers who accidentally call
   `setExportableAttribute` with a smuggled key).

A contract test (`test/observabilityOtlp.test.js` case
`CONTRACT: posted OTLP payload never contains local_only payloads`) boots a
real HTTP receiver and asserts on the raw request body bytes. If anyone
breaks the contract, that test fails immediately.

## Local files

| Path | Content | Notes |
|---|---|---|
| `memory/evolution/obs_spans.jsonl` | Full spans (exportable + local_only) | Already covered by `memory/` in `.gitignore`; do not include in public bundles. |
| `memory/evolution/pipeline_events.jsonl` | One row per stage with `trace_id` / `span_id` cross-references | Existing file, now actually populated by `evolve.run`. |

## Reading spans

The WebUI is the recommended consumer for full payloads, since it only
listens on `127.0.0.1`:

```text
GET /webui/observability/spans
GET /webui/observability/spans?trace_id=<32-hex>
GET /webui/observability/spans?name=evolve.dispatch
GET /webui/observability/traces/:traceId
```

- The list endpoint omits the `local_only` field for payload size but flags
  `has_local_only: true` so clients can decide whether to drill in.
- The trace endpoint returns the full timeline including `local_only` —
  prompt, Hub body, etc. — for that single trace.

## Environment variables

```env
# Local payload controls (defaults sensible for development)
EVOLVER_OBS_LOCAL_PAYLOAD=true                  # set false to skip prompt/body
EVOLVER_OBS_LOCAL_PROMPT_MAX_CHARS=65536        # cap per local_only prompt
EVOLVER_OBS_LOCAL_HUB_BODY_MAX_CHARS=65536      # cap per local_only body

# Optional remote OTLP/HTTP export (auto-on when endpoint is set)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=             # explicit traces endpoint override
OTEL_SERVICE_NAME=evolver
OTEL_EXPORTER_OTLP_HEADERS=api-key=...,team=...
EVOLVER_OTEL_ENABLED=true                       # false to opt out explicitly
```

OTLP receivers we have validated against:

- Custom Node http server (used by the contract test).
- Any OTLP/HTTP-JSON-compatible collector (Jaeger, Tempo, vendor agents).

We deliberately do **not** ship `@opentelemetry/sdk-node` as a dependency.
The exporter implementation in `src/observability/otlp.js` is ~240 lines of
plain Node `http`/`https` so the production binary stays lean (rule c5
"every dependency is a liability"). Switching to the official SDK later is
straightforward — the facade already accepts any `{ onSpanEnd, shutdown }`
exporter object via `registerOtlpExporter`.

## Span naming conventions

- `evolve.run` — root span for the whole cycle.
- `evolve.<stage>` — child stage; events with `.done` suffix mark stage
  boundaries with duration.
- `evolve.dispatch` — opens its own child span so the prompt build + bridge
  payload have a stable place to record `prompt_sha256` / `gep_prompt_text`.
- (Planned) `solidify.*`, `a2a.hello`, `a2a.heartbeat`, `hub.request` —
  slices 6+.

## Testing the no-leak contract locally

```bash
node --test test/observabilityOtlp.test.js
```

The fail mode is loud and specific: if the contract test ever sees prompt
text, hub response body, `A2A_NODE_SECRET`, or the `evolver.local.*`
sentinel key in the wire payload, the assertion message will name the
exact leaked substring.
