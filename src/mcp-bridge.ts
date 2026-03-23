/**
 * mcp-bridge：桥接 opencode config.mcp → Qoder SDK query() mcpServers
 *
 * opencode 在 config hook 中将 config.mcp 的 MCP 服务器配置传入 setMcpBridgeServers()，
 * qoder-language-model 在 buildQoderQueryOptions() 中通过 getMcpBridgeServers() 读取，
 * 作为 query() 的 mcpServers 底层配置（可被 providerOptions.qoder.mcpServers 覆盖）。
 */

// ── 类型定义（与 qoder-language-model.ts 中一致） ─────────────────────────────

type QoderMcpServerConfig =
  | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'sdk'; name: string; instance: unknown }

// ── 全局状态 ──────────────────────────────────────────────────────────────────

let bridgeServers: Record<string, QoderMcpServerConfig> = {}

/**
 * 由 index.ts config hook 调用，将 opencode config.mcp 转换后的服务器配置存入全局。
 */
export function setMcpBridgeServers(servers: Record<string, QoderMcpServerConfig>): void {
  bridgeServers = servers
}

/**
 * 由 qoder-language-model.ts buildQoderQueryOptions() 调用，获取桥接服务器配置。
 */
export function getMcpBridgeServers(): Record<string, QoderMcpServerConfig> {
  return bridgeServers
}
