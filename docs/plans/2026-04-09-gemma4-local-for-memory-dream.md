# Gemma 4 Local Setup for Memory Dream Implementation Plan

> REQUIRED: Use the `executing-plans` skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up a local Gemma 4 model behind `llama-server`, register it in pi as `local-llama/gemma4-memory`, and verify the baseline 65k-context setup end-to-end.

**Architecture:** This setup uses plain `llama-server` plus pi's custom model registry in `~/.pi/agent/models.json`. The launcher script lives in `~/.local/bin`, prefers the `UD-Q5_K_M` Gemma 4 26B-A4B GGUF when present, and starts a stable local OpenAI-compatible endpoint on `127.0.0.1:8123`. Phase 1 verifies the conservative `65536` context path; `131072` stays a follow-up verification target instead of pretending to be done early.

**Tech Stack:** `llama-server`, Hugging Face CLI (`hf`), shell scripting, JSON config in `~/.pi/agent/models.json`, pi CLI/TUI

---

## Scope check

- Single subsystem only: local Gemma 4 serving + pi model registration + baseline verification.
- Explicitly excluded: dream-only routing, `memory` extension changes, multimodal support, repo extension code changes.

## File structure map

### Create
- `~/models/gemma4/` — local GGUF storage directory
- `~/.local/bin/start-gemma4-memory` — launcher script for the local server
- `~/.pi/agent/models.json` — pi custom model registry if it does not already exist

### Modify if present
- `~/.pi/agent/models.json` — merge in the `local-llama` provider while preserving any existing providers
### Runtime outputs
- `~/Library/Logs/gemma4-memory.log` — server log when backgrounded
- `/tmp/gemma4-memory.pid` — optional background PID file for the smoke test

## Execution note

These changes live under `$HOME`, not this repo, so there is no meaningful git commit checkpoint in the executable path. Use timestamped backups before mutating config files and keep command output/logs as evidence.

---

### Task 1: Prepare the local paths and back up pi config

**Files:**
- Create: `~/models/gemma4/`
- Create if needed: `~/.pi/agent/backups/`
- Read/backup: `~/.pi/agent/models.json`

- [ ] **Step 1: Verify the required CLIs exist**

Run:

```bash
which llama-server
which hf
```

Expected:
- `llama-server` resolves to a real path
- `hf` resolves to a real path for Hugging Face downloads

- [ ] **Step 2: Install the Hugging Face CLI if `hf` is missing**

Run only if `which hf` failed:

```bash
python3 -m pip install --user "huggingface_hub[cli]"
```

Expected:
- `hf` becomes available on your shell path

- [ ] **Step 3: Verify Hugging Face auth before attempting the gated download**

Run:

```bash
hf auth whoami
```

Expected:
- your Hugging Face username is printed
- if this fails, run `hf auth login` and accept the model terms in the browser before moving on

- [ ] **Step 4: Create the model and backup directories**

Run:

```bash
mkdir -p ~/models/gemma4 ~/.pi/agent/backups ~/.local/bin ~/Library/Logs
```

Expected:
- all four directories exist

- [ ] **Step 5: Back up `models.json` if it already exists**

Run:

```bash
if [ -f ~/.pi/agent/models.json ]; then
  cp ~/.pi/agent/models.json ~/.pi/agent/backups/models.json.$(date +%Y%m%d-%H%M%S).bak
fi
```

Expected:
- no error if the file is missing
- if present, a timestamped backup appears in `~/.pi/agent/backups/`

- [ ] **Step 6: Confirm the current starting state**

Run:

```bash
[ -f ~/.pi/agent/models.json ] && echo present || echo missing
```

Expected:
- either `present` or `missing`
- both are valid; Task 4 handles either state safely

---

### Task 2: Download the Gemma 4 GGUF

**Files:**
- Create: `~/models/gemma4/<gguf>`

- [ ] **Step 1: Try the preferred UD quant first**

Run:

```bash
hf download unsloth/gemma-4-26B-A4B-it-GGUF \
  --include "*UD-Q5_K_M*.gguf" \
  --local-dir ~/models/gemma4
```

Expected:
- the command downloads one GGUF into `~/models/gemma4/`
- if no files match, move to the fallback step immediately

- [ ] **Step 2: Fallback to plain Q5 if the UD quant is unavailable**

Run only if Step 1 did not produce a GGUF:

```bash
hf download unsloth/gemma-4-26B-A4B-it-GGUF \
  --include "*Q5_K_M*.gguf" \
  --local-dir ~/models/gemma4
```

Expected:
- one GGUF lands in `~/models/gemma4/`

- [ ] **Step 3: Verify the downloaded file**

Run:

```bash
find ~/models/gemma4 -maxdepth 1 -type f -name '*.gguf' -print
```

