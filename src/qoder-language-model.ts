import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Usage,
  ProviderV2,
} from '@ai-sdk/provider'

// LanguageModelV2 流式协议 part 类型（@ai-sdk/provider v1.x 尚未导出 V2 StreamPart）
type V2StreamPart =
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'tool-input-start'; id: string; toolName: string }
  | { type: 'tool-input-delta'; id: string; delta: string }
  | { type: 'finish'; finishReason: LanguageModelV2FinishReason; usage: LanguageModelV2Usage }
  | { type: 'error'; error: unknown }
import { query } from './vendor/qoder-agent-sdk.mjs'
import type { SDKMessage } from './vendor/qoder-agent-sdk.mjs'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import os from 'os'
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
    stream: ReadableStream<V2StreamPart>
  }> {
    const prompt = buildPromptFromOptions(options)

    const cliPath = resolveQoderCLI()

    const qoderQuery = query({
      prompt,
      options: {
        model: this.modelId,
        allowDangerouslySkipPermissions: true,
        permissionMode: 'bypassPermissions',
        ...(cliPath ? { pathToQoderCLIExecutable: cliPath } : {}),
      },
    })

    const stream = new ReadableStream<V2StreamPart>({
      start: async (controller) => {
        try {
          let hasFinish = false
          // 每个 assistant text block 独立编号，支持多轮 assistant 消息
          let textBlockCounter = 0
          // stream_event 路径是否已经输出过文本（防止 assistant 路径重复）
          let streamEventTextEmitted = false
          // stream_event 工具调用追踪：记录已发过 tool-input-start 的 block index → id 映射
          const toolBlockIndexToId = new Map<number, string>()

          for await (const msg of qoderQuery) {
            // 路径 A：stream_event（流式模式，CLI 启用 --stream 时）
            // 实时转发增量文本和工具调用片段
            if (msg.type === 'stream_event') {
              const ev = msg.event
              if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
                // 工具调用开始：登记 block index → tool id
                toolBlockIndexToId.set(ev.index, ev.content_block.id)
                controller.enqueue({
                  type: 'tool-input-start',
                  id: ev.content_block.id,
                  toolName: ev.content_block.name,
                })
              } else if (ev.type === 'content_block_delta') {
                if (ev.delta.type === 'text_delta' && ev.delta.text) {
                  // 增量文本：每次 delta 共用同一个 text block id（以 block index 为 key）
                  const textId = String(ev.index ?? 0)
                  if (!streamEventTextEmitted) {
                    controller.enqueue({ type: 'text-start', id: textId })
                  }
                  controller.enqueue({ type: 'text-delta', id: textId, delta: ev.delta.text })
                  streamEventTextEmitted = true
                } else if (ev.delta.type === 'input_json_delta' && ev.delta.partial_json != null) {
                  // 工具调用输入片段
                  const toolId = toolBlockIndexToId.get(ev.index)
                  if (toolId) {
                    controller.enqueue({ type: 'tool-input-delta', id: toolId, delta: ev.delta.partial_json })
                  }
                }
              } else if (ev.type === 'content_block_stop') {
                // 文本 block 结束
                const textId = String(ev.index ?? 0)
                if (streamEventTextEmitted && !toolBlockIndexToId.has(ev.index)) {
                  controller.enqueue({ type: 'text-end', id: textId })
                }
              }
            }

            // 路径 B：assistant 消息（--print 模式，Qoder CLI 实际行为）
            // 只在 stream_event 路径没有输出文本时作为 fallback（防止重复）
            if (msg.type === 'assistant') {
              for (const block of msg.message.content) {
                if (block.type === 'text' && block.text && !streamEventTextEmitted) {
                  // fallback：stream_event 没发文本，从 assistant 消息提取
                  const textId = String(textBlockCounter++)
                  controller.enqueue({ type: 'text-start', id: textId })
                  controller.enqueue({ type: 'text-delta', id: textId, delta: block.text })
                  controller.enqueue({ type: 'text-end', id: textId })
                } else if (block.type === 'tool_use' && !toolBlockIndexToId.size) {
                  // fallback：stream_event 没发工具调用，从 assistant 消息提取
                  controller.enqueue({ type: 'tool-input-start', id: block.id, toolName: block.name })
                  controller.enqueue({
                    type: 'tool-input-delta',
                    id: block.id,
                    delta: JSON.stringify(block.input ?? {}),
                  })
                }
              }
            }

            const finish = extractFinish(msg)
            if (finish) {
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
function extractFinish(msg: SDKMessage): Extract<V2StreamPart, { type: 'finish' }> | null {
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

/**
 * 从一条 SDKMessage 中提取 error part（暂无 Qoder SDK 错误消息类型）
 */
function extractError(_msg: SDKMessage): Extract<V2StreamPart, { type: 'error' }> | null {
  return null
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
