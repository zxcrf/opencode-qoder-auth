# HANDOFF

## Goal

让 opencode-qoder-provider 的 **tool call 在 opencode UI 中可见**。Qoder CLI 内部执行工具（bash, read, write 等）以及 MCP 工具（context7 等），这些调用需要正确映射到 opencode 的工具体系，并在 UI 上显示。

## Instructions

- **TDD**：先写失败测试，再实现
- 工作目录：`/Users/yee.wang/Code/github/opencode-qoder-provider`（分支：`main`）
- **不要修改** vendored SDK（`src/vendor/qoder-agent-sdk.mjs`, `.d.ts`）
- 所有单元测试须通过（`npm test`）
- 不要设置 `disallowedTools`
- 用中文回复

## Discoveries

### 关键架构事实

1. **SDK `query()` 通过 `assistant` path 返回消息，不走 `stream_event`**。真实 API 测试确认 CLI 发 `type: 'assistant'` 消息，内含 `tool_use` 块。`stream_event` path 代码存在但生产中很少触发。

2. **CLI 用大写工具名**：`Bash`, `Read`, `Write`, `Glob` 等。opencode 用小写：`bash`, `read` 等。

3. **CLI MCP proxy 格式**：`mcp__serverName__toolName`（如 `mcp__context7__resolve-library-id`），而 **opencode 用 `serverName_toolName`**（如 `context7_resolve-library-id`）。这是**主要生产 bug** — opencode 拒绝 `mcp__context7__*` 名称，报错 `"Model tried to call unavailable tool"`。

4. **`providerExecuted: true` 无法阻止** opencode 的 `experimental_repairToolCall` 对未知工具名触发。旧方案（发射 `mcp__*` 名称 + `providerExecuted: true`）**从未生效**。

5. **SDK tool bridge (tool() + createSdkMcpServer()) 不可行**。根本问题：`query()` 是一次性 async generator，自带 agent loop。CLI 通过 SDK MCP handler 调用工具时，handler 需立即返回结果。但 opencode 流程是：读流 → 看到 tool-call → 结束流 → 执行工具 → 再次 `doStream()` 传结果。handler 无法跨 `doStream()` 边界等待。

6. **双轨 MCP 是正确方案**：CLI 通过 mcp-bridge 直接连接 MCP servers，opencode 管理自己的 MCP 连接。CLI 内部用 `mcp__server__tool` 格式，`normalizeToolName()` 转为 `server_tool` 给 opencode。两侧独立工作。

### normalizeToolName 转换链

```
CLI name                              → normalizeToolName()        → opencode name
Bash                                  → bash                       → matches 'bash'
Read                                  → read                       → matches 'read'
AskUserQuestion                       → question                   → matches 'question'
mcp__context7__resolve-library-id     → context7_resolve-library-id → matches opencode tool
```

### 简化后的 Tool 发射逻辑

- `isProviderExecuted = hasTools && !functionToolNames.has(normalizedToolName)`
- `!isProviderExecuted` → 发射 tool-call（opencode 执行）
- `isProviderExecuted` → 静默（CLI 内部处理，opencode 不可见）
- 不再有 `mcp__` 前缀特殊处理，不再发 `providerExecuted: true`

## Accomplished (已完成)

### ✅ Phase 1 — 基础工具调用

1. **移除 `disallowedTools: ['*']`** — 允许 CLI 内建工具执行
2. **实现 `tool_use`/`tool_result` stream part 发射** — 最初用 `providerExecuted: true` 方案

### ✅ Phase 2 — MCP 桥接 + 工具名映射

3. **修复大小写工具名匹配** — `normalizeToolName()` 转换 CLI 大写名（Bash→bash）
4. **新增 MCP proxy 名称转换** — `mcp__server__tool` → `server_tool` 匹配 opencode 格式
5. **移除所有 `mcp__` 特殊逻辑** — 不再有 `startsWith('mcp__')` 检查
6. **移除 `normalizeToolResultContent`** — 死代码清理
7. **实现双轨 MCP** — 移除 `filterMcpServers()`/`inferOwnedServerNames()`，CLI 获取全量 MCP servers
8. **新增 `src/mcp-bridge.ts`** — opencode config.mcp → Qoder SDK mcpServers 格式转换
9. **`index.ts` 更新** — config hook 调用 `setMcpBridgeServers()` + `convertOpencodeMcp()` 格式转换

### ✅ Phase 3 — 简化 Tool 发射

