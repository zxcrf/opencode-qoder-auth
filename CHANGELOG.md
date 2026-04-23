# Changelog

All notable changes to this project will be documented in this file.

## [0.2.4] - 2026-04-23

### 🔧 Fixed
- Removed the private `@ali/qoder-agent-sdk` install-time dependency so opencode can auto-install the plugin from npm without hitting a 404
- Kept the vendored SDK as the runtime source of truth, matching the documented zero-config packaging model

### 📦 Packaging
- Added an explicit npm `files` whitelist so published tarballs only include the plugin entrypoints, runtime sources, vendored SDK, README, and license
- Updated `package-lock.json` to match the publishable dependency graph

### 📝 Documentation
- Corrected installation guidance to reflect opencode's startup-time npm plugin installation flow

### ✅ Testing
- Added manifest and README regression tests covering the public install path and the no-private-dependency packaging rule

---

## [0.2.3] - 2026-03-23

### 🎉 Major Features

#### ✨ Quest Mode Support via @ali/qoder-agent-sdk v0.0.44
- Replaced ACP with `@ali/qoder-agent-sdk` v0.0.44 to enable Qoder CLI's built-in tools in Quest mode
- Models now support real tool invocations (Bash, Read, Write, Edit, Glob, Grep, etc.) instead of simulated text blocks
- Provider-executed tool stream parts now properly emit `tool_use` and `tool_result` events

#### 🖼️ Enhanced Image Support
- Support `type='file'` image parts from clipboard paste (TDD)
- Added proper `modalities.input` declaration for multimodal models
- Base64 image handling with automatic media type resolution

#### 🔄 Query API Restoration  
- Restored `query()` API and tool normalization
- Improved tool serialization and execution tracking
- Added `modalities` field to model definitions for proper multimodal detection

### 🔧 Bug Fixes

#### Multi-turn Conversation Fix
- Fixed issue where provider would not respond to the latest user message in multi-turn conversations
- Now properly serializes full conversation history including `tool-call` and `tool-result` messages

#### Tool Execution & Stream Parts
- **Removed `disallowedTools: ['*']`** — enables CLI built-in tools (previously blocked)
- Emit proper `providerExecuted: true` stream parts to signal opencode that tools are handled by Qoder CLI
- Corrected tool result content serialization

#### CLI Built-in Tools Now Enabled
- Tools are no longer disabled by default
- CLI-executed tools (Bash, Read, Write, Edit, Glob, Grep, etc.) now flow through as proper tool use events

### 📋 Serialization & History

#### Prompt Builder Improvements
- Serialize full conversation history including `tool-call` and `tool-result` messages
- Support for both multimodal and text-only paths
- Proper handling of tool output serialization (text, JSON, errors)

#### Storage Directory Resolution
- Priority check: `~/.qoderwork/.auth/user` (QoderWork login)
- Fallback: `~/.qoder/.auth/user` (Qoder CLI login)
- Supports both QoderWork and standalone Qoder CLI authentication paths

### 📦 Dependencies

- Upgraded `@ai-sdk/provider` from v1.1.3 to v3.0.8
- Updated `@ali/qoder-agent-sdk` to v0.0.44

### 📝 Documentation

- Added comprehensive `HANDOFF.md` documenting Quest mode implementation details
- Updated authentication messaging for clarity
- Improved code organization and comments in streaming pipeline

### ✅ Testing

- Enhanced integration test fixtures with E2E snapshots
- Expanded `prompt-builder.test.ts` with multimodal scenarios
- Improved `qoder-language-model.test.ts` test coverage for streaming pipeline

---

## [0.2.2] - 2026-02-08

### 🔧 Fixed
- Synchronized model parameters with `~/.qoder/.auth/models`
- Normalized Qoder tool replay for opencode

---

## [0.2.1] - 2026-02-07

### 🔧 Fixed
- Corrected repository URL from yee88 to yee94

---

## [0.2.0] - 2026-02-05

### ✨ New Features
- Redesigned as opencode plugin with auto-injected provider
- Authentication hook integration
- Model injection via `config` hook

### 🔄 Migration
- Migrated to pnpm from npm
- Removed legacy `sdk/` directory
- Vendored SDK is now in `src/vendor/`

---

## [0.1.0] - 2026-01-30

### 🎉 Initial Release
- OpenCode Qoder Provider v0.1.0
- Basic language model support
- Plugin architecture foundation