Expected:
- at least one instruct/chat GGUF is printed
- preferred match contains `UD-Q5_K_M`
- accepted fallback contains `Q5_K_M`

- [ ] **Step 4: Record the exact file chosen for serving**

Run:

```bash
find ~/models/gemma4 -maxdepth 1 -type f \( -name '*UD-Q5_K_M*.gguf' -o -name '*Q5_K_M*.gguf' \) | sort
```

Expected:
- you can identify the exact file path the launcher should prefer

---

### Task 3: Write the launcher script

**Files:**
- Create: `~/.local/bin/start-gemma4-memory`
- Runtime log: `~/Library/Logs/gemma4-memory.log`

- [ ] **Step 1: Write the launcher script**

Create `~/.local/bin/start-gemma4-memory` with exactly this content:

```bash
#!/usr/bin/env bash
set -euo pipefail

MODEL_ROOT="${MODEL_ROOT:-$HOME/models/gemma4}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8123}"
CTX_SIZE="${CTX_SIZE:-65536}"
ALIAS="${ALIAS:-gemma4-memory}"

UD_MODEL="$(find "$MODEL_ROOT" -maxdepth 1 -type f -name '*UD-Q5_K_M*.gguf' | sort | head -n 1 || true)"
PLAIN_MODEL="$(find "$MODEL_ROOT" -maxdepth 1 -type f -name '*Q5_K_M*.gguf' ! -name '*UD-Q5_K_M*.gguf' | sort | head -n 1 || true)"
MODEL_PATH="${MODEL_PATH:-${UD_MODEL:-$PLAIN_MODEL}}"

if [[ -z "${MODEL_PATH:-}" || ! -f "$MODEL_PATH" ]]; then
  echo "Gemma 4 GGUF not found under $MODEL_ROOT" >&2
  exit 1
fi

exec llama-server \
  -m "$MODEL_PATH" \
  --alias "$ALIAS" \
  --host "$HOST" \
  --port "$PORT" \
  -c "$CTX_SIZE" \
  --chat-template gemma \
  --jinja
```

- [ ] **Step 2: Make the launcher executable and syntax-check it**

Run:

```bash
chmod +x ~/.local/bin/start-gemma4-memory
bash -n ~/.local/bin/start-gemma4-memory
```

Expected:
- no syntax errors

- [ ] **Step 3: Verify the launcher fails loudly when no model path is available**

Run:

```bash
MODEL_ROOT=/tmp/definitely-missing-gemma ~/.local/bin/start-gemma4-memory
```

Expected:
- exit status is non-zero
- stderr contains `Gemma 4 GGUF not found`

---

### Task 4: Create the pi custom model registry entry

**Files:**
- Create: `~/.pi/agent/models.json`

- [ ] **Step 1: Merge the baseline `local-llama` provider into `models.json`**

Run:

```bash
python3 - <<'PY'
import json
from pathlib import Path

path = Path.home() / '.pi' / 'agent' / 'models.json'
if path.exists():
    data = json.loads(path.read_text())
else:
    data = {}

providers = data.setdefault('providers', {})
new_provider = {
    'baseUrl': 'http://127.0.0.1:8123/v1',
    'api': 'openai-completions',
    'apiKey': 'local',
    'compat': {
        'supportsDeveloperRole': False,
        'supportsReasoningEffort': False,
        'supportsUsageInStreaming': False,
        'maxTokensField': 'max_tokens'
    },
}
new_model = {
    'id': 'gemma4-memory',
    'name': 'Gemma 4 Memory (Local)',
    'reasoning': False,
    'input': ['text'],
    'contextWindow': 65536,
    'maxTokens': 8192,
    'cost': {
        'input': 0,
        'output': 0,
        'cacheRead': 0,
        'cacheWrite': 0,
    },
}
existing = providers.get('local-llama')
if existing:
    for key in ('baseUrl', 'api', 'apiKey', 'compat'):
        if existing.get(key) != new_provider[key]:
            raise SystemExit(
                'Existing local-llama provider has conflicting config. Restore from backup or merge manually before continuing.'
            )
    models = existing.get('models', [])
else:
    models = []

filtered_models = [model for model in models if model.get('id') != 'gemma4-memory']
filtered_models.append(new_model)
providers['local-llama'] = {**new_provider, 'models': filtered_models}

path.write_text(json.dumps(data, indent=2) + '\n')
PY
```

Expected:
- `~/.pi/agent/models.json` exists afterward
- any pre-existing providers remain intact
- any compatible pre-existing `local-llama` models remain intact
- `gemma4-memory` is present with the baseline config
- the script aborts loudly instead of silently overwriting a conflicting `local-llama` provider

- [ ] **Step 2: Validate the JSON file**

Run:

