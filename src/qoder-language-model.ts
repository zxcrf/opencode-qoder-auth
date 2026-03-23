import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2ProviderDefinedTool,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  ProviderV2,
} from '@ai-sdk/provider'

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

import {
  configure,
  query,
} from './vendor/qoder-agent-sdk.mjs'

import { buildPromptFromOptions } from './prompt-builder.js'
import { getMcpBridgeServers } from './mcp-bridge.js'

// ── storageDir 解析 — 优先 ~/.qoderwork（QoderWork 登录），回退 ~/.qoder ───────
function resolveStorageDir(): string {
  const qoderwork = path.join(os.homedir(), '.qoderwork')
  if (fs.existsSync(path.join(qoderwork, '.auth', 'user'))) return qoderwork
  return path.join(os.homedir(), '.qoder')
}

// ── SDK 全局配置 — 不设 integrationMode（设置后服务端会按订阅类型鉴权） ──────
configure({
  storageDir: resolveStorageDir(),
})

/**
 * 过滤 @ali/qoder-agent-sdk 打到 console 的 [SDK] 系列日志，避免污染 opencode 界面。
 * 在模块加载时立即安装，永久生效，只屏蔽 SDK 特征前缀的行。
 */
function installSdkLogFilter(): void {
  const origLog = console.log
  const origError = console.error

  const isSdkLine = (...args: unknown[]) => {
    const first = String(args[0] ?? '')
    return (
      first.startsWith('[SDK]') ||
      first.startsWith('Platform:') ||
      first.startsWith('Spawn options:')
    )
  }

  console.log = (...args: unknown[]) => {
    if (!isSdkLine(...args)) origLog(...args)
  }
  console.error = (...args: unknown[]) => {
    if (!isSdkLine(...args)) origError(...args)
  }
}

// 模块加载即生效
installSdkLogFilter()

// ── qodercli 二进制路径解析 ───────────────────────────────────────────────────

function resolveQoderCLI(): string | undefined {
  // 1. 全局 PATH 里的 qodercli（用户自行安装，优先）
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter)
  for (const dir of pathDirs) {
    const p = path.join(dir, 'qodercli')
    if (fs.existsSync(p)) return p
  }

  // 2. SDK 默认本地安装路径：~/.qoder/local/qodercli
  const localCli = path.join(os.homedir(), '.qoder', 'local', 'qodercli')
  if (fs.existsSync(localCli)) return localCli

  // 3. 回退：~/.qoder/bin/qodercli/qodercli-<version>（取最新版本）
  const binDir = path.join(os.homedir(), '.qoder', 'bin', 'qodercli')
  if (fs.existsSync(binDir)) {
    try {
      const entries = fs
        .readdirSync(binDir)
        .filter((f) => f.startsWith('qodercli-'))
        .sort()
        .reverse()
      const latest = entries[0]
      if (latest) {
        const p = path.join(binDir, latest)
        if (fs.existsSync(p)) return p
      }
    } catch { /* ignore */ }
  }
  return undefined
}

// ── 工具名称标准化 ────────────────────────────────────────────────────────────

/**
 * CLI 工具名 → opencode 工具名 的标准化映射：
 *   - 大小写：Read → read, Bash → bash
 *   - CLI 内置特殊名：AskUserQuestion → question
 *   - MCP proxy 格式：mcp__context7__resolve-library-id → context7_resolve-library-id
 *     （CLI 用双下划线 mcp__{server}__{tool}，opencode 用单下划线 {server}_{tool}）
 */
function normalizeToolName(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'askuserquestion') return 'question'
  // CLI MCP proxy 格式：mcp__{serverName}__{toolName} → {serverName}_{toolName}
  if (lower.startsWith('mcp__')) {
    const withoutPrefix = lower.slice(5) // 去掉 'mcp__'
    // 找到第二个 __ 分隔符（serverName 和 toolName 之间）
    const separatorIdx = withoutPrefix.indexOf('__')
    if (separatorIdx > 0) {
      const serverName = withoutPrefix.slice(0, separatorIdx)
      const toolName = withoutPrefix.slice(separatorIdx + 2)
      return `${serverName}_${toolName}`
    }
    // 没有第二个 __，直接去掉 mcp__ 前缀
    return withoutPrefix
  }
  return lower
}


