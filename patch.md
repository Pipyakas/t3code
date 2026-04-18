# T3 Code Fork Specification

## Base
- `upstream/main`

## Fork Intent

1. **Primary environment**: Keep T3 Code reliable for day-to-day Antigravity and Windows usage.
2. **Provider priority**: Gemini CLI is the primary non-upstream provider
3. **Mobile integration**: track mobile integration work via `mobile-remote-connect` branch.
4. **Rebase discipline**: Stay close enough to upstream structure that future rebases remain tractable.

## Fork-Specific Changes

### Linux Server Build
- `scripts/build-server-artifact.ts` - Standalone Linux server binary build and systemd service install

### Windows Release Workflow
- `.github/workflows/release-fork.yml` - Windows-only release workflow for forks with code signing and notarization

### VSCode Configuration
- `.vscode/launch.json` - Debug configurations for desktop app
- `.vscode/tasks.json` - Build and run tasks

### VCS Mode Setting
- `packages/contracts/src/settings.ts` - Added `VCSMode` type (`"git" | "disabled"`) and `vcs` field to client and server settings for version control mode selection

### Gemini CLI Provider
Full Gemini CLI provider implementation with ACP protocol support.

**Core Implementation:**
- `apps/server/src/provider/Layers/GeminiAdapter.ts` - Main adapter with ACP message handling, tool execution, approval flows, and stream processing
- `apps/server/src/provider/Layers/GeminiProvider.ts` - Provider layer with model discovery, settings management, and lifecycle coordination
- `apps/server/src/provider/geminiAcpProbe.ts` - Capability probing via `gemini capabilities` CLI command, model enumeration, and auth status detection
- `apps/server/src/provider/geminiValue.ts` - JSON-RPC value parsing utilities for ACP messages

**Shared Contracts:**
- `packages/contracts/src/settings.ts` - GeminiSettings schema with binaryPath, enabled, customModels
- `packages/contracts/src/model.ts` - GeminiModelOptions, DEFAULT_GEMINI_MODEL_CAPABILITIES
- `packages/contracts/src/providerRuntime.ts` - Runtime event source definitions (`gemini.acp.message`, `gemini.acp.stdout`, `gemini.acp.stderr`)

**Key Features:**
- ACP (Agent Communication Protocol) - JSON-RPC over stdio communication
- Multi-model support with custom model configuration
- Tool call execution with pending approval workflow
- Windows and Unix path handling for temp directories
- Provider status caching with 2-minute refresh interval
- Initial pending provider snapshot for bootstrap readiness

**Implementation Pattern:** Leverage `packages/effect-acp` (AcpAgent, AcpClient, protocol) and `apps/server/src/provider/acp/` (AcpSessionRuntime, AcpCoreRuntimeEvents) similar to Cursor provider implementation.

## Provider Surface In This Fork

The active provider set in this fork is:
- `codex`
- `claudeAgent`
- `gemini`
- `opencode`

## Tracking Branches

- `mobile-remote-connect`: tracks `upstream/t3code/mobile-remote-connect`; used to stage mobile integration work for this fork, with Android as the target platform direction.

Refresh workflow for these tracking branches:

```bash
git fetch upstream t3code/mobile-remote-connect
git branch -f mobile-remote-connect refs/remotes/upstream/t3code/mobile-remote-connect
```

## Commit History Structure

After a fetch + rebase from upstream, each feature is squashed into a single commit:

```
upstream/main (base)
...
<squash: fork-documentation>
<squash: vscode-configuration>
<squash: vcs-mode-setting>
<squash: windows-release-workflow>
<squash: linux-server-build>
<squash: mobile-remote-connect>
<squash: gemini-cli-provider>
```

**Commit order**: Fork documentation is injected first, before any feature commits. Features are ordered by change count (least to most).

**Pre-rebase**: Working commits accumulate freely—fixes, incremental changes, and WIP pile on without restriction.

**Post-rebase**: Each feature's commits are squashed into one clean commit encapsulating the full feature scope.

**Intent**: Keep commit history readable and history rewrites localized to rebase events, not ongoing development.