```bash
python3 -m json.tool ~/.pi/agent/models.json >/dev/null
```

Expected:
- command exits successfully with no output

- [ ] **Step 3: Verify the context contract matches the launcher default**

Check:
- launcher default `CTX_SIZE` is `65536`
- `models.json.contextWindow` for `local-llama/gemma4-memory` is also `65536`

Expected:
- both values match exactly

---

### Task 5: Start the server and verify the HTTP endpoint directly

**Files:**
- Read: `~/.local/bin/start-gemma4-memory`
- Read: `~/.pi/agent/models.json`
- Runtime outputs: `~/Library/Logs/gemma4-memory.log`, `/tmp/gemma4-memory.pid`

- [ ] **Step 1: Start the server in the background for the smoke test**

Run:

```bash
nohup ~/.local/bin/start-gemma4-memory > ~/Library/Logs/gemma4-memory.log 2>&1 & echo $! > /tmp/gemma4-memory.pid
```

Expected:
- command returns immediately
- a PID is written to `/tmp/gemma4-memory.pid`

- [ ] **Step 2: Wait for `/v1/models` to come up or fail loudly**

Run:

```bash
ready=0
for i in {1..60}; do
  if ! kill -0 "$(cat /tmp/gemma4-memory.pid)" 2>/dev/null; then
    echo "llama-server exited early" >&2
    tail -50 ~/Library/Logs/gemma4-memory.log >&2 || true
    exit 1
  fi
  if curl -fsS http://127.0.0.1:8123/v1/models >/tmp/gemma4-models.json 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "Timed out waiting for http://127.0.0.1:8123/v1/models" >&2
  tail -50 ~/Library/Logs/gemma4-memory.log >&2 || true
  exit 1
fi
cat /tmp/gemma4-models.json
```

Expected:
- JSON is returned
- one model entry has `"id":"gemma4-memory"`
- timeout or startup failure prints the log tail and exits non-zero

- [ ] **Step 3: Run the non-streaming direct inference smoke test**

Run:

```bash
python3 - <<'PY'
import json, urllib.request
payload = {
  "model": "gemma4-memory",
  "stream": False,
  "messages": [{"role": "user", "content": "Reply with exactly: GEMMA_OK"}]
}
req = urllib.request.Request(
  "http://127.0.0.1:8123/v1/chat/completions",
  data=json.dumps(payload).encode(),
  headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=60) as response:
  body = json.load(response)
content = body["choices"][0]["message"]["content"]
print(content)
Path = __import__('pathlib').Path
Path('/tmp/gemma4-nonstream.txt').write_text(content)
PY
```

Expected:
- output contains `GEMMA_OK`
- `/tmp/gemma4-nonstream.txt` captures the response text

- [ ] **Step 4: Run the streaming direct inference smoke test**

Run:

```bash
curl -sN http://127.0.0.1:8123/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemma4-memory","stream":true,"messages":[{"role":"user","content":"Reply with exactly: GEMMA_OK"}]}' \
  | tee /tmp/gemma4-stream.txt

grep -q 'GEMMA_OK' /tmp/gemma4-stream.txt
```

Expected:
- streamed chunks arrive instead of a single buffered response
- `/tmp/gemma4-stream.txt` contains `GEMMA_OK`
- `grep` exits successfully; otherwise treat the streaming check as failed

- [ ] **Step 5: Run the representative direct prompt test**

Run:

```bash
python3 - <<'PY'
import json, urllib.request
text = ("Memory dream verification block. " * 180)
payload = {
  "model": "gemma4-memory",
  "stream": False,
  "messages": [{
    "role": "user",
    "content": text + "\n\nSummarize the material in exactly 5 bullet points."
  }]
}
req = urllib.request.Request(
  "http://127.0.0.1:8123/v1/chat/completions",
  data=json.dumps(payload).encode(),
  headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=60) as response:
  body = json.load(response)
content = body["choices"][0]["message"]["content"]
print(content)
Path = __import__('pathlib').Path
Path('/tmp/gemma4-representative.txt').write_text(content)
PY
```

Expected:
- request finishes within 60 seconds
- output is a coherent 5-bullet summary
- `/tmp/gemma4-representative.txt` captures the response text
- no protocol or config errors appear in the server log

---

## Failure playbook

Use these exact corrections before inventing new ones:
- If the server log shows `address already in use`, change the port in **both** `~/.local/bin/start-gemma4-memory` and `~/.pi/agent/models.json`, then rerun Tasks 4 and 5.
- If `/v1/models` returns an unexpected id, make sure the launcher still passes `--alias gemma4-memory`, then rerun Task 5.
- If pi fails while direct HTTP checks pass, keep `supportsUsageInStreaming: false` and `maxTokensField: "max_tokens"` in `models.json`; only add more compat flags after capturing the concrete pi error.
- If the `local-llama` provider merge step aborts on conflicting config, restore from the backup and perform a manual merge instead of clobbering the existing provider.

