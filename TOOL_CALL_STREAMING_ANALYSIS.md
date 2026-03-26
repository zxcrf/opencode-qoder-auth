# OpenCode Tool-Call Stream 处理与渲染分析

## 完整处理链概览

```
LanguageModelV2.doStream()
  ↓
provider.ts (Copilot SDK) 发射 V2 stream parts
  ├─ tool-input-start: 开始工具输入流
  ├─ tool-input-delta: 增量工具输入数据
  ├─ tool-input-end: 工具输入完成
  └─ tool-call: 完整工具调用
  ↓
processor.ts (SessionProcessor) 处理 stream parts
  ├─ 创建 ToolPart 存储到数据库
  ├─ 管理工具状态转换（pending → running → completed）
  └─ 更新数据库中的 part 记录
  ↓
Session.updatePart() / updatePartDelta()
  └─ 持久化到数据库
  ↓
UI 层订阅 part 更新事件
  └─ TUI: ToolPart() 渲染
  └─ Web UI: ToolPartDisplay() 渲染
```

---

## 1. 关键代码位置

### 1.1 核心处理文件

| 文件路径 | 作用 | 关键行号 |
|---------|------|---------|
| `/packages/opencode/src/session/processor.ts` | **Stream 处理核心** - 接收 V2 stream parts，转换为 ToolPart | 112-179 |
| `/packages/opencode/src/provider/sdk/copilot/responses/openai-responses-language-model.ts` | OpenAI Responses API 流生成 | 540-1171 |
| `/packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts` | OpenAI Compatible API 流生成 | 530-622 |
| `/packages/opencode/src/session/message-v2.ts` | ToolPart 类型定义 | 335-344 |
| `/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | TUI 渲染器 | 1491-1579 |
| `/packages/ui/src/components/message-part.tsx` | Web UI 渲染器 | 1209-1287 |

---

## 2. Tool-Call Stream Part 格式规范

### 2.1 Stream Parts 的完整生命周期

#### **Phase 1: tool-input-start**
```typescript
{
  type: "tool-input-start",
  id: string,              // 工具调用 ID (unique per tool call)
  toolName: string,        // 工具名称 (e.g., "bash", "read", "grep")
  // 可选:
  providerMetadata?: Record<string, any>  // 提供商元数据
}
```

**处理**: 在 processor.ts 创建待处理的 ToolPart
```typescript
// processor.ts: 112-126
case "tool-input-start":
  const part = await Session.updatePart({
    id: toolcalls[value.id]?.id ?? PartID.ascending(),
    messageID: input.assistantMessage.id,
    sessionID: input.assistantMessage.sessionID,
    type: "tool",
    tool: value.toolName,
    callID: value.id,
    state: {
      status: "pending",
      input: {},
      raw: "",
    },
  })
  toolcalls[value.id] = part as MessageV2.ToolPart
  break
```

#### **Phase 2: tool-input-delta (可选)**
```typescript
{
  type: "tool-input-delta",
  id: string,              // 对应 tool-input-start 的 ID
  delta: string,           // JSON 格式的输入增量
  providerMetadata?: Record<string, any>
}
```

**处理**: processor.ts 第 129-131 行目前是空 break（未使用）
```typescript
case "tool-input-delta":
  break
```

**说明**: 当前 OpenCode 不处理增量数据，而是等待完整的 `tool-call` part。这是因为：
- `tool-input-delta` 只是中间状态
- 最终的 `tool-call` part 包含完整的已解析 `input` 对象
- 减少数据库操作

#### **Phase 3: tool-input-end (可选)**
```typescript
{
  type: "tool-input-end",
  id: string,              // 对应 tool-input-start 的 ID
  providerMetadata?: Record<string, any>
}
```

**处理**: processor.ts 第 132-134 行也是空 break
```typescript
case "tool-input-end":
  break
