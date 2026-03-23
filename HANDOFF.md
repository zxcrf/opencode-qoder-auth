# HANDOFF

## 当前目标

让 `opencode-qoder-provider` 在 opencode 中通过 `qoder/lite`（及其他 Qoder 模型）正常工作，包括：

- 基础文本对话可用
- 认证路径兼容 `~/.qoderwork` 和 `~/.qoder`
- CLI 路径解析不依赖 `QoderWork.app`
- 在 opencode 中实现真实工具调用（CLI 内建工具），而非模型输出伪造的 `<tool_call>` XML 文本

## 当前状态：已修复 ✅

### 根因

`QoderAgentSDKClient` 初始化时设置了 `disallowedTools: ['*']`，在没有 MCP server 时（即正常使用场景）完全禁用了 Qoder CLI 的全部 15 个内建工具（Bash, Read, Write, Edit, Glob, Grep 等），导致模型只能输出纯文本。

### A/B 测试验证

| 条件 | `system.tools` | 模型行为 | `num_turns` |
|------|----------------|----------|-------------|
| 有 `disallowedTools: ['*']` | `undefined` | 输出伪代码块 / 说"没有工具" | 1 |
| 无 `disallowedTools` | `["AskUserQuestion","Bash","BashOutput","Edit","Glob","Grep",...]` | 真实 `tool_use` 调用 | 2+ |

### 修复方案

1. **移除 `disallowedTools: ['*']`** — 允许 CLI 内建工具被调用
2. **新增 `tool_use`/`tool_result` stream part 发射** — 通过 `providerExecuted: true` 告知 opencode 这些工具调用由 Qoder CLI 内部执行，opencode 不需要重复执行
3. **绕过 SDK MCP stub 问题** — 不依赖 SDK 的 in-process MCP bridge（该实现在 v0.0.44 中是空壳），直接使用 CLI 内建工具

## 已完成的改动

### `index.ts`

- auth 检测同时支持 `~/.qoderwork/.auth/user` 和 `~/.qoder/.auth/user`
- auth UI 文案更新

### `src/qoder-language-model.ts`（主要修复）

- **移除 `disallowedTools: ['*']`** — 核心修复
- **`tool_use` 处理**：`assistant` 消息中的 `tool_use` 块 → `tool-call` stream part（`providerExecuted: true`）
- **`tool_result` 处理**：`user` 消息中的 `tool_result` 块 → `tool-result` stream part（`providerExecuted: true`）
- **stream_event 工具支持**：`content_block_start/delta/stop` 对 `tool_use` 类型的增量流式支持
- **文本块边界管理**：`ensureTextStart()`/`ensureTextEnd()` + counter-based ID，工具调用前正确关闭文本块、之后重新开启
- **去重**：`emittedToolCalls` set 防止 stream_event 和 assistant 消息重复发射
- **tool name 映射**：`toolCallNames` map（tool_use_id → toolName）用于 `tool_result` 时查找工具名

### `tests/qoder-language-model.test.ts`

- 更新测试期望：无 `mcpServers` 时不再期望 `disallowedTools: ['*']`

## 测试现状

- **52 个单元测试通过**
- **1 个集成测试失败**（pre-existing）：`tests/integration/real-api.test.ts` 的 MCP in-process echo tool 用例，因 SDK v0.0.44 MCP stub 问题失败 —— 这是独立问题，不影响核心修复

## 端到端验证

```bash
opencode run --model qoder/lite "List the .ts files..."
```

结果：模型通过 CLI 内建工具真实执行文件列表，返回实际文件内容。

## 已知遗留问题

### SDK MCP in-process stub（不影响核心功能）

`src/vendor/qoder-agent-sdk.mjs` v0.0.44 中：

- `createSdkMcpServer()` 丢弃 tools 数组
- `handleSdkMcpRequest()` 的 `tools/list` 永远返回 `[]`
- `tools/call` 永远返回空内容

这意味着通过 `mcpServers` 传入的自定义 in-process 工具不会被注册。但当前修复通过使用 CLI 内建工具绕过了这个问题，实际使用不受影响。

## 关键文件

| 文件 | 说明 |
|------|------|
| `src/qoder-language-model.ts` | 主修复文件：流式处理 + 工具调用 |
| `index.ts` | 认证检测 |
| `src/vendor/qoder-agent-sdk.mjs` | Vendored SDK（未修改） |
| `tests/qoder-language-model.test.ts` | 单元测试 |
| `tests/integration/real-api.test.ts` | 集成测试（MCP 用例仍失败） |

## 快速命令

```bash
npm test                                                    # 单元测试
opencode run --model qoder/lite "Reply with one word: PONG" # 基础验证
opencode run --model qoder/lite "List the .ts files..."     # 工具调用验证
```
