# Gemma 4 Local Setup for Memory Dream

Date: 2026-04-09
Status: Revised after oracle review; pending user review
Scope: Set up a local Gemma 4 model behind `llama-server` so pi can use it as a normal selectable model. First phase covers model download, local serving, pi registration, and verification. Dream-only routing is explicitly deferred until the model is working end-to-end.

## 1) Context

The goal is not to replace the main coding model yet. The immediate need is to make a local Gemma 4 model available inside pi so it can later be used for `memory` dream mode.

Important constraints from the current environment:
- Host machine: Apple M4 Max, 64 GB RAM
- `llama-server` is already installed
- User wants `llama.cpp` / `llama-server`, not Ollama or Hypura
- User wants a balanced quality/speed setup
- User wants a text-only first pass
- `memory` dream mode does not currently have its own model override; it just queues another normal pi turn

That means phase 1 should solve the boring but necessary part: make Gemma 4 a reliable local model in pi. Once that works, dream-specific routing can be added as a separate change.

## 2) Goals and Non-Goals

### Goals

1. Download a sane Gemma 4 GGUF for this machine.
2. Run it locally with `llama-server` using a stable launch command.
3. Register it in `~/.pi/agent/models.json` so pi can select it via `/model`.
4. Verify the local endpoint works before involving pi.
5. Verify pi can see and use the model.
6. Keep the first pass easy to operate and easy to debug.

### Non-Goals

- No dream-only model routing yet.
- No changes to the `memory` extension yet.
- No multimodal setup in phase 1.
- No aggressive benchmark tuning in phase 1.
- No provider-extension work if plain custom models are sufficient.

## 3) Approaches Considered

### Approach A — Custom pi model via `~/.pi/agent/models.json` (recommended)

Run `llama-server` directly and add a custom provider/model entry in pi.

Pros:
- Smallest moving-parts count
- Uses pi's normal model-selection flow
- Easy to verify and reason about
- No repo code changes required for the initial setup

Cons:
- Dream still uses whatever model the session is on until later routing work exists
- Requires local server lifecycle management

### Approach B — Use the repo's `hypura` extension

Pros:
- Good path for very large local models later
- Project-local extension already exists

Cons:
- Unnecessary complexity for one local Gemma model
- Solves a bigger problem than the one currently asked

### Approach C — Wrapper or environment-variable hacks

Pros:
- Fast to try once

Cons:
- Brittle
- Annoying to remember
- Harder to document and support later

### Recommendation

Use **Approach A**. It is the cleanest path: one local server, one custom provider entry, normal pi model selection. The other options are overkill or sloppy for this stage.

## 4) Model Selection

Recommended model for this machine and use case:
- **Model family:** Gemma 4
- **Variant:** `26B-A4B-it`
- **Format:** GGUF
- **Quant:** prefer `UD-Q5_K_M`, fallback `Q5_K_M`
- **Mode:** text-only first pass

Rationale:
- `E4B` is faster but weaker than desired for dream-quality summarization/synthesis.
- `31B` is feasible on this machine but slower, and the quality gain is unlikely to justify the drag for this use case.
- `26B-A4B` is the best middle ground for local agent-side curation work on a 64 GB Apple Silicon Mac.

## 5) Serving Configuration

The first-pass `llama-server` configuration should optimize for reliability, not benchmark vanity.

Recommended phase-1 baseline:
- **Port:** `8123`
- **Alias/model id:** `gemma4-memory`
- **Verified default context:** `65536`
- **Stretch target context:** `131072` after the basic integration is proven
- **Parallel:** `1`
- **Text-only:** yes
- **Chat template:** use the model's proper Gemma/GGUF template support
- **Quant:** `UD-Q5_K_M` preferred, else `Q5_K_M`

Normative context contract:
- Phase 1 is considered integrated once the model is verified at `65536`.
- `131072` is a separate long-context verification target, not a baseline assumption.
- `models.json.contextWindow` must always match the server's actual configured context window for the currently verified setup.

Rationale for context size:
- The user's actual destination is `memory` dream, not generic local chat.
- `memory` dream re-reads vault context repeatedly.
- The extension injects vault index material into the prompt.
- `65536` is the conservative starting point for a reliable first integration.
- `131072` is still worth targeting later because dream-mode prompt envelopes may eventually justify it.

