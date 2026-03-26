# OpenCode Tool-Call Stream 处理 - 快速参考

## 🎯 核心要点

### 1️⃣ Stream Part 类型序列

```
tool-input-start  → 创建 ToolPart (status: pending)
    ↓
tool-input-delta  → [可选，当前 OpenCode 忽略]
    ↓
tool-input-end    → [可选，当前 OpenCode 忽略]
    ↓
tool-call         → 更新 ToolPart (status: running)
    ↓
[OpenCode 执行工具]
    ↓
tool-result       → 更新 ToolPart (status: completed)
  或 tool-error   → 更新 ToolPart (status: error)
```

### 2️⃣ 关键属性

| 属性 | 说明 | 位置 |
|-----|------|------|
| **toolCallId** | 工具调用唯一 ID | `tool-call` part |
| **toolName** | 工具名称（bash, read, grep 等） | `tool-input-start`, `tool-call` |
| **input** | 工具参数（JSON 对象或字符串） | `tool-call` part |
| **providerExecuted** | true = 提供商已执行；undefined = 需 OpenCode 执行 | `tool-call` part |
| **finishReason** | 当有工具调用时为 "tool-calls" | finish part |

### 3️⃣ 数据库中的 ToolPart 结构

```typescript
{
  type: "tool",                    // 固定值
  callID: "call_abc123",           // 来自 tool-input-start 的 id
  tool: "bash",                    // 工具名称
  state: {
    status: "pending|running|completed|error",
    input: { command: "ls" },      // 已解析的对象
    output?: "...",                // 只在 completed
    error?: "...",                 // 只在 error
    time: { start: number, end?: number }
  }
}
```

### 4️⃣ providerExecuted 的含义

```typescript
// ✓ 提供商已执行
{
  type: "tool-call",
  toolCallId: "...",
  toolName: "image_generation",  // OpenAI 内置
  input: "{}",
  providerExecuted: true,         // OpenCode 不再执行
}

// ✗ 需要 OpenCode 执行
{
  type: "tool-call",
  toolCallId: "...",
  toolName: "bash",               // 自定义工具
  input: { command: "ls" },
  // providerExecuted 不设置或为 undefined
}
```

---

## 🔧 Qoder Provider 实现清单

### ✅ 必需的 Stream Parts

- [ ] **tool-input-start**: 包含 `id` 和 `toolName`
- [ ] **tool-call**: 包含完整的 `toolCallId`, `toolName`, `input` (已解析对象)
- [ ] **finish**: 包含 `finishReason: "tool-calls"` (当有工具调用时)

### ✅ 推荐的 Stream Parts

- [ ] **tool-input-delta**: 增量工具输入 (仅用于 UI 流显示)
- [ ] **tool-input-end**: 标记输入完成
- [ ] **tool-result**: 工具执行结果 (status: completed)
- [ ] **tool-error**: 工具执行错误 (status: error)

### ✅ 关键细节

- [ ] `input` 必须是已解析的对象，不是 JSON 字符串
- [ ] `toolCallId` 需要符合 provider 要求（Claude: `[a-zA-Z0-9_-]`, Mistral: 9 位数字字母）
- [ ] `finishReason` 为 `"tool-calls"` 时 OpenCode 会继续执行工具
- [ ] 如果工具由 Qoder 执行，设置 `providerExecuted: true`

---

## 📍 文件快速查找

| 需求 | 文件 | 行号 |
|-----|------|------|
| Stream parts 处理 | `processor.ts` | 112-230 |
| Tool-call 定义 | `message-v2.ts` | 335-344 |
| OpenAI 实现参考 | `openai-responses-language-model.ts` | 540-1171 |
| TUI 渲染 | `tui/routes/session/index.tsx` | 1491-1579 |
| Web UI 渲染 | `ui/components/message-part.tsx` | 1209-1287 |
| providerExecuted 处理 | `convert-to-openai-responses-input.ts` | 136 |

---

## 🧪 测试示例

```typescript
// 来自 Qoder SDK 的 stream parts
[
  {
    type: "tool-input-start",
    id: "call_001",
    toolName: "bash",
  },
  {
    type: "tool-call",
    toolCallId: "call_001",
    toolName: "bash",
    input: { command: "ls -la" },  // ✓ 对象形式
  },
  {
    type: "finish",
    finishReason: "tool-calls",
    usage: { inputTokens: 100, outputTokens: 50 },
  },
]
```

---

## ❌ 常见错误

| 错误 | 原因 | 修复 |
|-----|------|------|
| UI 不显示工具调用 | `tool-input-start` 未发射 | 确保流开始时发射此事件 |
| 工具输入显示错误 | `input` 是字符串而非对象 | 在 stream part 中解析 JSON |
| OpenCode 无法执行工具 | `providerExecuted: true` 被错误设置 | 仅在提供商自己执行时设置 |
| 消息卡住（状态为 running） | 未发射 `tool-result` 或 `tool-error` | 工具执行完成后必须发射结果 |
| TUI 无法访问工具名 | `toolName` 不一致 | 确保 `tool-input-start` 和 `tool-call` 中相同 |

---

## 📊 状态转换完整流程

```
创建 (tool-input-start)
    ↓
    pending: { input: {}, status: "pending" }
    ↓
运行 (tool-call)
    ↓
    running: { input: {...}, status: "running", time.start: X }
    ↓
[执行工具]
    ↓
完成 (tool-result)
    ↓
    completed: {
      input: {...},
      output: "...",
      status: "completed",
      time: { start: X, end: Y }
    }
```

---

## 📝 UI 组件期望的数据

### TUI (ToolPart 组件)
```typescript
{
  part: ToolPart,
  input: Record<string, any>,      // 工具输入
  output?: string,                  // 工具输出
  metadata: Record<string, any>,    // 提供商元数据
  tool: string,                     // 工具名称
  permission: any,                  // 权限记录
  part: ToolPart,                   // 完整 part
}
```

### Web UI (ToolPartDisplay 组件)
```typescript
{
  input: Record<string, any>,       // 同上
  tool: string,
  metadata: Record<string, any>,
  output?: string,
  status: "pending" | "running" | "completed" | "error",
  hideDetails?: boolean,
  defaultOpen?: boolean,
}
```

---

🎉 关键信息已归档到 `TOOL_CALL_STREAMING_ANALYSIS.md` 中的详细文档。