```

#### **Phase 4: tool-call (必需)**
```typescript
{
  type: "tool-call",
  toolCallId: string,      // 对应 tool-input-start 的 ID
  toolName: string,        // 工具名称
  input: string | Record<string, any>,  // JSON 字符串或已解析对象
  providerMetadata?: Record<string, any>,
  providerExecuted?: boolean  // 关键标记！见下文
}
```

**处理**: processor.ts 第 135-180 行
```typescript
case "tool-call": {
  const match = toolcalls[value.toolCallId]
  if (match) {
    const part = await Session.updatePart({
      ...match,
      tool: value.toolName,
      state: {
        status: "running",      // 状态转为 running
        input: value.input,     // 设置完整输入
        time: {
          start: Date.now(),
        },
      },
      metadata: value.providerMetadata,
    })
    toolcalls[value.toolCallId] = part as MessageV2.ToolPart
    
    // 检测 doom loop (相同工具连续调用)
    // ...
  }
  break
}
```

### 2.2 ToolPart 在数据库中的完整结构

```typescript
// packages/opencode/src/session/message-v2.ts: 335-344
export const ToolPart = PartBase.extend({
  type: z.literal("tool"),
  callID: z.string(),        // 工具调用 ID
  tool: z.string(),          // 工具名称
  state: ToolState,          // 见下文
  metadata: z.record(z.string(), z.any()).optional(),  // 提供商元数据
}).meta({ ref: "ToolPart" })

export type ToolPart = z.infer<typeof ToolPart>
```

#### 状态机: ToolState

```typescript
// 待执行
ToolStatePending = {
  status: "pending",
  input: {},
  raw: ""
}

// 运行中
ToolStateRunning = {
  status: "running",
  input: Record<string, any>,
  time: { start: number }
}

// 已完成
ToolStateCompleted = {
  status: "completed",
  input: Record<string, any>,
  output: string,
  metadata?: any,
  title?: string,
  time: { start: number, end: number },
  attachments?: any[]
}

// 错误
ToolStateError = {
  status: "error",
  input: Record<string, any>,
  error: string,
  time: { start: number, end: number }
}
```

---

## 3. providerExecuted 标记的特殊处理

### 3.1 定义与作用

**providerExecuted: boolean** - 标记工具是否由**提供商自动执行**

### 3.2 使用场景

| 工具 | providerExecuted | 说明 |
|-----|------------------|------|
| `image_generation` | `true` | OpenAI 内置图像生成 |
| `file_search` | `true` | OpenAI 内置文件搜索 |
| `code_interpreter` | `false` | 需要 OpenCode 执行 |
| `web_search` | `true` (可选) | OpenAI 内置网页搜索 |
| 自定义工具 (bash, read等) | `undefined` | OpenCode 执行 |

### 3.3 代码位置

**发射 providerExecuted**:
- `/packages/opencode/src/provider/sdk/copilot/responses/openai-responses-language-model.ts`:
  - 行 547: `image_generation_call` → `providerExecuted: true`
  - 行 557: `file_search_call` → `providerExecuted: true`
  - 行 919-927: 流模式下也标记

**处理 providerExecuted**:
- `/packages/opencode/src/provider/sdk/copilot/responses/convert-to-openai-responses-input.ts`: 行 136
  ```typescript
  case "tool-call": {
    toolCallParts[part.toolCallId] = part
    
    if (part.providerExecuted) {
      break  // 跳过 - 提供商已执行
    }
    
    // 继续处理需要 OpenCode 执行的工具
    input.push({
      type: "function_call",
      call_id: part.toolCallId,
      name: part.toolName,
      arguments: JSON.stringify(part.input),
      id: (part.providerOptions?.openai?.itemId as string) ?? undefined,
    })
    break
  }
  ```

### 3.4 UI 显示影响

**providerExecuted 工具**:
- ✓ 显示为已完成（UI 中不显示"运行中"）
- ✓ 结果直接来自提供商
- ✓ OpenCode 不额外执行

**非 providerExecuted 工具**:
- 等待 OpenCode 执行
- 显示实时执行状态
- 可被权限系统拦截（doom_loop 检测等）

---

## 4. Processor.ts 中的完整处理链

### 4.1 关键数据结构

```typescript
// processor.ts: 33
const toolcalls: Record<string, MessageV2.ToolPart> = {}
// 记录所有进行中的工具调用，键为 toolCallId
```

### 4.2 Tool-Call 到 Tool-Result 的状态转换

```
tool-input-start
    ↓
    [创建 ToolPart, status="pending"]
    ↓