10. **只发射 function tool 调用** — `!isProviderExecuted` 的才发 tool-call，CLI 内部工具静默处理
11. **移除 tool-result 转发** — CLI 执行的结果不转发给 opencode
12. **移除残留 pending tool call 补空结果逻辑**

### ✅ Tests — 77 个通过

- 大小写工具名匹配测试
- MCP proxy 名称转换测试（`mcp__context7__*` → `context7_*` 匹配 opencode function tool）
- 未匹配 MCP 工具静默测试
- mcp-bridge 注入 query() mcpServers 测试
- providerOptions 优先级覆盖测试
- plugin.test.ts：config.mcp stdio/remote 类型提取测试
- 集成调试测试（skip，需要 `qoder login`）

## 🔴 当前问题 — Tool Call 在 opencode UI 中不可见

工具**可以正常调用执行**（功能正常），但 **opencode UI 中看不到 tool call 的显示**。

### 可能原因

1. **opencode 的 tool-call UI 需要特定的 stream part 格式/顺序** — 当前发射顺序：`tool-input-start` → `tool-input-delta` → `tool-input-end` → `tool-call`，但 opencode 可能期望不同格式
2. **toolCallId 格式问题** — CLI 生成的 `tool_use` block ID（如 `toolu_xxx`）可能不被 opencode 识别
3. **缺少必要的 stream part 属性** — 如 `args` vs `input`，或缺少某些元数据
4. **tool-call 时机问题** — opencode 可能需要在流结束前看到 tool-call，或需要特定的 finish-reason
5. **providerExecuted 属性影响** — 当前完全不设 providerExecuted，可能需要显式设 `providerExecuted: false`

### 调查建议

1. **查看 opencode 源码**中对 `tool-call`/`tool-input-start` 等 stream part 的处理逻辑
2. **对比其他 provider**（如 anthropic provider）的 tool-call stream part 发射方式
3. **在 doStream 中加日志**打印实际发射的 stream parts，与 opencode 期望对比
4. **检查 opencode 的 AI SDK 版本**是否需要特定的 LanguageModelV2StreamPart 格式

## What Didn't Work (失败的方案)

| 方案 | 失败原因 |
|------|----------|
| `providerExecuted: true` 发射所有工具 | opencode 的 `experimental_repairToolCall` 仍然对未知工具名报错 |
| SDK tool bridge (`tool()` + `createSdkMcpServer()`) | `query()` 生命周期不匹配，handler 无法跨 `doStream()` 边界等待 |
| 过滤 opencode 已管理的 MCP servers | CLI 需要自主使用 MCP 工具完成 agent loop，不能过滤 |
| `mcp__` 前缀特殊处理 | 增加了复杂度，normalizeToolName 统一处理更简洁 |

## 未提交的改动

### Modified files (已追踪)
- `index.ts` — config hook 新增 `convertOpencodeMcp()` + `setMcpBridgeServers()` 调用
- `src/qoder-language-model.ts` — normalizeToolName 增强、双轨 MCP、简化 tool 发射
- `tests/integration/real-api.test.ts` — context7 MCP 调试测试
- `tests/plugin.test.ts` — config.mcp 桥接测试
- `tests/qoder-language-model.test.ts` — 新增 ~450 行测试覆盖所有新功能

### Untracked files (新文件)
- `src/mcp-bridge.ts` — opencode config.mcp → Qoder SDK mcpServers 格式转换模块
- `tests/integration/debug-*.test.ts` — 4 个调试测试文件（均 skip）
- `bun.lock` — 包管理器锁文件

## 关键文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/qoder-language-model.ts` | **已修改** | 核心：normalizeToolName、双轨 MCP、简化 tool 发射 |
| `src/mcp-bridge.ts` | **新增** | opencode config.mcp → SDK mcpServers 转换 |
| `index.ts` | **已修改** | config hook 注入 MCP bridge + 格式转换 |
| `tests/qoder-language-model.test.ts` | **已修改** | 77 个测试全部通过 |
| `tests/plugin.test.ts` | **已修改** | MCP 桥接测试 |
| `src/vendor/qoder-agent-sdk.mjs` | 只读 | Vendored SDK — 不要修改 |
| `src/vendor/qoder-agent-sdk.d.ts` | 只读 | SDK 类型声明 — 不要修改 |

## 快速命令

```bash
npm test                                                    # 单元测试（77 通过）
opencode run --model qoder/lite "Reply with one word: PONG" # 基础验证
opencode run --model qoder/lite "List the .ts files..."     # 工具调用验证
```