// ── MCP server config 转换 ────────────────────────────────────────────────────

type QoderMcpServerConfig =
  | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'sdk'; name: string; instance: unknown }

type QoderProviderOptions = {
  mcpServers?: Record<string, unknown>
}

function buildQoderQueryOptions(
  options: LanguageModelV2CallOptions,
  modelId: string,
  cliPath?: string,
): {
  model: string
  allowDangerouslySkipPermissions: true
  permissionMode: 'bypassPermissions'
  cwd: string
  pathToQoderCLIExecutable?: string
  mcpServers?: Record<string, QoderMcpServerConfig>
} {
  const providerOptions = getQoderProviderOptions(options.providerOptions)

  // 双轨 MCP 策略：CLI 和 opencode 各自独立连接 MCP servers
  // CLI 通过 mcp__{server}__{tool} 格式调用，opencode 通过 {server}_{tool} 格式调用
  // 不过滤 opencode 已管理的 servers — CLI 需要自主使用外部 MCP 工具完成 agent loop
  const mcpServers = {
    ...getMcpBridgeServers(),                                                  // config.mcp 桥接（全量传递，不过滤）
    ...extractMcpServersFromProviderOptions(providerOptions?.mcpServers),      // providerOptions 覆盖（高优先级）
    ...extractMcpServersFromTools(options.tools),                              // provider-defined tools（最高优先级）
  }

  return {
    model: modelId,
    allowDangerouslySkipPermissions: true,
    permissionMode: 'bypassPermissions',
    cwd: process.cwd(),
    ...(cliPath ? { pathToQoderCLIExecutable: cliPath } : {}),
    ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
  }
}

function getQoderProviderOptions(
  providerOptions: LanguageModelV2CallOptions['providerOptions'],
): QoderProviderOptions | undefined {
  if (!isRecord(providerOptions)) return undefined
  const q = providerOptions.qoder
  return isRecord(q) ? (q as QoderProviderOptions) : undefined
}

function extractMcpServersFromProviderOptions(
  mcpServers: unknown,
): Record<string, QoderMcpServerConfig> {
  if (!isRecord(mcpServers)) return {}
  const normalizedEntries = Object.entries(mcpServers)
    .map(([name, config]) => [name, normalizeMcpServerConfig(config)] as const)
    .filter((entry): entry is [string, QoderMcpServerConfig] => entry[1] != null)
  return Object.fromEntries(normalizedEntries)
}

function extractMcpServersFromTools(
  tools: LanguageModelV2CallOptions['tools'],
): Record<string, QoderMcpServerConfig> {
  if (!tools || tools.length === 0) return {}
  const servers: Record<string, QoderMcpServerConfig> = {}
  for (const tool of tools) {
    if (tool.type !== 'provider-defined') continue
    const serverName = inferProviderDefinedToolServerName(tool)
    const serverConfig = normalizeMcpServerConfig(tool.args)
    if (!serverName || !serverConfig) continue
    servers[serverName] = serverConfig
  }
  return servers
}

function inferProviderDefinedToolServerName(tool: LanguageModelV2ProviderDefinedTool): string | undefined {
  const args = isRecord(tool.args) ? tool.args : undefined
  const explicit =
    pickString(args?.serverName) ??
    pickString(args?.mcpServerName) ??
    pickString(args?.server) ??
    pickString(args?.name)
  if (explicit) return explicit
  const [, suffix] = tool.id.split('.', 2)
  return suffix || tool.name
}