tool-call
    ↓
    [更新 ToolPart, status="running", input=已解析]
    ↓
[OpenCode 执行工具]
    ↓
tool-result (或 tool-error)
    ↓
    [更新 ToolPart, status="completed" (或 "error"), output=结果]
    ↓
    [从 toolcalls 字典删除]
```

### 4.3 完整处理代码

```typescript
// processor.ts: 112-230
case "tool-input-start":
  // 创建待执行工具
  const part = await Session.updatePart({
    id: toolcalls[value.id]?.id ?? PartID.ascending(),
    messageID: input.assistantMessage.id,
    sessionID: input.assistantMessage.sessionID,
    type: "tool",
    tool: value.toolName,
    callID: value.id,
    state: {
      status: "pending",
      input: {},
      raw: "",
    },
  })
  toolcalls[value.id] = part as MessageV2.ToolPart
  break

case "tool-input-delta":
  // 当前未使用
  break

case "tool-input-end":
  // 当前未使用
  break

case "tool-call":
  // 设置为运行状态
  const match = toolcalls[value.toolCallId]
  if (match) {
    const part = await Session.updatePart({
      ...match,
      tool: value.toolName,
      state: {
        status: "running",
        input: value.input,    // 完整已解析输入
        time: { start: Date.now() },
      },
      metadata: value.providerMetadata,
    })
    toolcalls[value.toolCallId] = part as MessageV2.ToolPart
    
    // Doom loop 检测 (相同工具连续3次调用相同输入)
    const parts = await MessageV2.parts(input.assistantMessage.id)
    const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)
    
    if (
      lastThree.length === DOOM_LOOP_THRESHOLD &&
      lastThree.every(p =>
        p.type === "tool" &&
        p.tool === value.toolName &&
        p.state.status !== "pending" &&
        JSON.stringify(p.state.input) === JSON.stringify(value.input),
      )
    ) {
      // 触发权限请求
      await Permission.ask({...})
    }
  }
  break

case "tool-result":
  // 工具执行完成
  const match = toolcalls[value.toolCallId]
  if (match && match.state.status === "running") {
    await Session.updatePart({
      ...match,
      state: {
        status: "completed",
        input: value.input ?? match.state.input,
        output: value.output.output,
        metadata: value.output.metadata,
        title: value.output.title,
        time: {
          start: match.state.time.start,
          end: Date.now(),
        },
        attachments: value.output.attachments,
      },
    })
    
    delete toolcalls[value.toolCallId]  // 清理状态
  }
  break

case "tool-error":
  // 工具执行失败
  const match = toolcalls[value.toolCallId]
  if (match && match.state.status === "running") {
    await Session.updatePart({
      ...match,
      state: {
        status: "error",
        input: value.input ?? match.state.input,
        error: value.error instanceof Error 
          ? value.error.message 
          : String(value.error),
        time: {
          start: match.state.time.start,
          end: Date.now(),
        },
      },
    })
    
    delete toolcalls[value.toolCallId]
  }
  break
