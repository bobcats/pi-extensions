# Hypura Provider Extension

Bridges pi to a local [Hypura](https://github.com/hypura/hypura) instance via its Ollama-compatible API. Hypura runs GGUF models on Apple Silicon with GPU/RAM/NVMe tiered scheduling — enabling models larger than your RAM.

## Setup

### 1. Download a model

```sh
# Qwen3.5-122B-A10B Q4_K_M (~76.5GB, MoE with 10B active params)
cd ~/code/bobcats/hypura/test-models
hf download unsloth/Qwen3.5-122B-A10B-GGUF --include "Q4_K_M/*" --local-dir .
```

### 2. Start Hypura

```sh
# Point at the first shard — llama.cpp auto-discovers the rest
hypura serve ./test-models/Q4_K_M/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf \
  --context 262144 \
  --port 8080
```

### 3. Use in pi

```sh
pi -e ./hypura
# Then /model → hypura/<model-name>
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HYPURA_BASE_URL` | `http://127.0.0.1:8080` | Hypura server URL |

## How it works

The extension auto-discovers the loaded model via Hypura's `/api/tags` endpoint and registers it as a pi provider. It streams responses via the Ollama-compatible `/api/chat` NDJSON protocol.

## Recommended models

| Model | Size | Context | Architecture | Notes |
|-------|------|---------|-------------|-------|
| **Qwen3.5-122B-A10B** | 76.5GB Q4 | 262K | MoE (10B active) | Best for Hypura NVMe streaming on 64GB Mac |
| **Qwen3.5-35B-A3B** | ~22GB Q4 | 262K | MoE (3B active) | Fast, fits in RAM |
| **Qwen2.5-Coder-32B** | ~20GB Q4 | 128K | Dense | Best pure coding model |
