import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  ProviderV2,
} from '@ai-sdk/provider'

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

import {
  configure,
  QoderAgentSDKClient,
} from './vendor/qoder-agent-sdk.mjs'

import { buildStringPrompt } from './prompt-builder.js'

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

// ── MCP server config 转换 ────────────────────────────────────────────────────

type McpServerConfig =
  | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'sdk'; name: string; instance: unknown }

function buildMcpServers(
  options: LanguageModelV2CallOptions,
): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {}

  // 从 providerOptions.qoder.mcpServers 提取
  const providerOptions = getQoderProviderOptions(options.providerOptions)
  if (isRecord(providerOptions?.mcpServers)) {
    for (const [name, cfg] of Object.entries(providerOptions.mcpServers)) {
      const normalized = normalizeMcpConfig(cfg, name)
      if (normalized) result[name] = normalized
    }
  }

  // 从 tools 中的 provider-defined 提取
  for (const tool of options.tools ?? []) {
    if (tool.type !== 'provider-defined') continue
    const name = inferServerName(tool)
    const cfg = normalizeMcpConfig(tool.args, name)
    if (name && cfg && !result[name]) result[name] = cfg
  }

  return result
}

function getQoderProviderOptions(
  providerOptions: LanguageModelV2CallOptions['providerOptions'],
): { mcpServers?: Record<string, unknown> } | undefined {
  if (!isRecord(providerOptions)) return undefined
  const q = providerOptions.qoder
  return isRecord(q) ? (q as { mcpServers?: Record<string, unknown> }) : undefined
}

