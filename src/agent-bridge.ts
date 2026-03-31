/**
 * agent-bridge：桥接 opencode agent types → Qoder CLI agent type 映射
 *
 * Qoder CLI 模型的系统 prompt 中定义了标准 opencode agent 类型
 * （如 general-purpose、code-reviewer 等），但用户的 opencode 实例
 * 可能使用自定义 agent 类型（如 oh-my-opencode-slim 的 explorer、fixer 等）。
 *
 * 本模块在 config hook 阶段检测可用的 agent 类型，在 tool 标准化阶段
 * 将 CLI 发出的标准类型映射为实际可用的类型。
 */

// ── 标准 opencode agent 类型 → 语义类别 映射 ────────────────────────────────
// 用于在目标类型集合中寻找最近似的匹配

const SEMANTIC_CATEGORIES: Record<string, string[]> = {
  explore: ['general-purpose', 'spec-review-agent', 'qoder-guide'],
  fix: ['code-reviewer', 'task-executor'],
  design: ['design-agent'],
}

// ── 全局状态 ──────────────────────────────────────────────────────────────────

let availableAgentTypes: Set<string> | null = null

/**
 * 由 index.ts config hook 调用，存储当前 opencode 实例可用的 agent 类型。
 */
export function setAvailableAgentTypes(types: string[]): void {
  availableAgentTypes = new Set(types)
}

/**
 * 由 qoder-language-model.ts normalizeToolInputObject() 调用，
 * 将 CLI 发出的标准 agent 类型映射为实际可用的类型。
 *
 * 仅在检测到自定义 agent 类型时才进行映射；
 * 如果未设置可用类型（标准 opencode 环境），原样返回。
 */
export function mapSubagentType(cliType: string): string {
  // 没有检测到自定义类型，原样返回（标准 opencode 环境）
  if (!availableAgentTypes || availableAgentTypes.size === 0) return cliType

  // 已在可用类型中，无需映射
  if (availableAgentTypes.has(cliType)) return cliType

  // 根据语义类别查找匹配
  for (const [category, standardTypes] of Object.entries(SEMANTIC_CATEGORIES)) {
    if (!standardTypes.includes(cliType)) continue

    // 在可用类型中查找包含该语义类别关键字的类型
    for (const available of availableAgentTypes) {
      if (available.includes(category)) return available
    }
  }

  // 回退：返回第一个可用类型（至少不会报错）
  const first = availableAgentTypes.values().next().value
  return first ?? cliType
}
