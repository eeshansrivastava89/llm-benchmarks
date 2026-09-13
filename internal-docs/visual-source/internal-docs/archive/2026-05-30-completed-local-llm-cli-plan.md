---
title: "[Completed] Local LLM CLI Plan"
lastmod: 2026-05-30
---


## Status

**Completed.** The CLI is fully functional and has been consolidated around a single entry point. This document is a completed project record.

## What shipped

The CLI is a multi-backend helper for running local models through llama.cpp, Ollama, oMLX, or cloud APIs, then launching Pi or OpenCode against the server.

### Commands

```bash
local-llm models          # interactive: inspect, set up, run, benchmark, remove
local-llm run <profile>   # start server + launch harness
local-llm stop [profile]  # stop tracked servers
```

The `models` command is the single entry point for all actions. It discovers GGUF models from LM Studio, live models from Ollama and oMLX, and cloud models from past runs.

### Implemented capabilities

- Scan downloaded LM Studio GGUF models
- Detect likely vision `mmproj` companions
- Discover live Ollama and oMLX models from their APIs
- List cloud models from past benchmark runs + "New cloud model" option
- Create profile folders under `.local-llm/profiles/`
- Generate editable `llama-server.sh` command files (llama.cpp profiles)
- Support standard and MTP server modes (with optional `--spec-draft-model` for external drafter GGUFs)
- Estimate model/runtime memory from the command/profile
- List saved profiles and unprofiled downloaded models with Pi/OpenCode status badges
- Inspect a profile and show endpoint, alias, command, estimate, harness strings
- Run a profile with auto-config-sync for Pi/OpenCode
- Launch Pi/OpenCode harness after starting server
- Stop tracked servers with `local-llm stop`, `local-llm stop <profile>`, or `local-llm stop --all`
- Prepare benchmark run directories (visual + data-science)
- Benchmark cloud models (no local server needed)
- Write raw and friendly logs under `.local-llm/logs/`
- Sync Pi/OpenCode harness configs from the models menu
- Remove profiles and clean up harness configs
- Persist cloud models checkbox and benchmark kind tab in the UI

### Model source schema

Normalized across all UI and metadata:

| `modelSource` | Backend | Description |
|---|---|---|
| `llama-cpp` | LM Studio / llama.cpp | Local GGUF server |
| `llama-cpp-mtp` | llama.cpp MTP | Local GGUF with speculative decoding |
| `ollama` | Ollama | Managed Ollama server |
| `omlx` | oMLX | Managed oMLX server |
| `cloud` | Cloud API | Any cloud model (manual prompt copy) |

Old values `custom`, `lmstudio`, and `(none)` have been migrated to this set.

## Supported backends

| Backend | Type | Server management | Model source |
|---|---|---|---|
| llama.cpp | local-server | Start/stop process | `~/.lmstudio/models/` GGUF |
| llama.cpp MTP | local-server | Start/stop with speculative decoding | `~/.lmstudio/models/` GGUF |
| Ollama | managed-server | Verify connectivity | Ollama API |
| oMLX | managed-server | Verify connectivity | oMLX API |
| Cloud | none | No server | Any API |

## MTP and draft model support

Standard MTP profiles use built-in MTP heads:

```bash
--spec-type draft-mtp
--spec-draft-n-max 2
```

Profiles can optionally specify an external drafter model (`draftModelPath`) which emits `--spec-draft-model <path>`. This enables separate drafter GGUFs for models like Gemma 4 that ship MTP assistants as standalone files.

**Note:** Gemma 4 MTP drafter GGUFs use a custom `gemma4_assistant` architecture not supported by stock llama.cpp. They require the `atomic-llama-cpp-turboquant` fork.

## Validation / current docs

```bash
local-llm help
AGENTS.md
```
