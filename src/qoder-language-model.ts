import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FunctionTool,
  LanguageModelV2FinishReason,
  LanguageModelV2ProviderDefinedTool,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  ProviderV2,
} from '@ai-sdk/provider'

import { query } from './vendor/qoder-agent-sdk.mjs'
import type { SDKMessage } from './vendor/qoder-agent-sdk.mjs'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { buildPromptFromOptions } from './prompt-builder.js'

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

/** 查找 Qoder CLI 可执行文件路径（绕过 SDK 内部的 __dirname 问题） */
function resolveQoderCLI(): string | undefined {
  const qoderDir = join(os.homedir(), '.qoder', 'bin', 'qodercli')
  if (!existsSync(qoderDir)) return undefined
  // 读取目录下所有条目，找名字包含 qodercli 的可执行文件，取版本最新的
  const entries = readdirSync(qoderDir).filter((e) => e.startsWith('qodercli-'))
  if (entries.length === 0) return undefined
  entries.sort()
  const cli = join(qoderDir, entries[entries.length - 1])
  return existsSync(cli) ? cli : undefined
}

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
      usage: usage ?? {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      },
      warnings: [],
    }
  }

  async doStream(options: LanguageModelV2CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>
  }> {
    const prompt = buildPromptFromOptions(options)

    const cliPath = resolveQoderCLI()
    const qoderOptions = buildQoderQueryOptions(options, this.modelId, cliPath)

    const qoderQuery = query({
      prompt,
      options: qoderOptions,
    })

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start: async (controller) => {
        try {
          let hasFinish = false
          let textBlockCounter = 0
          let sawStreamEventText = false
          let sawStreamEventTool = false
          const activeStreamTextBlocks = new Set<number>()
          const streamToolBlocks = new Map<number, { id: string; name: string; input: string }>()
          const pendingToolCalls = new Map<string, { toolName: string; input: string }>()

          for await (const msg of qoderQuery) {
            if (msg.type === 'stream_event') {
              const ev = msg.event

              if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
                sawStreamEventTool = true
                const toolName = normalizeToolName(ev.content_block.name)
                streamToolBlocks.set(ev.index, {
                  id: ev.content_block.id,
                  name: toolName,
                  input: '',
                })
                controller.enqueue({
                  type: 'tool-input-start',
                  id: ev.content_block.id,
                  toolName,
                  providerExecuted: true,
                })
              } else if (ev.type === 'content_block_delta') {
                if (ev.delta.type === 'text_delta' && ev.delta.text) {
                  sawStreamEventText = true
                  const textId = String(ev.index ?? 0)
                  if (!activeStreamTextBlocks.has(ev.index)) {
                    activeStreamTextBlocks.add(ev.index)
                    controller.enqueue({ type: 'text-start', id: textId })
                  }
                  controller.enqueue({ type: 'text-delta', id: textId, delta: ev.delta.text })
                } else if (ev.delta.type === 'input_json_delta' && ev.delta.partial_json != null) {
                  const toolBlock = streamToolBlocks.get(ev.index)
                  if (toolBlock) {
                    toolBlock.input += ev.delta.partial_json
                    controller.enqueue({
                      type: 'tool-input-delta',
                      id: toolBlock.id,
                      delta: ev.delta.partial_json,
                    })
                  }
                }
              } else if (ev.type === 'content_block_stop') {
                const toolBlock = streamToolBlocks.get(ev.index)
                if (toolBlock) {
                  controller.enqueue({ type: 'tool-input-end', id: toolBlock.id })
                  controller.enqueue({
                    type: 'tool-call',
                    toolCallId: toolBlock.id,
                    toolName: toolBlock.name,
                    input: toolBlock.input,
                    providerExecuted: true,
                  })
                  pendingToolCalls.set(toolBlock.id, {
                    toolName: toolBlock.name,
                    input: toolBlock.input,
                  })
                  streamToolBlocks.delete(ev.index)
                } else if (activeStreamTextBlocks.has(ev.index)) {
                  const textId = String(ev.index ?? 0)
                  controller.enqueue({ type: 'text-end', id: textId })
                  activeStreamTextBlocks.delete(ev.index)
                }
              }
            }

            if (msg.type === 'assistant') {
              for (const block of msg.message.content) {
                if (block.type === 'text' && block.text && !sawStreamEventText) {
                  const textId = String(textBlockCounter++)
                  controller.enqueue({ type: 'text-start', id: textId })
                  controller.enqueue({ type: 'text-delta', id: textId, delta: block.text })
                  controller.enqueue({ type: 'text-end', id: textId })
                } else if (block.type === 'tool_use' && !sawStreamEventTool) {
                  const toolName = normalizeToolName(block.name)
                  const inputJson = JSON.stringify(block.input ?? {})
                  controller.enqueue({
                    type: 'tool-input-start',
                    id: block.id,
                    toolName,
                    providerExecuted: true,
                  })
                  controller.enqueue({
                    type: 'tool-input-delta',
                    id: block.id,
                    delta: inputJson,
                  })
                  controller.enqueue({ type: 'tool-input-end', id: block.id })
                  controller.enqueue({
                    type: 'tool-call',
                    toolCallId: block.id,
                    toolName,
                    input: inputJson,
                    providerExecuted: true,
                  })
                  pendingToolCalls.set(block.id, { toolName, input: inputJson })
                }
              }
            }

            if (msg.type === 'user') {
              for (const block of msg.message.content) {
                if (block.type !== 'tool_result') continue
                const toolCall = pendingToolCalls.get(block.tool_use_id)
                if (!toolCall) continue

                controller.enqueue({
                  type: 'tool-result',
                  toolCallId: block.tool_use_id,
                  toolName: toolCall.toolName,
                  result: normalizeToolResultContent(toolCall.toolName, block.content),
                  providerExecuted: true,
                })
                pendingToolCalls.delete(block.tool_use_id)
              }
            }

            const finish = extractFinish(msg)
            if (finish) {
              for (const [toolCallId, toolCall] of pendingToolCalls) {
                controller.enqueue({
                  type: 'tool-result',
                  toolCallId,
                  toolName: toolCall.toolName,
                  result: normalizeToolResultContent(toolCall.toolName, null),
                  providerExecuted: true,
                })
              }
              pendingToolCalls.clear()
              for (const index of streamToolBlocks.keys()) {
                streamToolBlocks.delete(index)
              }
              for (const index of activeStreamTextBlocks) {
                controller.enqueue({ type: 'text-end', id: String(index) })
              }
              activeStreamTextBlocks.clear()
              controller.enqueue(finish)
              hasFinish = true
            }

            const err = extractError(msg)
            if (err) {
              controller.enqueue(err)
              if (!hasFinish) {
                controller.enqueue({
                  type: 'finish',
                  finishReason: 'error',
                  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                })
                hasFinish = true
              }
            }
          }

          // 如果 qoderQuery 正常结束但没有 result 消息，补 finish
          if (!hasFinish) {
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            })
          }
          controller.close()
        } catch (error) {
          controller.enqueue({
            type: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          })
          controller.close()
        }
      },
    })

    return { stream }
  }
}

