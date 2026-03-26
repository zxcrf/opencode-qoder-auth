# Qoder Provider Tool-Call 实现指南

## 第一步：理解 Stream 生命周期

### 来自 Qoder 的 Stream

```
Qoder API 返回流 (SSE)
    ↓
parseable chunks，包含：
  1. 工具调用信息
  2. 参数增量（可选）
  3. 完整工具定义
```

### 转换为 OpenCode Stream Parts

```typescript
// src/qoder-language-model.ts - 中需要做的转换

import { ReadableStream } from "stream/web"

export class QoderLanguageModelV2 {
  async doStream(options: LanguageModelV2CallOptions) {
    return {
      stream: new ReadableStream({
        async start(controller) {
          const stream = await qoderSDK.query(...)
          
          for await (const chunk of stream) {
            // 1. 工具调用开始
            if (chunk.type === 'tool_call_start') {
              controller.enqueue({
                type: "tool-input-start",
                id: chunk.call_id,
                toolName: chunk.tool_name,
              })
            }
            
            // 2. 工具参数增量（可选）
            if (chunk.type === 'tool_call_params_delta') {
              controller.enqueue({
                type: "tool-input-delta",
                id: chunk.call_id,
                delta: chunk.params_delta,
              })
            }
            
            // 3. 工具调用完整
            if (chunk.type === 'tool_call_complete') {
              controller.enqueue({
                type: "tool-call",
                toolCallId: chunk.call_id,
                toolName: chunk.tool_name,
                input: chunk.params,  // ✓ 已解析对象
              })
            }
            
            // 4. 文本输出
            if (chunk.type === 'text_delta') {
              controller.enqueue({
                type: "text-delta",
                delta: chunk.text,
              })
            }
            
            // 5. 流完成
            if (chunk.type === 'done') {
              controller.enqueue({
                type: "finish",
                finishReason: chunk.has_tool_calls ? "tool-calls" : "stop",
                usage: {
                  inputTokens: chunk.input_tokens,
                  outputTokens: chunk.output_tokens,
                }
              })
            }
          }
        }
      }),
      ...
    }
  }
}
```

---

## 第二步：消息转换（可选）

如果 Qoder 有特殊的消息格式要求（如 Claude/Anthropic），需要在 transform.ts 中处理：

```typescript
// src/provider/transform.ts

if (model.api.id.includes("qoder")) {
  return msgs.map((msg) => {
    if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
      msg.content = msg.content.map((part) => {
        if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
          // 如果 Qoder 有 ID 格式要求，在这里规范化
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

---

## 第三步：测试验证

### 单元测试模板

```typescript
// test/qoder-language-model.test.ts

import { QoderLanguageModelV2 } from "../src/qoder-language-model"

describe("QoderLanguageModelV2", () => {
  test("should emit tool-input-start, tool-call, and finish parts", async () => {
    const model = new QoderLanguageModelV2({
      modelId: "qoder-test",
      client: mockQoderClient,
    })
    
    const { stream } = await model.doStream({
      prompt: [{ type: "text", text: "Execute bash command" }],
      tools: [
        {
          type: "function",
          function: {
            name: "bash",
            description: "Execute bash commands",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" }
              }
            }
          }
        }
      ]
    })
    
    const parts = await convertReadableStreamToArray(stream)
    
    // 1. 验证 tool-input-start 存在
    const toolStart = parts.find(p => p.type === "tool-input-start")
    expect(toolStart).toMatchObject({
      type: "tool-input-start",
      id: "call_001",
      toolName: "bash",
    })
    
    // 2. 验证 tool-call 存在
    const toolCall = parts.find(p => p.type === "tool-call")
    expect(toolCall).toMatchObject({
      type: "tool-call",
      toolCallId: "call_001",
      toolName: "bash",
      input: { command: "ls -la" },  // ✓ 对象形式
    })
    
    // 3. 验证 finish 有正确的 finishReason
    const finish = parts.find(p => p.type === "finish")
    expect(finish).toMatchObject({
      type: "finish",
      finishReason: "tool-calls",
    })
  })
  
  test("should convert tool input deltas to stream parts", async () => {
    // ... 测试增量流
  })
})
```

---

## 第四步：验证集成

### 端到端测试

```bash
# 1. 启动 OpenCode
npm run dev

# 2. 创建新会话，选择 Qoder 模型

# 3. 验证 TUI 显示
# - [ ] 工具输入显示正确
# - [ ] 状态从 pending → running → completed 正确转换
# - [ ] 工具输出显示正确

# 4. 检查日志
# - [ ] processor.ts 中 tool-input-start/tool-call 分支被执行
# - [ ] 数据库中 ToolPart 被正确存储
```

### 调试命令

```typescript
// 在 processor.ts 中添加日志
case "tool-input-start":
  console.log("📍 tool-input-start:", value.id, value.toolName)
  // ...

case "tool-call":
  console.log("🏃 tool-call:", value.toolCallId, value.toolName, value.input)
  // ...

case "tool-result":
  console.log("✅ tool-result:", value.toolCallId, value.output)
  // ...
