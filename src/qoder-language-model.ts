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
  IntegrationMode,
  QoderAgentSDKClient,
} from './vendor/qoder-agent-sdk.mjs'

import { buildStringPrompt } from './prompt-builder.js'

// ── SDK 全局配置 — 使用 ~/.qoder 认证目录，Quest 模式 ─────────────────────────
configure({
  storageDir: path.join(os.homedir(), '.qoder'),
  integrationMode: IntegrationMode.Quest,
})

// ── qodercli 二进制路径解析 ───────────────────────────────────────────────────

function resolveQoderCLI(): string | undefined {
  // 优先：~/.qoder/bin/qodercli/qodercli-<version>
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

function buildMcpServers(
  options: LanguageModelV2CallOptions,
): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {}

  // 从 providerOptions.qoder.mcpServers 提取
  const providerOptions = getQoderProviderOptions(options.providerOptions)
  if (isRecord(providerOptions?.mcpServers)) {
    for (const [name, cfg] of Object.entries(providerOptions.mcpServers)) {
      const normalized = normalizeMcpConfig(cfg)
      if (normalized) result[name] = normalized
    }
  }

  // 从 tools 中的 provider-defined 提取
  for (const tool of options.tools ?? []) {
    if (tool.type !== 'provider-defined') continue
    const name = inferServerName(tool)
    const cfg = normalizeMcpConfig(tool.args)
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

function normalizeMcpConfig(config: unknown): McpServerConfig | null {
  if (!isRecord(config)) return null
  if (config.enabled === false) return null

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
        const textId = '0'
        let textStarted = false
        let hasFinish = false

        const enqueueFinish = (
          finishReason: LanguageModelV2FinishReason,
          usage?: LanguageModelV2Usage,
        ) => {
          if (hasFinish) return
          if (textStarted) {
            controller.enqueue({ type: 'text-end', id: textId })
            textStarted = false
          }
          controller.enqueue({
            type: 'finish',
            finishReason,
            usage: usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          })
          hasFinish = true
        }

        const client = new QoderAgentSDKClient({
          model: this.modelId,
          cwd: process.cwd(),
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          disallowedTools: ['*'],
          ...(cliPath ? { pathToQoderCLIExecutable: cliPath } : {}),
          ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
        })

        try {
          await client.connect()
          await client.query(prompt, randomUUID())

          for await (const msg of client.receiveMessages()) {
            const m = msg as Record<string, unknown>

            if (m.type === 'stream_event') {
              // 增量文本 delta
              const event = m.event as Record<string, unknown> | undefined
              if (
                event?.type === 'content_block_delta' &&
                isRecord(event.delta) &&
                event.delta.type === 'text_delta' &&
                typeof event.delta.text === 'string' &&
                event.delta.text
              ) {
                if (!textStarted) {
                  controller.enqueue({ type: 'text-start', id: textId })
                  textStarted = true
                }
                controller.enqueue({ type: 'text-delta', id: textId, delta: event.delta.text })
              }
            } else if (m.type === 'result') {
              // 会话结束
              const isError =
                m.is_error === true ||
                (typeof m.subtype === 'string' && m.subtype !== 'success')

              if (isError) {
                const errMsg =
                  typeof m.subtype === 'string' ? m.subtype : 'error_during_execution'
                controller.enqueue({
                  type: 'error',
                  error: new Error(`Qoder SDK: ${errMsg}`),
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
            }
            // type: 'assistant' (完整消息块) — stream_event 已经覆盖增量，忽略
            // type: 'user' / 'system' — 忽略
          }

          if (!hasFinish) enqueueFinish('stop')
          controller.close()
        } catch (err) {
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