function normalizeMcpServerConfig(config: unknown): QoderMcpServerConfig | null {
  if (!isRecord(config)) return null
  if (config.enabled === false) return null

  // SDK in-process MCP server（由 createSdkMcpServer() 创建的 { type: 'sdk', name, instance }）
  if (config.type === 'sdk' && typeof config.name === 'string' && config.instance != null) {
    return { type: 'sdk', name: config.name, instance: config.instance }
  }

  if (Array.isArray(config.command) && config.command.every((v) => typeof v === 'string')) {
    if (config.command.length === 0) return null
    const [command, ...args] = config.command as string[]
    const env = pickStringRecord(config.environment) ?? pickStringRecord(config.env)
    return { command, ...(args.length > 0 ? { args } : {}), ...(env ? { env } : {}) }
  }

  if (typeof config.command === 'string') {
    const args = pickStringArray(config.args)
    const env = pickStringRecord(config.environment) ?? pickStringRecord(config.env)
    return {
      ...(config.type === 'stdio' ? { type: 'stdio' as const } : {}),
      command: config.command,
      ...(args && args.length > 0 ? { args } : {}),
      ...(env ? { env } : {}),
    }
  }

  const url = pickString(config.url) ?? pickString(config.endpoint)
  if (url) {
    const headers = pickStringRecord(config.headers)
    return {
      type: config.type === 'sse' ? 'sse' : 'http',
      url,
      ...(headers ? { headers } : {}),
    }
  }

  if (isRecord(config.mcpServer)) return normalizeMcpServerConfig(config.mcpServer)
  if (isRecord(config.serverConfig)) return normalizeMcpServerConfig(config.serverConfig)

  return null
}

// ── LanguageModelV2 实现 ──────────────────────────────────────────────────────

