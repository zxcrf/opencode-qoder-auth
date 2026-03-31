# opencode 与 Qoder 的工具调用职责边界设计

## 1. 结论

**核心冲突**：opencode 和 Qoder 都是 agent runtime，都想主控工具调用生命周期。

**设计原则**：
- **opencode 主控编排** — 工具调用决策权、执行权、权限控制归 opencode
- **Qoder 专注生成** — 模型层负责识别工具、输出结构化 tool-call
- **明确路由规则** — 哪些工具必须由 opencode 执行，哪些可交给 Qoder 内部处理

**不可妥协的边界**：
1. `task` / `question` / `subagent` 必须由 opencode 主控
2. 权限敏感工具（写文件、执行命令）必须由 opencode 审计
3. finishReason 必须由 opencode 框架决定（`tool-calls` vs `stop`）

---

## 2. 问题定义

### 2.1 现状

当前实现中，工具调用流程如下：

```
opencode → LanguageModelV2CallOptions.tools[] → QoderLanguageModel.doStream()
  → buildPromptFromOptions() → query({ prompt, options })
  → Qoder CLI 返回 tool_use
  → provider 判断 isProviderExecuted
  → 如果是 opencode 工具 → 发出 tool-call 给上层
  → 如果是 Qoder 内置工具 → provider 内部消费
```

**问题点**：
1. 工具路由规则不清晰（靠 `functionToolNames` 硬匹配）
2. `task` 等特殊工具需要外部完成，但 SDK 可能提前回放 `tool_result`
3. 多轮后工具上下文断裂（见 `docs/qoderwork-sdk-report.md`）

---

### 2.2 两类工具调用语义

| 语义 | opencode | Qoder CLI |
|------|----------|-----------|
| **触发** | 收到 `tool-call` → 执行工具 → 发 `tool-result` → 下一轮 | 收到 `tool_use` → 内部执行 → 回 `tool_result` → 继续推理 |
| **边界** | 一轮 = 一次 tool-call + 等待外部结果 | 一轮 = 可能多次 tool_use/tool_result 闭环 |
| **finishReason** | `tool-calls` 表示有待处理工具 | `tool_use` 只是中间状态 |

**冲突本质**：
- opencode 的 `tool-call` = "请框架执行，等我结果"
- Qoder 的 `tool_use` = "我要调用这个工具，稍后给你结果"

---

## 3. 工具分类与路由规则

### 3.1 工具分类

| 类别 | 工具示例 | 执行方 | 理由 |
|------|----------|--------|------|
| **框架核心工具** | `task`, `question`, `subagent` | opencode | 涉及子代理编排、用户交互，必须框架层管理 |
| **宿主能力工具** | `bash`, `read`, `write`, `glob`, `grep` | opencode | 依赖宿主进程能力，Qoder CLI 无法直接执行 |
| **MCP 工具** | `mcp__server__tool` | 双轨 | opencode 和 Qoder 各自连接 MCP servers |
| **Qoder 内置工具** | Qoder CLI 原生工具（如部分文件操作） | Qoder | 可由 CLI 高效处理，无需框架介入 |
| **Provider 自定义工具** | `provider-defined` 类型 | opencode | 由 opencode 注册并管理 |

---

### 3.2 路由决策流程

```
Qoder CLI 返回 tool_use
         │
         ▼
┌─────────────────────────────────────┐
│ 1. normalizeToolName() 归一化工具名  │
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│ 2. 检查是否在 functionToolNames 中   │
│    (opencode 注册的工具)             │
└───────────────┬─────────────────────┘
                │
        ┌───────┴───────┐
        │               │
        ▼               ▼
    是              否
        │               │
        │               ▼
        │    ┌─────────────────────────┐
        │    │ 3. 检查是否是 Qoder      │
        │    │    内置工具              │
        │    └───────────────┬─────────┘
        │                    │
        │            ┌───────┴───────┐
        │            │               │
        │            ▼               ▼
        │        是              否
        │            │               │
        │            │               │ (回退：交给 opencode)
        │            ▼               │
        │    Qoder 内部执行          │
        │            │               │
        │            ▼               │
        │    tool_result 直接消费    │
        │                            │
        ▼                            ▼
┌─────────────────────────────────────────────┐
│ 发出 tool-call 给 opencode                   │
│ finishReason = 'tool-calls'                 │
└─────────────────────────────────────────────┘
```

---

### 3.3 特殊工具处理：`task`

**问题**：`task` 触发子代理编排，Qoder SDK 可能在同一 query 中回放 `tool_result`，但这不代表子代理真的完成了。

**当前防御**：
```typescript
const waitForExternalCompletionToolNames = new Set(['task'])

// task 发出后立即抑制后续 assistant 内容
if (waitForExternalCompletionToolNames.has(toolBlock.name)) {
  suppressFurtherAssistantContent = true
}

// 即使收到 tool_result，也不清空 pending
if (!waitForExternalCompletionToolNames.has(toolCall.toolName)) {
  pendingToolCalls.delete(block.tool_use_id)
}
```

**设计原则**：
- `task` 的 `tool_result` 只表示 "Qoder 已提交任务"，不表示 "任务已完成"
- 必须等 opencode 侧子代理真正完成后，才能发起下一轮
- 当前轮的 `finishReason` 必须是 `tool-calls`，不能是 `stop`

---

## 4. 会话管理职责边界

### 4.1 现状问题

当前每轮 `doStream()` 都生成新 `sessionId`：

```typescript
// src/qoder-language-model.ts:354
sessionId: randomUUID()
```