/**
 * 从一条 SDKMessage 中提取 finish part（仅 result 消息会产生）
 */
function extractFinish(msg: SDKMessage): Extract<LanguageModelV2StreamPart, { type: 'finish' }> | null {
  if (msg.type !== 'result') return null
  const inputTokens = msg.usage?.input_tokens ?? 0
  const outputTokens = msg.usage?.output_tokens ?? 0
  return {
    type: 'finish',
    finishReason: msg.subtype === 'success' ? 'stop' : 'error',
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  }
}

function normalizeToolName(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'askuserquestion') return 'question'
  return lower
}

function normalizeToolResultContent(toolName: string, content: unknown): {
  output: string
  title: string
  metadata: Record<string, unknown>
} {
  return {
    output: typeof content === 'string' ? content : JSON.stringify(content ?? null, null, 2),
    title: toolName,
    metadata: {},
  }
}

/**
 * 从一条 SDKMessage 中提取 error part（暂无 Qoder SDK 错误消息类型）
 */
function extractError(_msg: SDKMessage): Extract<LanguageModelV2StreamPart, { type: 'error' }> | null {
  return null
}

type QoderMcpServerConfig =
  | {
      type?: 'stdio'
      command: string
      args?: string[]
      env?: Record<string, string>
    }
  | {
      type: 'http' | 'sse'
      url: string
      headers?: Record<string, string>
    }

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
  pathToQoderCLIExecutable?: string
  mcpServers?: Record<string, QoderMcpServerConfig>
} {
  const providerOptions = getQoderProviderOptions(options.providerOptions)
  const mcpServers = {
    ...extractMcpServersFromProviderOptions(providerOptions?.mcpServers),
    ...extractMcpServersFromTools(options.tools),
  }

  return {
    model: modelId,
    allowDangerouslySkipPermissions: true,
    permissionMode: 'bypassPermissions',
    ...(cliPath ? { pathToQoderCLIExecutable: cliPath } : {}),
    ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
  }
}

function getQoderProviderOptions(
  providerOptions: LanguageModelV2CallOptions['providerOptions'],
): QoderProviderOptions | undefined {
  if (!isRecord(providerOptions)) return undefined
  const qoderOptions = providerOptions.qoder
  return isRecord(qoderOptions) ? (qoderOptions as QoderProviderOptions) : undefined
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
    const serverConfig = inferProviderDefinedToolServerConfig(tool)
    if (!serverName || !serverConfig) continue

    servers[serverName] = serverConfig
  }

  return servers
}

function inferProviderDefinedToolServerName(tool: LanguageModelV2ProviderDefinedTool): string | undefined {
  const args = isRecord(tool.args) ? tool.args : undefined
  const explicitName =
    pickString(args?.serverName) ??
    pickString(args?.mcpServerName) ??
    pickString(args?.server) ??
    pickString(args?.name)

  if (explicitName) return explicitName

  const [, suffix] = tool.id.split('.', 2)
  return suffix || tool.name
}

function inferProviderDefinedToolServerConfig(
  tool: LanguageModelV2ProviderDefinedTool,
): QoderMcpServerConfig | null {
  return normalizeMcpServerConfig(tool.args)
}

function normalizeMcpServerConfig(config: unknown): QoderMcpServerConfig | null {
  if (!isRecord(config)) return null
  if (config.enabled === false) return null

  if (Array.isArray(config.command) && config.command.every((value) => typeof value === 'string')) {
    if (config.command.length === 0) return null

    const [command, ...args] = config.command
    const env = pickStringRecord(config.environment) ?? pickStringRecord(config.env)

    return {
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(env ? { env } : {}),
    }
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

  if (isRecord(config.mcpServer)) {
    return normalizeMcpServerConfig(config.mcpServer)
  }

  if (isRecord(config.serverConfig)) {
    return normalizeMcpServerConfig(config.serverConfig)
  }

  return null
}

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
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