export class QoderLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const
  readonly provider = 'qoder'
  readonly supportedUrls: Record<string, RegExp[]> = {}

  constructor(public readonly modelId: string) {}

  async doGenerate(options: LanguageModelV2CallOptions) {
    const { stream } = await this.doStream(options)
    const reader = stream.getReader()
    let text = ''
    let finishReason: LanguageModelV2FinishReason = 'stop'
    let usage: LanguageModelV2Usage | undefined

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      switch (value.type) {
        case 'text-delta':
          text += value.delta
          break
        case 'finish':
          finishReason = value.finishReason
          usage = value.usage
          break
        case 'error':
          throw value.error instanceof Error ? value.error : new Error(String(value.error))
      }
    }

    const content: LanguageModelV2Content[] = text ? [{ type: 'text', text }] : []
    return {
      content,
      finishReason,
      usage: usage ?? { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
      warnings: [],
    }
  }

  async doStream(options: LanguageModelV2CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>
  }> {
    const prompt = buildPromptFromOptions(options)
    const cliPath = resolveQoderCLI()
    const qoderOptions = buildQoderQueryOptions(options, this.modelId, cliPath)

    // opencode function 工具名集合（由 opencode 管理并执行，如 bash、read、context7_resolve-library-id 等）
    // 这些工具调用不带 providerExecuted，让 opencode 负责执行
    // CLI 内置工具（Bash/Read/Write 等）经 normalizeToolName 转小写后若匹配则由 opencode 执行
    // CLI MCP proxy 工具（mcp__server__tool）经 normalizeToolName 转为 server_tool 后若匹配同理
    // 不在此集合中的工具由 CLI 自行执行 — 不向 opencode 发 tool 事件
    const hasTools = (options.tools ?? []).some((t) => t.type === 'function')
    const functionToolNames = new Set(
      (options.tools ?? [])
        .filter((t) => t.type === 'function')
        .map((t) => normalizeToolName(t.name))
    )

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start: async (controller) => {
        // ── text block 状态管理 ──────────────────────────────────────────
        let textBlockCounter = 0
        let hasFinish = false

        // stream_event 路径：按 index 跟踪活跃内容块
        const activeStreamTextBlocks = new Set<number>()
        const streamToolBlocks = new Map<number, { id: string; name: string; input: string; isProviderExecuted: boolean }>()

        // 已通过 stream_event 发出的标志（防 assistant 消息重复发）
        let sawStreamEventText = false
        let sawStreamEventTool = false

        // tool_use_id → {toolName, input, isProviderExecuted} 映射（用于 tool_result 时查找）
        const pendingToolCalls = new Map<string, { toolName: string; input: string; isProviderExecuted: boolean }>()

        try {
          // query() 是单次查询的最优路径（QoderAgentSDKClient 是双向交互会话，每次 connect() 冷启动更慢）
          const qoderQuery = query({ prompt, options: qoderOptions })
          for await (const msg of qoderQuery) {
            const m = msg as Record<string, unknown>

            // ── stream_event：增量文本 / 增量工具输入（流式 CLI 支持时） ──
            if (m.type === 'stream_event') {
              const ev = (m as { event: Record<string, unknown> }).event

              if (ev.type === 'content_block_start' && isRecord(ev.content_block)) {
                const block = ev.content_block
                const idx = typeof ev.index === 'number' ? ev.index : 0

                if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
                  sawStreamEventTool = true
                  const toolName = normalizeToolName(block.name)
                  // normalizeToolName 统一处理：大小写 + AskUserQuestion→question + mcp__server__tool→server_tool
                  const isProviderExecuted = hasTools && !functionToolNames.has(toolName)
                  streamToolBlocks.set(idx, { id: block.id, name: toolName, input: '', isProviderExecuted })
                  if (!isProviderExecuted) {
                    controller.enqueue({
                      type: 'tool-input-start',
                      id: block.id,
                      toolName,
                    } as LanguageModelV2StreamPart)
                  }
                } else if (block.type === 'text') {
                  activeStreamTextBlocks.add(idx)
                  controller.enqueue({ type: 'text-start', id: String(idx) })
                }
              } else if (ev.type === 'content_block_delta' && isRecord(ev.delta)) {
                const delta = ev.delta
                const idx = typeof ev.index === 'number' ? ev.index : 0

                if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
                  sawStreamEventText = true
                  if (!activeStreamTextBlocks.has(idx)) {
                    activeStreamTextBlocks.add(idx)
                    controller.enqueue({ type: 'text-start', id: String(idx) })
                  }
                  controller.enqueue({ type: 'text-delta', id: String(idx), delta: delta.text })
                } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
                  const toolBlock = streamToolBlocks.get(idx)
                  if (toolBlock) {
                    toolBlock.input += delta.partial_json
                    if (!toolBlock.isProviderExecuted) {
                      controller.enqueue({
                        type: 'tool-input-delta',
                        id: toolBlock.id,
                        delta: delta.partial_json,
                      } as LanguageModelV2StreamPart)
                    }
                  }
                }
              } else if (ev.type === 'content_block_stop') {
                const idx = typeof ev.index === 'number' ? ev.index : 0
                const toolBlock = streamToolBlocks.get(idx)

                if (toolBlock) {
                  if (!toolBlock.isProviderExecuted) {
                    controller.enqueue({ type: 'tool-input-end', id: toolBlock.id } as LanguageModelV2StreamPart)
                    controller.enqueue({
                      type: 'tool-call',
                      toolCallId: toolBlock.id,
                      toolName: toolBlock.name,
                      input: toolBlock.input,
                    } as LanguageModelV2StreamPart)
                  }
                  pendingToolCalls.set(toolBlock.id, {
                    toolName: toolBlock.name,
                    input: toolBlock.input,
                    isProviderExecuted: toolBlock.isProviderExecuted,
                  })
                  streamToolBlocks.delete(idx)
                } else if (activeStreamTextBlocks.has(idx)) {
                  controller.enqueue({ type: 'text-end', id: String(idx) })
                  activeStreamTextBlocks.delete(idx)
                }
              }

            // ── assistant：完整消息块（CLI 不支持流式时走此路径） ──────────
            } else if (m.type === 'assistant') {
              const rawContent = (m.message as Record<string, unknown> | undefined)?.content
              const content = Array.isArray(rawContent) ? rawContent : []
              for (const block of content) {
                if (!isRecord(block)) continue

                if (block.type === 'text' && typeof block.text === 'string' && block.text && !sawStreamEventText) {
                  const textId = String(textBlockCounter++)
                  controller.enqueue({ type: 'text-start', id: textId })
                  controller.enqueue({ type: 'text-delta', id: textId, delta: block.text })
                  controller.enqueue({ type: 'text-end', id: textId })
                } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string' && !sawStreamEventTool) {
                  const toolName = normalizeToolName(block.name)
                  // normalizeToolName 统一处理：大小写 + AskUserQuestion→question + mcp__server__tool→server_tool
                  const isProviderExecuted = hasTools && !functionToolNames.has(toolName)
                  pendingToolCalls.set(block.id, { toolName, input: '', isProviderExecuted })
                  if (!isProviderExecuted) {
                    const inputJson = typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {})
                    controller.enqueue({
                      type: 'tool-input-start',
                      id: block.id,
                      toolName,
                    } as LanguageModelV2StreamPart)
                    controller.enqueue({
                      type: 'tool-input-delta',
                      id: block.id,
                      delta: inputJson,
                    } as LanguageModelV2StreamPart)
                    controller.enqueue({ type: 'tool-input-end', id: block.id } as LanguageModelV2StreamPart)
                    controller.enqueue({
                      type: 'tool-call',
                      toolCallId: block.id,
                      toolName,
                      input: inputJson,
                    } as LanguageModelV2StreamPart)
                    // 更新 input 到 pendingToolCalls
                    pendingToolCalls.set(block.id, { toolName, input: inputJson, isProviderExecuted })
                  }
                }
              }

            // ── user：工具执行结果（CLI 内部执行后返回） ─────────────────
            } else if (m.type === 'user') {
              const rawContent = (m.message as Record<string, unknown> | undefined)?.content
              const content = Array.isArray(rawContent) ? rawContent : []
              for (const block of content) {
                if (!isRecord(block)) continue
                if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue

                const toolCall = pendingToolCalls.get(block.tool_use_id)
                if (!toolCall) continue

                // CLI 内置工具（isProviderExecuted=true）的结果不转发给 opencode
                // function 工具（isProviderExecuted=false）由 opencode 执行，CLI 也会发 tool_result 但不需转发
                pendingToolCalls.delete(block.tool_use_id)
              }

            // ── result：会话结束 ────────────────────────────────────────
            } else if (m.type === 'result') {
              // 清理残留 pending 工具调用
              pendingToolCalls.clear()

              // 关闭所有未关闭的文本块
              for (const idx of activeStreamTextBlocks) {
                controller.enqueue({ type: 'text-end', id: String(idx) })
              }
              activeStreamTextBlocks.clear()

              const isError =
                m.is_error === true ||
                (typeof m.subtype === 'string' && m.subtype !== 'success')

              if (isError) {
                const errMsg = typeof m.subtype === 'string' ? m.subtype : 'error_during_execution'
                const errors = Array.isArray(m.errors) ? JSON.stringify(m.errors) : ''
                console.error('[QoderSDK] result error:', JSON.stringify(m, null, 2))
                controller.enqueue({
                  type: 'error',
                  error: new Error(`Qoder SDK: ${errMsg}${errors ? ` | errors: ${errors}` : ''}`),
                })
                controller.enqueue({
                  type: 'finish',
                  finishReason: 'error',
                  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                })
              } else {
                const usage = m.usage as { input_tokens: number; output_tokens: number } | undefined
                controller.enqueue({
                  type: 'finish',
                  finishReason: 'stop',
                  usage: {
                    inputTokens: usage?.input_tokens ?? 0,
                    outputTokens: usage?.output_tokens ?? 0,
                    totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
                  },
                })
              }
              hasFinish = true
              break  // result 是终止消息，退出迭代
            }
            // type: 'system' — 忽略
          }

          if (!hasFinish) {
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            })
          }
          controller.close()
        } catch (err) {
          if (!hasFinish) {
            controller.enqueue({
              type: 'error',
              error: err instanceof Error ? err : new Error(String(err)),
            })
            controller.enqueue({
              type: 'finish',
              finishReason: 'error',
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            })
          }
          controller.close()
        }
      },
    })

    return { stream }
  }
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function pickStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined
}

function pickStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).filter(
    (e): e is [string, string] => typeof e[1] === 'string',
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ── Provider factory ──────────────────────────────────────────────────────────

export function createQoderProvider(): ProviderV2 {
  return {
    languageModel: (modelId: string) => new QoderLanguageModel(modelId),
    textEmbeddingModel: (_modelId: string) => {
      throw new Error('Qoder provider does not support text embeddings')
    },
    imageModel: (_modelId: string) => {
      throw new Error('Qoder provider does not support image models')
    },
  }
}