```

---

## 5. TUI 渲染器 (ToolPart Component)

### 5.1 位置
`/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`: 1491-1579

### 5.2 期望的 ToolPart 数据结构

```typescript
type ToolPart = {
  id: string                    // 唯一标识
  messageID: string             // 所属消息 ID
  sessionID: string             // 所属会话 ID
  type: "tool"
  callID: string                // 工具调用 ID (与 stream part 的 id 对应)
  tool: string                  // 工具名称："bash", "read", "grep", etc.
  state: {
    status: "pending" | "running" | "completed" | "error"
    input: Record<string, any>  // 工具输入参数
    output?: string             // 工具输出 (只在 completed 时有)
    error?: string              // 错误信息 (只在 error 时有)
    metadata?: Record<string, any>  // 提供商元数据
    title?: string              // 输出标题
    time?: {
      start: number
      end?: number
    }
    attachments?: any[]
  }
  metadata?: Record<string, any>  // 顶级元数据
}
```

### 5.3 渲染逻辑

```typescript
function ToolPart(props: { 
  last: boolean
  part: ToolPart
  message: AssistantMessage 
}) {
  // 1. 根据工具名称 switch 分发到对应渲染器
  return (
    <Show when={!shouldHide()}>
      <Switch>
        <Match when={props.part.tool === "bash"}>
          <Bash {...toolprops} />
        </Match>
        <Match when={props.part.tool === "read"}>
          <Read {...toolprops} />
        </Match>
        <Match when={props.part.tool === "edit"}>
          <Edit {...toolprops} />
        </Match>
        {/* ... 更多工具 ... */}
        <Match when={true}>
          <GenericTool {...toolprops} />
        </Match>
      </Switch>
    </Show>
  )
}

// ToolProps 接口
type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>        // 工具输入
  metadata: Partial<Tool.InferMetadata<T>>       // 元数据
  permission: Record<string, any>                 // 权限记录
  tool: string                                   // 工具名称
  output?: string                                 // 输出结果
  part: ToolPart                                 // 完整 part 数据
}
```

### 5.4 隐藏条件

```typescript
const shouldHide = createMemo(() => {
  if (ctx.showDetails()) return false           // 显示详情模式时显示
  if (props.part.state.status !== "completed") return false  // 运行中不隐藏
  return true                                   // 已完成且非详情模式时隐藏
})
```

---

## 6. Web UI 渲染器 (ToolPartDisplay)

### 6.1 位置
`/packages/ui/src/components/message-part.tsx`: 1209-1287

### 6.2 渲染流程

```typescript
PART_MAPPING["tool"] = function ToolPartDisplay(props) {
  const part = () => props.part as ToolPart
  
  // 特殊处理
  if (part().tool === "todowrite" || part().tool === "todoread") return null
  
  const hideQuestion = createMemo(
    () => part().tool === "question" && 
           (part().state.status === "pending" || part().state.status === "running"),
  )
  
  // 提取数据
  const input = () => part().state?.input ?? {}
  const partMetadata = () => part().state?.metadata ?? {}
  
  // 获取对应的渲染器
  const render = createMemo(() => ToolRegistry.render(part().tool) ?? GenericTool)
  
  return (
    <Show when={!hideQuestion()}>
      <div data-component="tool-part-wrapper">
        <Switch>
          {/* 错误状态 */}
          <Match when={part().state.status === "error" && (part().state as any).error}>
            {(error) => <ToolErrorCard tool={part().tool} error={error()} ... />}
          </Match>
          
          {/* 正常状态 */}
          <Match when={true}>
            <Dynamic
              component={render()}
              input={input()}
              tool={part().tool}
              metadata={partMetadata()}
              output={part().state.output}
              status={part().state.status}
              hideDetails={props.hideDetails}
              defaultOpen={props.defaultOpen}
            />
          </Match>
        </Switch>
      </div>
    </Show>
  )
}
```

### 6.3 传递给渲染器的 Props

| 属性 | 类型 | 说明 |
|-----|------|------|
| `input` | `Record<string, any>` | 工具输入参数 |
| `tool` | `string` | 工具名称 |
| `metadata` | `Record<string, any>` | 提供商元数据 |
| `output` | `string \| undefined` | 输出结果（仅 completed） |
| `status` | `"pending" \| "running" \| "completed" \| "error"` | 状态 |
| `hideDetails` | `boolean` | 是否隐藏详情 |
| `defaultOpen` | `boolean` | 默认展开 |

---

## 7. 不同 Provider 的 Tool-Call 格式对比

### 7.1 OpenAI Responses API
**文件**: `/packages/opencode/src/provider/sdk/copilot/responses/openai-responses-language-model.ts`

**发射格式**:
```typescript
// 非流式 (行 543)
{
  type: "tool-call",
  toolCallId: part.id,
  toolName: "image_generation",
  input: "{}",
  providerExecuted: true,
}