**后果**：
- Qoder CLI 无法识别这是同一个会话的延续
- 工具调用链在 CLI 内部状态机中断裂
- 多轮后模型把历史当"参考资料"而非"真实会话状态"

---

### 4.2 会话管理职责划分

| 职责 | opencode | Qoder CLI |
|------|----------|-----------|
| **历史消息管理** | ✅ 维护 `messages[]` 数组 | ❌ 不存储历史 |
| **会话 ID 持久化** | ❌ 当前未实现 | ✅ CLI 内部基于 sessionId 管理状态 |
| **工具调用链** | ✅ 主控（执行权） | ✅ 辅助（结构化输出） |
| **resume/continue** | ❌ 当前未使用 | ✅ SDK 支持 |

---

### 4.3 改进方向：复用 sessionId

**最小修复**：
```typescript
// 在 QoderLanguageModel 实例级别维护 sessionId
class QoderLanguageModel {
  private sessionId: string | null = null

  private getSessionId(): string {
    if (!this.sessionId) {
      this.sessionId = randomUUID()
    }
    return this.sessionId
  }

  // buildQoderQueryOptions 中改用
  sessionId: this.getSessionId()
}
```

**配合措施**：
- 后续轮次设置 `continue: true`
- 多模态路径不再写 `session_id: ''`

---

## 5. 权限与审计职责边界

### 5.1 现状

当前 `buildQoderQueryOptions()` 设置：

```typescript
permissionMode: 'bypassPermissions',
allowDangerouslySkipPermissions: true,
```

**原因**：Qoder CLI 的权限提示无法在 opencode UI 中显示。

**风险**：绕过了权限控制。

---

### 5.2 改进方向

**方案 A：前置权限检查**
```typescript
// 在发出 tool-call 前，opencode 侧检查权限
if (!opencode.hasPermission(toolName)) {
  // 不发出 tool-call，直接拒绝
  return
}
```

**方案 B：Hook 拦截**
```typescript
// 在 tool-call 发出前触发 hook
await opencode.hooks.beforeToolUse(toolName, toolInput)
```

**职责划分**：
- Qoder：识别需要权限的工具
- opencode：执行权限检查（UI 提示、用户确认）

---

## 6. 错误处理职责边界

### 6.1 现状

当前错误处理：
```typescript
if (isError) {
  controller.enqueue({
    type: 'error',
    error: new Error(`Qoder SDK: ${errMsg}`),
  })
}
```

**问题**：Qoder SDK 的错误直接透传给 opencode，但 opencode 可能无法区分：
- 模型调用失败
- 工具执行失败
- 权限拒绝

---

### 6.2 改进方向

**错误分类**：
| 错误类型 | 来源 | 处理方 |
|----------|------|--------|
| `model_error` | Qoder SDK API 调用失败 | provider 直接上报 |
| `tool_execution_error` | 工具执行失败 | opencode 处理 |
| `permission_denied` | 权限拒绝 | opencode 处理 |
| `session_error` | 会话状态异常 | provider 尝试恢复 |

---

## 7. MCP 工具的双轨管理

### 7.1 现状

```typescript
// src/qoder-language-model.ts:329-337
const mcpServers = {
  ...extractMcpServersFromProviderOptions(defaultProviderOptions?.mcpServers),
  ...getMcpBridgeServers(),
  ...extractMcpServersFromProviderOptions(providerOptions?.mcpServers),
  ...extractMcpServersFromTools(options.tools),
}
```

**注释**：
> CLI 和 opencode 各自独立连接 MCP servers

---

### 7.2 职责划分

| 职责 | opencode | Qoder CLI |
|------|----------|-----------|
| **MCP 连接管理** | ✅ 独立连接 | ✅ 独立连接 |
| **工具注册** | ✅ 注册到 opencode | ✅ 注册到 CLI |
| **工具调用** | 由 opencode 执行的 MCP 工具 | 由 CLI 执行的 MCP 工具 |
| **路由决策** | ✅ `functionToolNames` 判断 | ❌ 被动响应 |

**设计原则**：
- 同一 MCP server 可以在两边都注册
- 工具名区分：`mcp__server__tool` (CLI) vs `server_tool` (opencode)
- 由 `normalizeToolName()` 统一处理

---

## 8. 实现清单

### 8.1 已完成

- [x] `normalizeToolName()` 归一化工具名
- [x] `functionToolNames` 判断是否由 opencode 执行
- [x] `waitForExternalCompletionToolNames` 处理 `task`
- [x] `suppressFurtherAssistantContent` 抑制多余输出

---

### 8.2 待实现（按优先级）

**优先级 1：会话修复**
- [ ] 实例级 `sessionId` 复用
- [ ] 后续轮次设置 `continue: true`
- [ ] 多模态路径修复 `session_id: ''`

**优先级 2：工具路由清晰化**
- [ ] 显式工具分类配置（框架核心/宿主能力/MCP/Qoder 内置）
- [ ] 工具路由决策日志
- [ ] `task` 工具的完整生命周期追踪

**优先级 3：权限集成**
- [ ] 前置权限检查 Hook
- [ ] 错误分类与透传规则

---

## 9. 一句话总结

**opencode 主控编排（工具执行权、权限、finishReason），Qoder 专注生成（结构化 tool-call 输出），会话状态由 Qoder CLI 内部管理但 sessionId 需跨轮复用。**

---

## 10. 参考资料

- `docs/qoderwork-sdk-report.md` — QoderWork 会话实现分析
- `docs/claude-code-router-reference.md` — CCR 项目借鉴报告
- `src/qoder-language-model.ts:522-853` — 工具调用处理核心逻辑
- `src/agent-bridge.ts` — Agent 类型映射
