# QoderWork 如何使用 SDK：会话、历史与工具调用报告

## 1. 结论

QoderWork 的主对话并不是把历史重新拼成一个大 prompt 再调用一次性 `query()`。它的主链路是：

- 为每个会话维护持久 `QoderAgentSDKClient`
- 先 `connect()` 建立长连接
- 复用 `sessionId` / `resume` / `resumeSessionAt` 续接历史会话
- 在同一条持久会话流里处理 `tool_use -> tool_result -> assistant` 的闭环

`query()` 在 QoderWork 里也有使用，但主要用于标题生成、命令简化这类短任务，不是主聊天链路。

这说明：

1. **Qoder SDK 本身支持真正的多轮持久会话**。
2. **QoderWork 的官方实现确实依赖这种持久会话能力**。
3. **我们当前插件的实现方式，与 QoderWork 主对话实现不一致**。

---

## 2. 本报告回答的问题

本报告只回答一件事：

**QoderWork 到底是如何使用 Qoder SDK 的，尤其是会话历史和工具调用是怎么处理的。**

---

## 3. 调查范围与证据来源

### 3.1 调查对象

- QoderWork 安装包：`/Applications/QoderWork.app`
- 本项目：`/Users/yee.wang/Code/github/opencode-qoder-provider`
- vendored SDK：`src/vendor/qoder-agent-sdk.mjs` / `src/vendor/qoder-agent-sdk.d.ts`

### 3.2 关键证据来源

#### QoderWork

对 `/Applications/QoderWork.app/Contents/Resources/app.asar` 解包后的主进程产物进行检索，命中核心文件：

- `QoderWork.app/Contents/Resources/app.asar -> out/main/index.js`

检索到的关键实现点包括：

- `GlobalSDKManager` 初始化 `QoderAgentSDKClient`
- `activeClients` 按 `subChatId` 复用 client
- `subChats.sessionId` 持久化会话 ID
- 主对话构造 SDK 选项时使用 `sessionId / resume / resumeSessionAt`
- result 消息中的 `session_id` 被回写到本地状态

#### 本项目

- `src/prompt-builder.ts`
- `src/qoder-language-model.ts`
- `tests/qoder-language-model.test.ts`
- `src/vendor/qoder-agent-sdk.mjs`
- `src/vendor/qoder-agent-sdk.d.ts`

---

## 4. SDK 本身支持什么能力

先看 SDK 能力边界，避免把实现问题误判成 SDK 限制。

### 4.1 `query()` 支持会话参数

在 `src/vendor/qoder-agent-sdk.d.ts` 中，`Options` 明确声明了：

- `continue?: boolean`
- `resume?: string`
- `resumeSessionAt?: string`
- `sessionId?: string`

对应位置：

- `src/vendor/qoder-agent-sdk.d.ts:1198-1253`

在 vendored SDK 实现里，这些字段会被转换成 CLI 参数：

- `--continue`
- `--resume`
- `--resume-session-at`
- `--session-id`

对应实现：

- `src/vendor/qoder-agent-sdk.mjs:608-618`

结论：

**SDK 的单次 `query()` 入口，也不是完全无状态的。**

### 4.2 SDK 还提供持久客户端模式

SDK 里还有 `QoderAgentSDKClient`：

- `connect(prompt?)`
- `query(prompt, sessionId?)`
- `receiveMessages()`

对应声明：

- `src/vendor/qoder-agent-sdk.d.ts:1934-1942`

其中 `QoderAgentSDKClient.query()` 会为发送的用户消息补齐 `session_id`：

- 字符串 prompt：直接写入 `session_id`
- AsyncIterable prompt：若 `msg.session_id` 未定义，则补默认 sessionId

对应实现：

- `src/vendor/qoder-agent-sdk.mjs:2511-2530`

结论：

**SDK 的设计并不是“只能单轮调用”。它明确提供了持久连接与续会能力。**

---

## 5. QoderWork 是如何使用 SDK 的

## 5.1 主对话使用的是持久 `QoderAgentSDKClient`

QoderWork 的主聊天链路，不是一次请求起一个临时 query，而是通过全局管理器初始化 SDK client：

- `GlobalSDKManager` 动态导入 `QoderAgentSDKClient`
- 创建 client 实例
- 调用 `connect()` 建立连接

检索命中点：

- `out/main/index.js` 中 `GlobalSDKManager.init()`

这说明 QoderWork 会先建立 SDK 层的长连接，而不是把每轮都当成一次全新调用。

## 5.2 QoderWork 会按会话复用 client

QoderWork 内部维护 `activeClients`，按 `subChatId` 复用已存在的 client。