---

### Task 6: Verify pi can see and use the model

**Files:**
- Read: `~/.pi/agent/models.json`
- Read: `README.md` in this repo for the tool-call smoke test

- [ ] **Step 1: Verify the model is listed by pi**

Run:

```bash
pi --list-models gemma4-memory
```

Expected:
- output includes `gemma4-memory`

- [ ] **Step 2: Run the print-mode prompt smoke test**

Run:

```bash
pi --model local-llama/gemma4-memory -p "Reply with exactly: PI_GEMMA_OK" | tee /tmp/pi-gemma-prompt.txt
```

Expected:
- output contains `PI_GEMMA_OK`
- `/tmp/pi-gemma-prompt.txt` captures the transcript

- [ ] **Step 3: Run the print-mode larger-prompt smoke test**

Run:

```bash
python3 - <<'PY' | pi --model local-llama/gemma4-memory -p "Summarize the pasted text in exactly 5 bullet points." | tee /tmp/pi-gemma-large.txt
print("Memory dream verification block. " * 180)
PY
```

Expected:
- output is a coherent 5-bullet summary
- `/tmp/pi-gemma-large.txt` captures the transcript
- this proves pi can handle a prompt envelope larger than a trivial one on the baseline config

- [ ] **Step 4: Run the print-mode tool-call smoke test**

Run:

```bash
pi --model local-llama/gemma4-memory -p "Use the read tool on README.md and report the first extension listed in the table." | tee /tmp/pi-gemma-tool.txt
```

Expected:
- output identifies `auto-name-session` as the first extension listed in `README.md`
- `/tmp/pi-gemma-tool.txt` captures the transcript
- this proves the local model can at least complete one tool-using turn through pi

- [ ] **Step 5: Run the manual two-turn interactive smoke test**

Open pi normally, then do all of the following in one session:
1. run `/model`
2. select `gemma4-memory`
3. ask `Reply with exactly: TURN1_OK`
4. after it answers, ask `Now reply with exactly: TURN2_OK`

Expected:
- both turns succeed
- the model remains selected for the second turn

---

### Task 7: Capture the known-good baseline and cleanup instructions

**Files:**
- Read: `~/.local/bin/start-gemma4-memory`
- Read: `~/.pi/agent/models.json`
- Read: `~/Library/Logs/gemma4-memory.log`

- [ ] **Step 1: Confirm the baseline acceptance checklist is satisfied**

Check all of these:
- model file exists under `~/models/gemma4/`
- launcher script exists and is executable
- `models.json` exists and validates
- `/v1/models` returns `gemma4-memory`
- direct non-streaming and streaming tests passed
- representative 65k-baseline direct prompt passed
- `/tmp/gemma4-models.json`, `/tmp/gemma4-nonstream.txt`, `/tmp/gemma4-stream.txt`, and `/tmp/gemma4-representative.txt` exist as evidence
- `pi --list-models` shows `gemma4-memory`
- pi print-mode prompt passed
- pi larger-prompt smoke test passed
- pi tool-call smoke test passed
- `/tmp/pi-gemma-prompt.txt`, `/tmp/pi-gemma-large.txt`, and `/tmp/pi-gemma-tool.txt` exist as evidence
- manual two-turn interactive smoke test passed
- capture one screenshot or short operator note proving the interactive `/model` selection worked

- [ ] **Step 2: Record how to stop the background server**

Run when needed:

```bash
kill "$(cat /tmp/gemma4-memory.pid)"
rm -f /tmp/gemma4-memory.pid
```

Expected:
- the background `llama-server` process stops cleanly

- [ ] **Step 3: Keep the successful baseline at 65536**

Do not change the launcher default or `models.json.contextWindow` after the smoke test. Leave both at `65536` until a separate long-context verification pass is performed.

Expected:
- `~/.local/bin/start-gemma4-memory` still defaults to `CTX_SIZE=65536`
- `~/.pi/agent/models.json` still says `"contextWindow": 65536`

---

## Follow-ups

- Long-context verification:
  - rerun the launcher with `CTX_SIZE=131072`
  - update `~/.pi/agent/models.json` to `"contextWindow": 131072`
  - repeat the representative direct prompt with a meaningfully larger envelope
  - only keep 131072 if startup and request latency stay acceptable
- Future dream-only routing:
  - check whether the local model must also be present in pi's enabled/scoped model settings for subagent-based or override-based routing
  - design dream-only routing only after the baseline local model setup is stable
- Operational hardening:
  - if you want this to survive reboots cleanly, move the launcher into `launchd` or another supervisor after the baseline is proven
