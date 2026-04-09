# Gemma 4 Local Setup for Memory Dream

Date: 2026-04-09
Status: Draft approved in conversation; pending written-spec review
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

Recommended baseline:
- **Port:** `8123`
- **Context:** `131072`
- **Parallel:** `1`
- **Text-only:** yes
- **Chat template:** use the model's proper Gemma/GGUF template support
- **Quant:** `UD-Q5_K_M` preferred, else `Q5_K_M`

Rationale for context size:
- `memory` dream re-reads vault context repeatedly.
- The extension injects vault index material into the prompt.
- `65536` is likely too cramped once the vault grows.
- `131072` is a safer starting point without immediately turning the server into molasses.

This setting may still be revised later if actual prompt-eval cost is unacceptable, but it is the right first target for dream-oriented memory work.

## 6) Operator Workflow

Use a stable, explicit workflow rather than making the operator remember a giant command.

### Files and locations

- Model files live in a stable local directory, for example: `~/models/gemma4/`
- A small launcher script starts `llama-server` with the chosen flags
- pi model registration lives in: `~/.pi/agent/models.json`

### Launch workflow

1. Ensure the GGUF exists locally.
2. Start `llama-server` from the launcher script.
3. Verify the endpoint directly.
4. Open pi and select the registered local model via `/model`.
5. Run a simple prompt through pi to confirm end-to-end behavior.

Recommendation: keep the launcher script under a memorable path and avoid manual copy-paste startup.

## 7) pi Model Registration

Register the local model as a normal custom provider in `~/.pi/agent/models.json`.

Expected characteristics:
- OpenAI-compatible endpoint backed by local `llama-server`
- A named provider such as `local-llama`
- A named model entry for the Gemma variant
- Compatibility flags to disable unsupported OpenAI niceties if needed, especially:
  - `supportsDeveloperRole: false`
  - `supportsReasoningEffort: false`

This keeps pi from sending protocol details that some local servers handle badly.

## 8) Verification Strategy

Verification happens in three layers.

### Layer 1 — server availability

Confirm the local server is reachable and serving the selected model.

### Layer 2 — direct inference

Send a minimal local request and confirm it returns a sane text response.

### Layer 3 — pi integration

Confirm:
- `/model` lists the custom model
- pi can switch to it
- a trivial prompt completes successfully

Only after all three pass should the setup be considered complete.

## 9) Risks and Failure Handling

### Common risks

- Wrong GGUF chosen or gated download failure
- Chat template mismatch causing garbage output
- Overly optimistic context/window settings hurting speed badly
- OpenAI-compat quirks in pi/custom-provider config
- Port collision on `8123`

### Failure policy

- If `UD-Q5_K_M` is unavailable, fall back to `Q5_K_M`
- If `131072` context performs terribly, reduce only after baseline verification
- If the OpenAI-compatible config is unhappy, keep the provider simple and disable unsupported compatibility features first
- If `8123` is occupied, move the server port and update the provider config to match

## 10) Acceptance Criteria

1. A local Gemma 4 GGUF exists on disk in a stable path.
2. A launcher script can start `llama-server` reproducibly.
3. The local endpoint responds successfully.
4. pi lists the local model via `/model`.
5. pi can switch to the model and complete a test prompt.
6. No `memory` extension code changes are required for this first phase.
7. A follow-up phase can later route `memory dream` specifically to this local model.

## 11) Follow-up Work (Deferred)

Once the setup is working, the next design/planning step is to decide how `memory dream` should use it:
- dream-only routing
- all memory operations routing
- session-level manual model switching

That should be a separate change after the local model setup is verified.