主聊天发起时的逻辑是：

- 如果当前 `subChatId` 已经有 client，就复用
- 如果没有，就新建

检索命中点：

- `out/main/index.js` 中主对话发起分支
- 日志文本含 `Reusing existing client`

结论：

**QoderWork 的主聊天是会话级别的持久 client，不是请求级别的临时 client。**

## 5.3 QoderWork 会持久化 `sessionId`

QoderWork 的本地存储里有 `subChats.sessionId` 字段。

检索命中点显示：

- `sub_chats` 表包含 `session_id`
- result 消息中的 `session_id` 会被提取并回写到元数据/本地状态

这说明会话 ID 不是临时变量，而是 QoderWork 会长期保存并在后续继续使用。

## 5.4 QoderWork 续接历史时使用 `sessionId / resume / resumeSessionAt`

QoderWork 在构造 SDK 初始化参数时，不是只传 prompt，它还会根据当前会话状态传：

- `sessionId`
- 或 `resume`
- 或 `resumeSessionAt`

也就是说，QoderWork 会告诉 CLI / SDK：

- 这是哪个会话
- 是继续当前 session
- 还是从某个历史消息点恢复

这一步是“真正续会”的关键。

## 5.5 QoderWork 的用户消息本身也带 `session_id`

QoderWork 的 `buildSDKPrompt(...)` 检索结果显示，构造 SDK user message 时会把 `sessionId` 带入 `session_id` 字段。

这意味着：

- prompt 内容本身带有会话身份
- SDK 初始化参数也带有会话身份

这两层是对齐的。

---

## 6. QoderWork 里的工具调用是怎么处理的

## 6.1 工具调用跑在同一条持久会话流里

QoderWork 的工具调用不是“外面拼字符串模拟一下”。

它是在同一条持久 SDK 会话流里处理：

- assistant 发出 `tool_use`
- 工具返回 `tool_result`
- assistant 再继续后续推理

这说明工具调用属于会话内部状态机的一部分，不是简单文本历史。

## 6.2 工具结果通过 tool ID 映射回原会话上下文

检索到 `toolIdMapping` 的处理逻辑：

- `tool_result` 会根据 `tool_use_id` 找回映射后的 tool call
- 然后再投递成对应的工具输出事件

这意味着 QoderWork 在工具链路里保留了结构化 ID 关联，而不是只保留一段工具结果文本。

## 6.3 工具历史和会话历史是统一的

因为 QoderWork：

- 复用同一个 client
- 复用同一个 `sessionId`
- tool 事件都发生在这个持久会话流内

所以工具调用历史天然属于同一个会话状态。

这和“把 `<tool_call>` / `<tool_result>` 塞回 prompt”是两回事。

---

## 7. `query()` 在 QoderWork 里是怎么用的

QoderWork 不是完全不用 `query()`，但它主要用于短任务，而不是主聊天。

检索显示，`query()` 出现在这类场景：

- 生成对话标题
- 简化命令意图

这些场景的特点是：

- 生命周期短
- 不需要长期维持会话状态
- 更像“一次性任务”

所以 QoderWork 的使用策略是：

| 场景 | 用法 |
|---|---|
| 主对话 | `QoderAgentSDKClient + connect() + 持久复用` |
| 短任务 | 单次 `query()` |

---

## 8. 本项目现在的实现方式

为了对比，需要把本项目当前行为单独列出来。

## 8.1 本项目主要靠“历史文本注入”实现多轮

本项目的历史构造逻辑在：

- `src/prompt-builder.ts:174` `buildStringPrompt()`
- `src/prompt-builder.ts:213` `buildAsyncIterablePrompt()`

做法是：

- 取最后一条 `user`
- 之前的消息序列化为 `<conversation_history>`
- 之后的消息序列化为 `<conversation_continuation>`

这本质上是：

**每一轮把历史重新编码成文本，再发送给模型。**

## 8.2 本项目每轮都会生成新的 `sessionId`

`src/qoder-language-model.ts:354`

```ts
sessionId: randomUUID()
```

这表示每次 `doStream()` 都是一个新的会话 ID。

并且当前实现没有使用：

- `continue`
- `resume`
- `resumeSessionAt`

## 8.3 本项目测试把这种行为固化成了预期

`tests/qoder-language-model.test.ts:285`

测试名称明确写着：

> 每次 query() 都使用新的 sessionId，避免错误续用旧会话

这说明这不是偶然遗漏，而是当前实现的明确策略。

## 8.4 多模态路径还有一个额外问题

`src/prompt-builder.ts:366`

```ts
session_id: ''
```