The point of phase 1 is to make the model real and usable inside pi, not to overclaim long-context readiness from a lightweight smoke test.

## 6) Operator Workflow

Use a stable, explicit workflow rather than making the operator remember a giant command.

### Files and locations

- Model files live in a stable local directory, for example: `~/models/gemma4/`
- Recommended launcher script path: `~/.local/bin/start-gemma4-memory`
- The launcher script is responsible for model path, port, alias, and context settings
- Logs should go to a stable file, for example: `~/Library/Logs/gemma4-memory.log`
- pi model registration lives in: `~/.pi/agent/models.json`

### Launch workflow

1. Ensure the GGUF exists locally.
2. Start `llama-server` from the launcher script.
3. Verify the endpoint directly.
4. Open pi and select the registered local model via `/model`.
5. Run a simple prompt through pi to confirm end-to-end behavior.

Recommendation: keep the launcher script under a memorable path and avoid manual copy-paste startup.

Minimal operator contract for the launcher script:
- starts `llama-server` in the foreground unless explicitly wrapped by the shell/user
- uses `gemma4-memory` as the server alias
- binds to `127.0.0.1`
- sets the configured port and context explicitly
- passes the resolved model path explicitly
- uses GGUF/template behavior that produces normal chat output; if template auto-detection is unreliable, the script must set the Gemma template explicitly
- writes stderr/stdout to a known log location when backgrounded
- fails loudly on missing model file or port conflict rather than silently choosing something else

Normative command skeleton:

```bash
llama-server \
  -m "$MODEL_PATH" \
  --alias gemma4-memory \
  --host 127.0.0.1 \
  --port 8123 \
  -c 65536
```

Long-context verification may later rerun the same setup with `-c 131072`, but the pi `contextWindow` setting must always be updated to match the live server.

## 7) pi Model Registration

Register the local model as a normal custom provider in `~/.pi/agent/models.json`.

Normative phase-1 shape:

```json
{
  "providers": {
    "local-llama": {
      "baseUrl": "http://127.0.0.1:8123/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false,
        "supportsUsageInStreaming": false,
        "maxTokensField": "max_tokens"
      },
      "models": [
        {
          "id": "gemma4-memory",
          "name": "Gemma 4 Memory (Local)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 131072,
          "maxTokens": 8192,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

Expected characteristics:
- OpenAI-compatible endpoint backed by local `llama-server`
- Provider name: `local-llama`
- Stable model id: `gemma4-memory`
- `apiKey` is a dummy value because pi expects one even when the local server ignores it
- Compatibility flags disable OpenAI niceties that local servers often mishandle

Compatibility fallback order:
1. Start with the normative config above.
2. If pi streaming fails, keep `supportsUsageInStreaming: false`.
3. If token-limit field errors appear, keep `maxTokensField: "max_tokens"`.
4. Only add more compat overrides if a concrete error proves they are needed.

The launch command should set the server alias to the same id (`gemma4-memory`) so `/v1/models`, direct requests, and pi all agree on the exact model name.

## 8) Verification Strategy

Verification is split into two levels:
- **Phase-1 integrated** — proves the model is selectable and usable in pi at the conservative baseline
- **Long-context verified** — proves a larger context configuration is actually usable, not just aspirational

### Layer 1 — server availability

Exact check:
- `GET http://127.0.0.1:8123/v1/models`
- Pass condition: response includes a model entry whose `id` is exactly `gemma4-memory`

### Layer 2 — direct inference

Exact checks for **phase-1 integrated**:
- Non-streaming: `POST http://127.0.0.1:8123/v1/chat/completions`
- Request uses `model: "gemma4-memory"`
- Prompt is a tiny deterministic text-only request such as `Reply with exactly: GEMMA_OK`
- Pass condition: response is HTTP 200 and returns assistant text containing `GEMMA_OK`
- Streaming: repeat with `stream: true`
- Pass condition: streamed chunks arrive and the assembled assistant text contains `GEMMA_OK`
- Representative envelope: send one larger text-only prompt containing at least 4,000 characters of pasted text plus an instruction to summarize it in 5 bullets
- Pass condition: request completes successfully without protocol/config errors and returns within 60 seconds for a short response

