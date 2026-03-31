# 实现状态与未完成事项

## 1. 当前状态

本轮已完成 P0 修复，目标是先稳定当前 `opencode 主导 + Qoder provider` 路线，而不改变整体架构。

已完成内容：

1. 历史 prompt 过长时的保守截断
2. `tool-result` 的结构化序列化增强
3. 多模态路径的 `session_id` 不再为空，改为与 query session 对齐
4. 对应单测补齐并通过

已验证测试：

- `tests/prompt-builder.test.ts`
- `tests/qoder-language-model.test.ts`

## 2. 本轮未完成

以下内容仍未完成，属于后续阶段：

### P1：多轮稳定性修复

目标：在 **仍由 opencode 主导工具调用** 的前提下，引入 Qoder session 复用能力。

待做项：

1. `QoderLanguageModel` 级别复用 `sessionId`
2. 后续轮次接入 `continue` / `resume`
3. 只向 Qoder 发送“增量消息”，避免与 opencode 全量历史形成双重历史
4. session 失效后的自动回退
5. resumed session 下的历史/assistant 回放去重

### 工具调用职责边界细化

待做项：

1. 明确工具分类表（必须由 opencode 执行 / 可由 Qoder 执行 / 双轨 MCP）
2. 收敛 `task` / `question` / `subagent` 的专用处理规则
3. 增加工具路由日志与调试信息
4. 评估是否需要把部分 CLI 内置工具彻底收回到 opencode

### 权限与恢复机制

待做项：

1. 权限控制与 `bypassPermissions` 的边界重审
2. Qoder 错误类型分类
3. 中断 / abort / 外部任务完成后的状态恢复

### 调研项

待做项：

1. 继续分析 Qoder JetBrains 插件是否暴露更直接的 LLM API
2. 评估是否存在不带 agent loop 的更底层调用方式

## 3. 推荐后续顺序

建议按下面顺序继续：

1. **P1 session 复用**
2. **增量消息提取**
3. **工具调用边界收敛**
4. **继续逆向 JetBrains 插件 / 更底层 API**

## 4. 结论

当前代码已经完成 P0 止血，但“多轮真正稳定”还没有完成。

下一阶段的核心不是继续修 prompt，而是：

**在不放弃 opencode 主导权的前提下，把 Qoder 的 session 能力安全接进来。**