```

---

## 第五步：处理边界情况

### 情况1：工具执行由 Qoder 处理

```typescript
// 如果 Qoder 有内置工具执行
controller.enqueue({
  type: "tool-call",
  toolCallId: "call_001",
  toolName: "web_search",     // Qoder 内置搜索
  input: { query: "..." },
  providerExecuted: true,      // ✓ 标记为内置执行
})

// OpenCode 将跳过此工具的执行
```

### 情况2：并行工具调用

```typescript
// Qoder 在一个响应中返回多个工具调用
for (const toolCall of chunk.tool_calls) {
  controller.enqueue({
    type: "tool-input-start",
    id: toolCall.call_id,
    toolName: toolCall.tool_name,
  })
  
  controller.enqueue({
    type: "tool-call",
    toolCallId: toolCall.call_id,
    toolName: toolCall.tool_name,
    input: toolCall.params,
  })
}
```

### 情况3：工具调用失败

```typescript
// Qoder 返回工具执行错误
controller.enqueue({
  type: "tool-error",
  toolCallId: chunk.call_id,
  input: chunk.params,
  error: new Error(chunk.error_message),
})
```

---

## 第六步：性能优化

### 流式输入增量 (可选但推荐)

```typescript
// 不要等待完整的 tool-call，逐步发射 tool-input-delta
// 这使 UI 可以渐进式显示工具参数

for await (const chunk of stream) {
  if (chunk.type === 'tool_call_params_chunk') {
    controller.enqueue({
      type: "tool-input-delta",
      id: chunk.call_id,
      delta: chunk.params_json_chunk,  // 例如："{\n  \"command\":"
    })
  }
}
```

### 元数据传递

```typescript
// 传递提供商元数据供后续使用
controller.enqueue({
  type: "tool-call",
  toolCallId: "call_001",
  toolName: "bash",
  input: { command: "ls" },
  providerMetadata: {
    qoder: {
      executionTime: 125,      // ms
      tokenUsed: 45,
      model: "qmodel-v1",
    }
  }
})
```

---

## 第七步：错误处理

### 完善的错误处理

```typescript
export class QoderLanguageModelV2 {
  async doStream(options: LanguageModelV2CallOptions) {
    return {
      stream: new ReadableStream({
        async start(controller) {
          try {
            const stream = await qoderSDK.query(...)
            
            for await (const chunk of stream) {
              try {
                // 处理 chunk
                // ...
              } catch (error) {
                // 单个 chunk 错误，继续处理下一个
                console.error("Error processing chunk:", error)
                continue
              }
            }
            
            // 流完成
            controller.enqueue({ type: "finish", finishReason: "stop" })
          } catch (error) {
            // 流级别错误
            controller.error(new Error(`Qoder API error: ${error.message}`))
          }
        }
      }),
    }
  }
}
```

---

## 检查清单

- [ ] 实现 `tool-input-start` 发射
- [ ] 实现 `tool-call` 发射（必须包含已解析的 `input` 对象）
- [ ] 实现 `finish` 发射（`finishReason: "tool-calls"` 当有工具调用时）
- [ ] 可选：实现 `tool-input-delta` 流式增量
- [ ] 可选：实现 `tool-result` 如果 Qoder 返回结果
- [ ] 可选：实现 `tool-error` 如果 Qoder 返回错误
- [ ] 测试工具调用完整生命周期
- [ ] 验证 `toolCallId` 和 `toolName` 一致性
- [ ] 处理并行工具调用情况
- [ ] 添加适当的错误处理
- [ ] 添加调试日志
- [ ] 运行端到端测试

---

## 常见问题

### Q1: 为什么 `input` 必须是对象而不是 JSON 字符串？

**A**: OpenCode 的 processor.ts 直接使用 `value.input` 设置到 state 中：
```typescript
state: {
  status: "running",
  input: value.input,  // 直接赋值，期望是对象
}
```

如果是字符串，后续 UI 会显示 `[object Object]` 而不是参数值。

### Q2: `providerExecuted` 何时应该设置？

**A**: 仅当工具由 Qoder 内部执行且结果已返回时：
- OpenAI 内置工具: `image_generation`, `file_search` → `providerExecuted: true`
- 自定义工具（需要 OpenCode 执行）: `bash`, `read`, `grep` → 不设置
- Qoder 内置工具（如果有）: 根据执行情况设置

### Q3: 如何处理错误的工具调用？

**A**: 发射 `tool-error` 部分：
```typescript
{
  type: "tool-error",
  toolCallId: "call_001",
  input: { /* 原始参数 */ },
  error: new Error("Tool execution failed"),
}
```

processor.ts 会捕获并设置 `status: "error"`。

---

## 参考资源

- 详细文档: `TOOL_CALL_STREAMING_ANALYSIS.md`
- 快速参考: `TOOL_CALL_SUMMARY.md`
- 测试示例: `/packages/opencode/test/provider/copilot/copilot-chat-model.test.ts`
- 实现参考: `/packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts`