Exact checks for **long-context verified**:
- Restart the server and pi model config at `131072`
- Re-run the representative-envelope direct request with a meaningfully larger prompt body than the phase-1 baseline
- Pass condition: startup succeeds cleanly and the request completes without context/config failures

This catches the common failures: wrong base URL, wrong alias/model id, bad chat-template setup, broken streaming behavior, or a broken custom-model contract.

### Layer 3 — pi integration

Exact checks for **phase-1 integrated**:
- `/model` displays the model id `gemma4-memory`
- selection string for the smoke test is `local-llama/gemma4-memory`
- a trivial test prompt in pi, such as `Reply with exactly: PI_GEMMA_OK`, completes with the expected string
- a second follow-up turn in the same pi session succeeds
- one larger prompt representative of memory/dream prompt size succeeds without protocol/config errors
- one tool-call smoke test succeeds: prompt pi to use the `read` tool on `README.md` and report the first extension listed in the table

Only after the phase-1 integrated checks pass should the setup be considered usable. Capture command output or screenshots for each layer so the result is not based on vibes.

Long-context verification is a separate follow-up check, not part of baseline phase-1 success.

## 9) Risks and Failure Handling

### Common risks

- Wrong GGUF chosen or gated download failure
- Chat template mismatch causing garbage output
- Overly optimistic context/window settings hurting speed badly
- OpenAI-compat quirks in pi/custom-provider config
- Port collision on `8123`
- Model id drift between the server alias, `/v1/models`, and `models.json`
- Future dream-only routing may also depend on the local model being visible in pi's enabled/scoped model settings, not just `models.json`

### Failure policy

- If `UD-Q5_K_M` is unavailable, fall back to `Q5_K_M`
- If `131072` context cannot start cleanly, or if a representative direct request cannot complete within a reasonable smoke-test budget (for example, under 60 seconds for a short response), keep phase 1 at `65536`; `131072` then becomes explicit follow-up tuning work rather than a hidden assumption
- If the OpenAI-compatible config is unhappy, keep the provider simple and disable unsupported compatibility features first
- If `8123` is occupied, move the server port and update the provider config to match
- If the loaded model name is unstable, force a stable `--alias gemma4-memory` in the launcher script and use that everywhere

## 10) Acceptance Criteria

### Phase-1 integrated

1. A local Gemma 4 GGUF exists on disk in a stable path.
2. The preferred artifact is the instruct/chat model from `unsloth/gemma-4-26B-A4B-it-GGUF`, using a filename pattern matching `*UD-Q5_K_M*.gguf` when available and `*Q5_K_M*.gguf` as the accepted fallback. An equivalent Gemma 4 26B-A4B instruct GGUF with the same quant characteristics is acceptable if the preferred source is unavailable.
3. A launcher script at a documented path (recommended: `~/.local/bin/start-gemma4-memory`) can start `llama-server` reproducibly with a stable alias of `gemma4-memory`.
4. The verified baseline uses `65536` context, and `models.json.contextWindow` matches the server's actual configured context window.
5. `GET /v1/models` returns an entry whose id is `gemma4-memory`.
6. Direct non-streaming and streaming `POST /v1/chat/completions` calls using `model: "gemma4-memory"` succeed and return the expected test string.
7. One larger direct prompt containing at least 4,000 characters of text succeeds without protocol/config errors.
8. `/model` shows model id `gemma4-memory`, and the smoke-test selection string `local-llama/gemma4-memory` works.
9. pi can switch to that model, complete the expected test prompt, complete one follow-up turn in the same session, and complete one `read` tool-call smoke test.
10. No `memory` extension code changes are required for this first phase.

### Long-context verified

11. The same setup can be re-verified at `131072` context with `models.json.contextWindow` updated to match.
12. A larger direct prompt than the phase-1 baseline completes successfully at `131072` without startup or protocol/config failures.

## 11) Follow-up Work (Deferred)

Once the setup is working, the next design/planning step is to decide how `memory dream` should use it:
- dream-only routing
- all memory operations routing
- session-level manual model switching

That should be a separate change after the local model setup is verified.

Implementation note for that later phase: if dream-only routing uses subagents or explicit model overrides, it may also require the local model to be present in pi's enabled-model settings, not just `models.json`.