在图片路径下，发出的 `SDKUserMessage` 把 `session_id` 写成了空字符串。

而 SDK client 的补默认值逻辑是：

```ts
session_id: msg.session_id ?? sessionId
```

空字符串不是 `undefined`，所以不会被默认值覆盖。

这会让多模态链路的会话标识更不稳定。

---

## 9. QoderWork 与本项目的关键差异

| 维度 | QoderWork | 本项目 |
|---|---|---|
| 主链路 | 持久 `QoderAgentSDKClient` | 单次 `query()` |
| 会话管理 | 持久化 `sessionId`，支持 `resume` | 每轮 `randomUUID()` |
| 历史续接 | 真实 session 续接 | 历史文本注入 |
| 工具调用 | 持久流内结构化闭环 | 框架层 + 文本回放 |
| 多轮稳定性 | 依赖官方 session 机制 | 依赖 prompt 重建 |
| 多模态 session_id | 与会话对齐 | 当前实现写空字符串 |

最核心的一句话：

**QoderWork 把 SDK 当成有状态 agent 会话系统来用；本项目把它当成无状态模型接口来用。**

---

## 10. 这对“多轮越来越不听最新指令”意味着什么

如果实现方式是 QoderWork 那种持久 session：

- 模型看到的是同一个连续会话
- 工具调用链是结构化的
- CLI/SDK 内部会话状态持续存在

如果实现方式是本项目现在这样：

- 每轮都是新 session
- 历史只是被编码为文本参考资料
- 工具调用链被降级成文本描述

那么随着轮次增加，更容易出现：

- 历史权重异常
- 最新指令被旧历史淹没
- 工具上下文断裂
- 模型把历史当“说明材料”而不是“真实会话状态”

所以这个问题不能归因于“SDK 不支持多轮”，更不能归因于“QoderWork 也是这么做的”。

相反，证据指向：

**QoderWork 正是因为没有采用我们当前这条无状态路线，才保住了主对话的多轮一致性。**

---

## 11. 最终结论

### 11.1 关于“QoderWork 是如何使用 SDK 的”

最终结论如下：

1. **QoderWork 主对话使用的是持久 `QoderAgentSDKClient`，不是单次 `query()`。**
2. **QoderWork 会保存并复用 `sessionId`，必要时通过 `resume / resumeSessionAt` 恢复历史会话。**
3. **QoderWork 的工具调用在同一条持久会话流中完成，依赖结构化 tool ID 与 session 状态。**
4. **QoderWork 的 `query()` 主要用于短生命周期任务，不是主聊天方案。**

### 11.2 对本项目的直接启示

如果目标是接近 QoderWork 的真实表现，那么仅靠 prompt 注入历史是不够的。

至少需要做到：

- 复用 `sessionId`
- 使用 `continue` / `resume`
- 避免每轮 `randomUUID()`
- 修复多模态 `session_id: ''`

如果要真正对齐官方路径，则需要：

- 切换到 `QoderAgentSDKClient`
- 建立持久连接
- 在会话级别管理 client 生命周期

---

## 12. 建议的后续动作

### 方案 A：最小修复

目标：先恢复基本多轮稳定性。

- 复用 `sessionId`，不要每轮新建
- 在后续轮次设置 `continue: true`
- 多模态路径不要再发送 `session_id: ''`
- 删除或改写“每次 query() 都新 sessionId”的测试预期

### 方案 B：对齐 QoderWork

目标：主链路和官方实现一致。

- 使用 `QoderAgentSDKClient`
- 首次进入会话时 `connect()`
- 后续按会话复用 client
- 保存并复用 `sessionId`
- 在必要时使用 `resume / resumeSessionAt`

---

## 13. 附：本报告涉及的本项目代码位置

- `src/prompt-builder.ts:174-209`
- `src/prompt-builder.ts:213-374`
- `src/prompt-builder.ts:366`
- `src/qoder-language-model.ts:306-360`
- `src/qoder-language-model.ts:510-601`
- `src/vendor/qoder-agent-sdk.d.ts:1198-1253`
- `src/vendor/qoder-agent-sdk.d.ts:1934-1942`
- `src/vendor/qoder-agent-sdk.mjs:608-618`
- `src/vendor/qoder-agent-sdk.mjs:2104-2160`
- `src/vendor/qoder-agent-sdk.mjs:2511-2530`
- `tests/qoder-language-model.test.ts:285-299`

---

## 14. 一句话摘要

**QoderWork 的主对话是“持久会话 + 结构化工具链”，本项目当前是“单次 query + 历史文本回灌”；两者不是同一种用法。**
