# Hypura Local Setup Plan

> REQUIRED: Use the `executing-plans` skill to implement this plan task-by-task.

**Goal:** Get [hypura](https://github.com/t8/hypura) built and running locally so you can run large GGUF models on your M4 Max via GPU/RAM/NVMe tiered inference.

**Architecture:** Hypura is a Rust project that wraps llama.cpp (vendored, built via CMake). It profiles your hardware, then places model tensors across GPU, RAM, and NVMe tiers so models larger than physical memory can run without crashing. It also exposes an Ollama-compatible HTTP API (`/api/chat`, `/api/generate`).

**Tech Stack:** Rust 1.75+ (you have 1.93 ✓), CMake (needs install), Apple Metal, GGUF model files

**Your hardware:** M4 Max, 64 GB unified memory, Apple SSD — this is ideal for hypura. You can run models up to ~60 GB fully resident, and even larger via NVMe streaming.

---

### Task 1: Install CMake

Hypura vendors llama.cpp and builds it via CMake during `cargo build`. CMake is not currently installed.

**Files:** None

- [x] **Step 1: Install CMake via Homebrew**

```bash
brew install cmake
```

- [x] **Step 2: Verify CMake is installed**

Run: `cmake --version`
Expected: `cmake version 3.x.x` (any 3.x is fine)

---

### Task 2: Clone the hypura repo

**Files:**
- Create: `~/code/bobcats/hypura/` (the cloned repo)

- [x] **Step 1: Clone with submodules**

The `--recurse-submodules` flag is critical — it pulls in the vendored llama.cpp source.

```bash
cd ~/code/bobcats
git clone --recurse-submodules https://github.com/t8/hypura.git
cd hypura
```

- [x] **Step 2: Verify submodules are present**

Run: `ls vendor/llama.cpp/CMakeLists.txt`
Expected: The file exists. If not, run `git submodule update --init --recursive`.

---

### Task 3: Build hypura

**Files:**
- Output: `~/code/bobcats/hypura/target/release/hypura`

- [x] **Step 1: Build in release mode**

This will take a few minutes the first time (compiles llama.cpp + all Rust crates).

```bash
cd ~/code/bobcats/hypura
cargo build --release
```

Expected: Compiles without errors. Warnings are fine.

- [x] **Step 2: Verify the binary exists**

Run: `ls -lh target/release/hypura`
Expected: A binary file, likely 10-30 MB.

- [x] **Step 3: Test the binary runs**

Run: `./target/release/hypura --help`
Expected: Usage info showing subcommands like `profile`, `run`, `serve`, `bench`, `inspect`.

---

### Task 4: Profile your hardware

Hypura needs a one-time hardware profile to make placement decisions. This measures GPU working set size, RAM bandwidth, and NVMe throughput.

- [x] **Step 1: Run the profiler**

```bash
cd ~/code/bobcats/hypura
./target/release/hypura profile
```

Expected: Output showing detected GPU, memory, and NVMe stats. Results are cached (likely in `~/.hypura/`).

---

### Task 5: Download a test model

You need a GGUF model file. Start with something that fits in your 64 GB to verify the setup works, then optionally try a larger model.

**Files:**
- Create: `~/code/bobcats/hypura/test-models/` directory

- [x] **Step 1: Create the test-models directory**

```bash
mkdir -p ~/code/bobcats/hypura/test-models
```

- [x] **Step 2: Download a starter model**

Pick ONE. The Qwen 14B is small enough to be fully GPU-resident on your 64 GB machine (fast, good for verification). The Mixtral is bigger and will exercise NVMe streaming.

**Option A — Qwen 2.5 14B Q4_K_M (~8.4 GB, fully resident):**
```bash
cd ~/code/bobcats/hypura/test-models
curl -L -O https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/qwen2.5-14b-instruct-q4_k_m.gguf
```

**Option B — Mixtral 8x7B Q5_K_M (~31 GB, will test NVMe streaming):**
```bash
cd ~/code/bobcats/hypura/test-models
curl -L -O https://huggingface.co/TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF/resolve/main/mixtral-8x7b-instruct-v0.1.Q5_K_M.gguf
```

Start with Option A. You can always download Option B later.

- [ ] **Step 3: Verify the download**

Run: `ls -lh ~/code/bobcats/hypura/test-models/`
Expected: The `.gguf` file at the expected size (~8.4 GB for Qwen, ~31 GB for Mixtral).

---

### Task 6: Run inference

- [ ] **Step 1: Inspect the model placement plan (dry run)**

This shows how hypura would place tensors without actually loading the model.

```bash
cd ~/code/bobcats/hypura
./target/release/hypura inspect ./test-models/qwen2.5-14b-instruct-q4_k_m.gguf
```

Expected: A table showing tensor placement across GPU/RAM/NVMe tiers. For the 8.4 GB Qwen on 64 GB, everything should be GPU-resident.

- [ ] **Step 2: Test with a short prompt (safety first)**

```bash
./target/release/hypura run ./test-models/qwen2.5-14b-instruct-q4_k_m.gguf \
  --prompt "Hello, world" --max-tokens 10
```

Expected: A short generated response, ~20+ tok/s on your M4 Max.

- [ ] **Step 3: Try interactive chat**

```bash
./target/release/hypura run ./test-models/qwen2.5-14b-instruct-q4_k_m.gguf --interactive
```

Expected: An interactive prompt where you can chat with the model. Ctrl+C to exit.

---

### Task 7: Start the Ollama-compatible server

This is the key feature for integration — any tool that speaks Ollama protocol can use hypura as a backend.

- [ ] **Step 1: Start the server**

```bash
cd ~/code/bobcats/hypura
./target/release/hypura serve ./test-models/qwen2.5-14b-instruct-q4_k_m.gguf
```

Expected: Output like:
```
Hypura serving Qwen 2.5 14B Instruct
Endpoint: http://127.0.0.1:8080
Ollama-compatible API: /api/generate, /api/chat, /api/tags
```

- [ ] **Step 2: Test the API from another terminal**

```bash
curl http://127.0.0.1:8080/api/tags
```

Expected: JSON listing the loaded model.

```bash
curl -X POST http://127.0.0.1:8080/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen2.5-14b-instruct-q4_k_m", "prompt": "Why is the sky blue?", "stream": false}'
```

Expected: A JSON response with the model's answer.

- [ ] **Step 3: Stop the server**

Ctrl+C in the terminal running `hypura serve`.

---

### Task 8 (Optional): Add hypura to PATH

If you want to run `hypura` from anywhere without the full path:

- [ ] **Step 1: Symlink or add to PATH**

```bash
ln -s ~/code/bobcats/hypura/target/release/hypura /opt/homebrew/bin/hypura
```

- [ ] **Step 2: Verify**

Run from any directory: `hypura --help`
Expected: Usage info.

---

## Summary

After completing Tasks 1–7, you'll have:
- hypura built from source
- Hardware profiled
- A local GGUF model downloaded
- Interactive chat working
- An Ollama-compatible HTTP server you can point other tools at (port 8080)

With 64 GB on an M4 Max, models up to ~55 GB should run fully resident at full Metal speed. Larger models will automatically use NVMe streaming.
