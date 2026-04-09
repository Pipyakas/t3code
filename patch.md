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

## Auto-Update Configuration

This fork is configured to auto-update from GitHub releases at `Pipyakas/t3code`.

### Build Windows EXE

**Locally**: Not supported on Linux due to native module cross-compilation limitations. Use GitHub Actions.

### Update Frequency

- **Poll interval**: Daily (24 hours) - changed from upstream's 4 hours
- **Check on startup** with 15 second delay
- **Manual check** available via Help menu

### For Private Repo Updates

Set `T3CODE_DESKTOP_UPDATE_GITHUB_TOKEN` environment variable when running the app to authenticate with GitHub API for private repos.

## Release Workflow

### Windows-Only Release (`.github/workflows/release-windows.yml`)

Simplified workflow for building Windows exe releases:

**Trigger**: Push tag `v*.*.*` or manual workflow dispatch

**Requirements**: None - no signing required

**Usage**:
```bash
# Create and push a release tag
git tag v0.0.1
git push origin v0.0.1
```

The workflow:
1. Builds Windows x64 NSIS installer on Windows runner
2. Creates GitHub Release with `*.exe`, `*.blockmap`, and `latest*.yml` assets
3. No signing required (unsigned build)

### Future Considerations

- History sync from OpenCode SQLite DB (shelved on `opencode-history-sync` branch)
- Bidirectional sync would require writing to OpenCode's SQLite or using ACP protocol
