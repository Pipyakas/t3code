# T3Code Fork Patch Notes

This document describes the changes made in this fork compared to the upstream [pingdotgg/t3code](https://github.com/pingdotgg/t3code) repository.

## Overview

This fork adds **OpenCode** and **Gemini** as provider integrations, expanding beyond the original Codex/Claude-only focus.

## Changes

### Provider Integrations

#### OpenCode Provider
- **Added** `OpenCodeProvider.ts` in `apps/server/src/provider/Layers/`
- **Added** `OpenCodeAdapter.ts` in `apps/server/src/provider/Layers/`
  - Spawns `opencode acp` process for live sessions via JSON-RPC over stdio
  - Implements ACP protocol: `session/new`, `session/prompt`, `session/cancel`, `session/end`
  - Normalizes OpenCode events to `ProviderRuntimeEvent` (thread.started, turn.started, content.delta, etc.)
- **Default model**: `opencode/big-pickle`

#### Gemini Provider
- **Added** `GeminiProvider.ts` in `apps/server/src/provider/Layers/`
- **Default model**: `auto-gemini-2.5`

### Model Defaults

| Provider | Upstream Default | Fork Default |
|----------|-----------------|--------------|
| opencode | `opencode/minimax-m2.5-free` | `opencode/big-pickle` |
| gemini | `gemini-3-flash-preview` | `auto-gemini-2.5` |

### UI Changes

- Integrated OpenCode and Gemini providers in model selection UI (`apps/web/src/providerModels.ts`)
- Added model picker support for OpenCode models
- Added auto-gemini model options

## Architecture Notes

### ACP Protocol (OpenCode)

OpenCode uses the Agent Client Protocol (ACP) over stdio:
- Process: `opencode acp`
- Protocol: JSON-RPC 2.0 over stdin/stdout
- Events streamed via `session/update` notifications

### Session Management

```
WebSocket → OrchestrationEngine → ProviderCommandReactor → ProviderService → OpenCodeAdapter → opencode acp process
```

### Future Considerations

- History sync from OpenCode SQLite DB (shelved on `opencode-history-sync` branch)
- Bidirectional sync would require writing to OpenCode's SQLite or using ACP protocol