// 流式 (行 867-927)
controller.enqueue({
  type: "tool-input-start",
  id: value.item.call_id,
  toolName: value.item.name,
})

// ... deltas ...

controller.enqueue({
  type: "tool-call",
  toolCallId: value.item.call_id ?? generateId(),
  toolName: value.item.name,
  input: toolCall.function.arguments,
  providerMetadata: { ... },
})
```

**特殊工具处理**:
- `image_generation_call` → `providerExecuted: true`
- `file_search_call` → `providerExecuted: true`
- `local_shell_call` → 特殊 schema 处理
- `code_interpreter_call` → 带 containerId
- `function_call` → 标准工具调用

### 7.2 OpenAI Compatible Chat API
**文件**: `/packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts`

**发射格式** (行 530-622):
```typescript
// 初始化
controller.enqueue({
  type: "tool-input-start",
  id: toolCallDelta.id,
  toolName: toolCallDelta.function.name,
})

// 增量
controller.enqueue({
  type: "tool-input-delta",
  id: toolCall.id,
  delta: toolCall.function.arguments,
})

// 完成
controller.enqueue({
  type: "tool-input-end",
  id: toolCall.id,
})

controller.enqueue({
  type: "tool-call",
  toolCallId: toolCall.id ?? generateId(),
  toolName: toolCall.function.name,
  input: toolCall.function.arguments,
  providerMetadata: reasoningOpaque ? { copilot: { reasoningOpaque } } : undefined,
})
```

### 7.3 Claude / Anthropic (Transform 层)
**文件**: `/packages/opencode/src/provider/transform.ts` (行 74-88)

**处理差异**:
```typescript
// Claude 要求 toolCallId 只包含字母数字和下划线
if (model.api.id.includes("claude")) {
  return msgs.map((msg) => {
    if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
      msg.content = msg.content.map((part) => {
        if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
          return {
            ...part,
            toolCallId: part.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_"),
          }
        }
        return part
      })
    }
    return msg
  })
}
```

### 7.4 Mistral
**文件**: `/packages/opencode/src/provider/transform.ts` (行 90-134)

**处理差异**:
```typescript
// Mistral 要求 toolCallId 为 9 个字母数字字符
if (model.providerID === "mistral" || ...) {
  // ... 规范化 toolCallId ...
  const normalizedId = part.toolCallId
    .replace(/[^a-zA-Z0-9]/g, "")     // 移除非字母数字
    .substring(0, 9)                   // 取前 9 个字符
    .padEnd(9, "0")                    // 补零到 9 位
}
```

**格式总结**:
| Provider | toolCallId 格式 | 特殊处理 |
|----------|-----------------|---------|
| OpenAI | UUID/字符串 | `providerExecuted` 标记 |
| Anthropic/Claude | `[a-zA-Z0-9_-]` | 字符替换规范化 |
| Mistral | 恰好 9 个 `[a-zA-Z0-9]` | 子字符串 + 补零 |
| OpenRouter | 继承基础 provider | 缓存控制 |

---

## 8. Tool-Call 从发射到 UI 的完整数据流

### 8.1 完整流程图

```
1. Provider (e.g., OpenAI) 生成 stream
   ├─ SSE chunk: {"tool_calls": [{"id": "call_abc", "name": "bash", ...}]}
   ├─ streaming: true
   └─ finish_reason: "tool_calls"