function inferServerName(tool: { id: string; name: string; args: unknown }): string | undefined {
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

function normalizeMcpConfig(config: unknown, serverName?: string): McpServerConfig | null {
  if (!isRecord(config)) return null
  if (config.enabled === false) return null

  // SDK in-process MCP server（由 createSdkMcpServer() 创建的 { type: 'sdk', name, instance }）
  if (config.type === 'sdk' && typeof config.name === 'string' && config.instance != null) {
    return { type: 'sdk', name: config.name, instance: config.instance }
  }

  // 原始 McpServer 实例（直接传 createSdkMcpServer() 返回值，有 connect/close 方法）
  if (typeof config.connect === 'function' && typeof config.close === 'function' && serverName) {
    return { type: 'sdk', name: serverName, instance: config as { connect(): Promise<void>; close(): Promise<void> } }
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

  if (isRecord(config.mcpServer)) return normalizeMcpConfig(config.mcpServer)
  if (isRecord(config.serverConfig)) return normalizeMcpConfig(config.serverConfig)

  return null
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(options: LanguageModelV2CallOptions): string {
  return buildStringPrompt(options.prompt)
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
    const prompt = buildPrompt(options)
    const mcpServers = buildMcpServers(options)
    const cliPath = resolveQoderCLI()

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start: async (controller) => {
        // ── text block 状态管理 ──────────────────────────────────────────
        let textIdCounter = 0
        let currentTextId: string | null = null
        let textStarted = false
        let hasFinish = false

        // tool_use_id → toolName 映射（用于 tool_result 时查找 toolName）
        const toolCallNames = new Map<string, string>()
        // 已通过 stream_event 发出的 tool-call id（防 assistant 重复发）
        const emittedToolCalls = new Set<string>()

        // stream_event 路径：按 index 跟踪活跃内容块
        const streamBlocks = new Map<number, {
          type: string
          id?: string
          name?: string
          accumulatedJson?: string
        }>()

        const ensureTextStart = () => {
          if (!textStarted) {
            currentTextId = String(textIdCounter++)
            controller.enqueue({ type: 'text-start', id: currentTextId })
            textStarted = true
          }
        }

        const ensureTextEnd = () => {
          if (textStarted && currentTextId != null) {
            controller.enqueue({ type: 'text-end', id: currentTextId })
            textStarted = false
            currentTextId = null
          }
        }

        const enqueueFinish = (
          finishReason: LanguageModelV2FinishReason,
          usage?: LanguageModelV2Usage,
        ) => {
          if (hasFinish) return
          ensureTextEnd()
          controller.enqueue({
            type: 'finish',
            finishReason,
            usage: usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          })
          hasFinish = true
        }

        const hasMcpServers = Object.keys(mcpServers).length > 0

        const client = new QoderAgentSDKClient({
          model: this.modelId,
          cwd: process.cwd(),
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          storageDir: resolveStorageDir(),
          ...(cliPath ? { pathToQoderCLIExecutable: cliPath } : {}),
          ...(hasMcpServers ? { mcpServers } : {}),
        })

        try {
          await client.connect()
          await client.query(prompt, randomUUID())

          for await (const msg of client.receiveMessages()) {
            const m = msg as Record<string, unknown>

            // ── stream_event：增量文本 / 增量工具输入（流式 CLI 支持时） ──
            if (m.type === 'stream_event') {
              const event = m.event as Record<string, unknown> | undefined
              if (!event) continue

              if (event.type === 'content_block_start' && isRecord(event.content_block)) {
                const block = event.content_block
                const idx = typeof event.index === 'number' ? event.index : 0

                if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
                  // 工具调用开始：先关闭当前文本块
                  ensureTextEnd()
                  streamBlocks.set(idx, { type: 'tool_use', id: block.id, name: block.name, accumulatedJson: '' })
                  toolCallNames.set(block.id, block.name)
                  controller.enqueue({
                    type: 'tool-input-start',
                    id: block.id,
                    toolName: block.name,
                    providerExecuted: true,
                  } as LanguageModelV2StreamPart)
                } else if (block.type === 'text') {
                  streamBlocks.set(idx, { type: 'text' })
                  ensureTextStart()
                }
              } else if (event.type === 'content_block_delta' && isRecord(event.delta)) {
                const delta = event.delta
                const idx = typeof event.index === 'number' ? event.index : 0
                const block = streamBlocks.get(idx)

                if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
                  ensureTextStart()
                  controller.enqueue({ type: 'text-delta', id: currentTextId ?? '0', delta: delta.text })
                } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string' && block?.type === 'tool_use' && block.id) {
                  block.accumulatedJson = (block.accumulatedJson ?? '') + delta.partial_json
                  controller.enqueue({
                    type: 'tool-input-delta',
                    id: block.id,
                    delta: delta.partial_json,
                  } as LanguageModelV2StreamPart)
                }
              } else if (event.type === 'content_block_stop') {
                const idx = typeof event.index === 'number' ? event.index : 0
                const block = streamBlocks.get(idx)

                if (block?.type === 'tool_use' && block.id) {
                  controller.enqueue({ type: 'tool-input-end', id: block.id } as LanguageModelV2StreamPart)
                  controller.enqueue({
                    type: 'tool-call',
                    toolCallId: block.id,
                    toolName: block.name ?? '',
                    input: block.accumulatedJson || '{}',
                    providerExecuted: true,
                  } as LanguageModelV2StreamPart)
                  emittedToolCalls.add(block.id)
                } else if (block?.type === 'text') {
                  ensureTextEnd()
                }
                streamBlocks.delete(idx)
              }

            // ── assistant：完整消息块（CLI 不支持流式时走此路径） ──────────
            } else if (m.type === 'assistant') {
              const rawContent = (m.message as Record<string, unknown> | undefined)?.content
              const content = Array.isArray(rawContent) ? rawContent : []
              for (const block of content) {
                if (!isRecord(block)) continue

                if (block.type === 'text' && typeof block.text === 'string' && block.text) {
                  ensureTextStart()
                  controller.enqueue({ type: 'text-delta', id: currentTextId ?? '0', delta: block.text })
                  // 不立即 ensureTextEnd——同一 assistant 消息中的多个 text 块合为一个
                } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
                  // 如果 stream_event 路径已经发出过，跳过
                  if (emittedToolCalls.has(block.id)) continue

                  ensureTextEnd()
                  toolCallNames.set(block.id, block.name)
                  controller.enqueue({
                    type: 'tool-call',
                    toolCallId: block.id,
                    toolName: block.name,
                    input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
                    providerExecuted: true,
                  } as LanguageModelV2StreamPart)
                  emittedToolCalls.add(block.id)
                }
              }
              // assistant 消息处理完后关闭文本块（下一条消息可能是 tool_result）
              ensureTextEnd()

            // ── user：工具执行结果（CLI 内部执行后返回） ─────────────────
            } else if (m.type === 'user') {
              const rawContent = (m.message as Record<string, unknown> | undefined)?.content
              const content = Array.isArray(rawContent) ? rawContent : []
              for (const block of content) {
                if (!isRecord(block)) continue

                if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                  const toolUseId = block.tool_use_id
                  const toolName = toolCallNames.get(toolUseId) ?? ''
                  controller.enqueue({
                    type: 'tool-result',
                    toolCallId: toolUseId,
                    toolName,
                    result: block.content ?? '',
                    isError: block.is_error === true,
                    providerExecuted: true,
                  } as LanguageModelV2StreamPart)
                }
              }

            // ── result：会话结束 ────────────────────────────────────────
            } else if (m.type === 'result') {
              const isError =
                m.is_error === true ||
                (typeof m.subtype === 'string' && m.subtype !== 'success')

              if (isError) {
                const errMsg =
                  typeof m.subtype === 'string' ? m.subtype : 'error_during_execution'
                const errors = Array.isArray(m.errors) ? JSON.stringify(m.errors) : ''
                console.error('[QoderSDK] result error:', JSON.stringify(m, null, 2))
                controller.enqueue({
                  type: 'error',
                  error: new Error(`Qoder SDK: ${errMsg}${errors ? ` | errors: ${errors}` : ''}`),
                })
                enqueueFinish('error')
              } else {
                const usage = m.usage as {
                  input_tokens: number
                  output_tokens: number
                } | undefined
                enqueueFinish('stop', {
                  inputTokens: usage?.input_tokens ?? 0,
                  outputTokens: usage?.output_tokens ?? 0,
                  totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
                })
              }
              break  // result 是终止消息，退出迭代
            }
            // type: 'system' — 忽略
          }

          await (client as { disconnect?: () => Promise<void> }).disconnect?.()
          if (!hasFinish) enqueueFinish('stop')
          controller.close()
        } catch (err) {
          await (client as { disconnect?: () => Promise<void> }).disconnect?.()
          if (!hasFinish) {
            controller.enqueue({
              type: 'error',
              error: err instanceof Error ? err : new Error(String(err)),
            })
            enqueueFinish('error')
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