2. Language Model (openai-responses-language-model.ts)
   ├─ 解析 SSE chunks
   ├─ 发射 tool-input-start
   ├─ 发射 tool-input-delta (可选)
   ├─ 发射 tool-input-end (可选)
   └─ 发射 tool-call

3. LLM.stream() (llm.ts)
   └─ 使用 AI SDK 的 streamText() 包装 language model
   └─ 返回 ReadableStream<V2StreamPart>

4. SessionProcessor.process() (processor.ts)
   ├─ tool-input-start → 创建 ToolPart (status: pending)
   ├─ tool-input-delta → (忽略)
   ├─ tool-input-end → (忽略)
   ├─ tool-call → 更新 ToolPart (status: running)
   ├─ Session.updatePart() → 写入数据库
   └─ Session.updatePartDelta() → 写入增量

5. 数据库更新事件
   └─ EventMessagePartUpdated 发布到 bus

6. 前端订阅
   ├─ TUI: ToolPart() 组件监听 message.parts
   ├─ Web: ToolPartDisplay() 订阅 message 数据
   └─ 实时 UI 更新

7. 工具执行 (后续)
   ├─ OpenCode 执行工具
   └─ 发射 tool-result → 更新 ToolPart (status: completed)
```

### 8.2 数据转换示例

```typescript
// 1. 来自 OpenAI 的 stream part
{
  type: "tool-call",
  toolCallId: "call_abc123",
  toolName: "bash",
  input: '{"command":"ls -la"}',
  providerMetadata: { openai: { itemId: "something" } }
}

// 2. 转换为 MessageV2.ToolPart (存储到数据库)
{
  type: "tool",
  id: "part_xyz789",          // 生成的唯一 ID
  messageID: "msg_123",
  sessionID: "sess_456",
  callID: "call_abc123",       // 保留原始 toolCallId
  tool: "bash",
  state: {
    status: "running",
    input: { command: "ls -la" },  // JSON 已解析
    time: { start: 1234567890 }
  },
  metadata: { openai: { itemId: "something" } }
}

// 3. TUI 接收的 props
{
  part: { /* 上面的 ToolPart */ },
  input: { command: "ls -la" },
  output: undefined,           // 执行后填充
  metadata: { openai: { itemId: "..." } },
  tool: "bash",
  status: "running",
  permission: { /* ... */ }
}

// 4. 工具执行完成后
{
  state: {
    status: "completed",
    input: { command: "ls -la" },
    output: "total 100\ndrwxr-xr-x ...",
    time: { 
      start: 1234567890,
      end: 1234567895
    }
  }
}
```

---

## 9. 关键 finishReason 处理

### 9.1 位置

| 文件 | 行号 | 说明 |
|-----|------|------|
| `/packages/opencode/src/provider/sdk/copilot/responses/map-openai-responses-finish-reason.ts` | 14, 20 | 基于函数调用状态返回 `tool-calls` |
| `/packages/opencode/src/provider/sdk/copilot/chat/map-openai-compatible-finish-reason.ts` | 13 | 同上 |
| `/packages/opencode/src/session/prompt.ts` | 324, 468, 699-700 | 条件检查 `!["tool-calls", "unknown"].includes(finish)` |
| `/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | 1334 | UI 检查消息是否完成 |

### 9.2 "tool-calls" 的含义

```typescript
// 当模型返回工具调用时，finishReason = "tool-calls"
finish: "tool-calls"

// 条件检查
if (processor.message.finish && !["tool-calls", "unknown"].includes(processor.message.finish)) {
  // 模型已完成（非工具调用也非未知状态）
}
```

**逻辑**:
- `finish === "stop"` → 模型完成，可结束
- `finish === "tool-calls"` → 模型要求执行工具，继续循环
- `finish === "unknown"` → 未确定，继续处理
- 其他 → 结束

---

## 10. Qoder Provider 适配建议

### 10.1 必需的 Stream Parts

```typescript
// Qoder 必须发射这些 stream parts:

// 1. 工具调用开始
{
  type: "tool-input-start",
  id: string,              // 工具调用 ID
  toolName: string,        // 工具名称
}

// 2. 工具调用完整
{
  type: "tool-call",
  toolCallId: string,      // 同上的 ID
  toolName: string,        // 工具名称
  input: Record<string, any> | string,  // 已解析或 JSON 字符串
}

// 3. 完成信号
{
  type: "finish",
  finishReason: "tool-calls" | "stop" | "unknown",
  usage: {
    inputTokens: number,
    outputTokens: number,
  }
}
```

### 10.2 可选但推荐的 Stream Parts

```typescript
// 1. 增量工具输入 (提高 UX)
{
  type: "tool-input-delta",
  id: string,
  delta: string,  // JSON 增量
}

// 2. 工具输入结束
{
  type: "tool-input-end",
  id: string,
}
```

### 10.3 核心转换点

**在 qoder-language-model.ts 中**:

```typescript
// 确保 input 在 tool-call 时是已解析的对象
{
  type: "tool-call",
  toolCallId: "call_123",
  toolName: "bash",
  input: { command: "ls" },  // ✓ 对象形式
  // input: '{"command":"ls"}' // ✗ JSON 字符串
}

// Processor 期望:
// processor.ts line 143
state: {
  status: "running",
  input: value.input,  // 直接使用，不再解析
}
```

### 10.4 处理 providerExecuted 工具

如果 Qoder 有内置工具执行能力（如调试工具、系统工具等），标记为：

```typescript
{
  type: "tool-call",
  toolCallId: "call_internal",
  toolName: "internal_tool",
  input: {...},
  providerExecuted: true,  // 标记为内置工具
}
```

### 10.5 错误处理

实现 `tool-error` 流部分：

```typescript
{
  type: "tool-error",
  toolCallId: string,
  input?: Record<string, any>,
  error: Error | string,
}
```

---

## 11. 测试参考

### 11.1 测试文件

- `/packages/opencode/test/provider/copilot/copilot-chat-model.test.ts` (行 170-209)
  - 测试工具调用流的完整周期
  - 验证 `tool-input-start` 和 `tool-call` 的先后顺序

- `/packages/opencode/test/session/message-v2.test.ts` (行 270+)
  - 测试消息转换和工具部分处理

### 11.2 核心测试断言

```typescript
// 验证 tool-call stream parts 的顺序
expect(toolParts).toContainEqual({
  type: "tool-input-start",
  id: "call_abc123",
  toolName: "read_file",
})

expect(toolParts).toContainEqual(
  expect.objectContaining({
    type: "tool-call",
    toolCallId: "call_abc123",
    toolName: "read_file",
  }),
)

// 验证 finish reason
expect(finish).toMatchObject({
  type: "finish",
  finishReason: "tool-calls",
})
```

---

## 总结表

| 方面 | 关键信息 |
|-----|---------|
| **发射点** | LanguageModelV2.doStream() |
| **处理点** | SessionProcessor.process() 中的 switch 语句 |
| **存储格式** | MessageV2.ToolPart (type: "tool") |
| **UI 显示** | TUI: ToolPart(), Web: ToolPartDisplay() |
| **关键标记** | `providerExecuted` (true = 提供商执行，undefined = 需 OpenCode 执行) |
| **状态转换** | pending → running → completed (或 error) |
| **finishReason** | 当有工具调用时设为 "tool-calls" |
| **ID 规范化** | Claude: `[a-zA-Z0-9_-]`, Mistral: 9 个字母数字 |
| **数据库字段** | callID (保存原始 toolCallId), tool (工具名), state (状态对象) |

