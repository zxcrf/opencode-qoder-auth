import type { LanguageModelV2CallOptions, LanguageModelV2Prompt, LanguageModelV2Message } from '@ai-sdk/provider'
import type { SDKUserMessage } from './vendor/qoder-agent-sdk.mjs'

/**
 * 从 opencode 传入的 LanguageModelV2CallOptions 中构造 Qoder query 的 prompt。
 *
 * opencode 传入的 prompt 格式为 Vercel AI SDK v2 的 LanguageModelV2Prompt，
 * 包含若干 role=system / user / assistant / tool 的消息。
 *
 * - 纯文本模式：返回字符串（序列化完整对话历史，含 tool-call/tool-result）
 * - 含图片模式：返回 AsyncIterable<SDKUserMessage>（支持 base64 图片块，含完整历史）
 */
export function buildPromptFromOptions(
  options: LanguageModelV2CallOptions,
): string | AsyncIterable<SDKUserMessage> {
  if (hasImageContent(options.prompt)) {
    return buildAsyncIterablePrompt(options.prompt)
  }
  return buildStringPrompt(options.prompt)
}

/** 判断 prompt 中是否含有图片内容 */
function hasImageContent(prompt: LanguageModelV2Prompt): boolean {
  for (const message of prompt) {
    if (message.role === 'user' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'image') return true
        if (part.type === 'file' && typeof part.mediaType === 'string' && part.mediaType.startsWith('image/')) return true
      }
    }
  }
  return false
}

/** 序列化工具输出为字符串 */
function serializeToolOutput(output: unknown): string {
  if (output == null) return ''
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    return output
      .map((item) => {
        if (item && typeof item === 'object' && 'type' in item) {
          if (item.type === 'text' && 'value' in item) return String((item as { value: unknown }).value)
          if (item.type === 'json' && 'value' in item) return JSON.stringify((item as { value: unknown }).value)
          if (item.type === 'error-text' && 'value' in item) return `[Error] ${(item as { value: unknown }).value}`
        }
        return JSON.stringify(item)
      })
      .join('\n')
  }
  return JSON.stringify(output)
}

/**
 * 将单条消息序列化为结构化文本块，保留完整对话历史。
 *
 * 格式设计原则：
 * - system 消息用 <system> 标签包裹
 * - user 消息直接输出文本内容
 * - assistant 消息用 <assistant> 标签，含工具调用时附加 <tool_call> 子块
 * - tool 消息（工具结果）用 <tool_result> 标签，含调用 ID 和工具名
 */
function serializeMessage(message: LanguageModelV2Message): string {
  switch (message.role) {
    case 'system': {
      if (typeof message.content === 'string') {
        return `<system>\n${message.content}\n</system>`
      }
      return ''
    }

    case 'user': {
      if (!Array.isArray(message.content)) return ''
      const parts: string[] = []
      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push(part.text)
        }
        // 图片在 buildStringPrompt 路径下不处理（由 hasImageContent 检测后走另一路径）
      }
      return parts.join('\n')
    }

    case 'assistant': {
      if (!Array.isArray(message.content)) return ''
      const parts: string[] = []
      for (const part of message.content) {
        if (part.type === 'text' && part.text) {
          parts.push(part.text)
        } else if (part.type === 'tool-call') {
          const inputStr = typeof part.input === 'string'
            ? part.input
            : JSON.stringify(part.input ?? {})
          parts.push(
            `<tool_call id="${part.toolCallId}" name="${part.toolName}">\n${inputStr}\n</tool_call>`,
          )
        }
      }
      if (parts.length === 0) return ''
      return `<assistant>\n${parts.join('\n')}\n</assistant>`
    }

    case 'tool': {
      if (!Array.isArray(message.content)) return ''
      const parts: string[] = []
      for (const part of message.content) {
        if (part.type === 'tool-result') {
          const outputStr = serializeToolOutput(part.output)
          parts.push(
            `<tool_result id="${part.toolCallId}" name="${part.toolName}">\n${outputStr}\n</tool_result>`,
          )
        }
      }
      return parts.join('\n')
    }

    default:
      return ''
  }
}

/** 纯文本模式：将完整对话历史序列化为结构化字符串 */
export function buildStringPrompt(prompt: LanguageModelV2Prompt): string {
  const parts: string[] = []

  for (const message of prompt) {
    const serialized = serializeMessage(message)
    if (serialized) {
      parts.push(serialized)
    }
  }

  return parts.join('\n\n') || 'Hello'
}

/** 多模态模式：将完整消息历史转为 AsyncIterable<SDKUserMessage>（含图片） */
async function* buildAsyncIterablePrompt(
  prompt: LanguageModelV2Prompt,
): AsyncIterable<SDKUserMessage> {
  // 将非 user 消息以文本方式合并到下一条 user 消息之前，
  // 或在最后一条 user 消息中以 context 前缀附加。
  // SDK 的 stream-json 模式只接受 user 类型消息，
  // 所以先把历史上下文压入第一条 user 消息的文本前缀。
  const contextParts: string[] = []

  for (const message of prompt) {
    if (message.role === 'user' && Array.isArray(message.content)) {
      const contentBlocks: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      > = []

      // 如果有历史上下文，先作为文本前缀注入
      if (contextParts.length > 0) {
        contentBlocks.push({
          type: 'text',
          text: `<conversation_history>\n${contextParts.join('\n\n')}\n</conversation_history>`,
        })
        contextParts.length = 0
      }

      for (const part of message.content) {
        if (part.type === 'text') {
          contentBlocks.push({ type: 'text', text: part.text })
        } else if (part.type === 'image') {
          const { image } = part
          // AI SDK v2 image 可能是 URL、Uint8Array 或 base64 字符串
          if (typeof image === 'string') {
            // base64 data URL: "data:image/png;base64,..."
            const match = image.match(/^data:([^;]+);base64,(.+)$/)
            if (match) {
              contentBlocks.push({
                type: 'image',
                source: { type: 'base64', media_type: match[1], data: match[2] },
              })
            } else {
              // 裸 base64 字符串，假设 JPEG
              contentBlocks.push({
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: image },
              })
            }
          } else if (image instanceof Uint8Array) {
            // 二进制数据，转 base64
            const base64 = Buffer.from(image).toString('base64')
            const mediaType = part.mimeType ?? 'image/jpeg'
            contentBlocks.push({
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            })
          }
        } else if (part.type === 'file' && typeof part.mediaType === 'string' && part.mediaType.startsWith('image/')) {
          // clipboard / --file 图片，AI SDK v2 以 type='file' 传入
          const { data, mediaType } = part
          let base64Data: string
          let resolvedMediaType = mediaType
          if (data instanceof Uint8Array) {
            base64Data = Buffer.from(data).toString('base64')
          } else if (typeof data === 'string') {
            const match = data.match(/^data:([^;]+);base64,(.+)$/)
            if (match) {
              resolvedMediaType = match[1]
              base64Data = match[2]
            } else {
              // 裸 base64 字符串
              base64Data = data
            }
          } else {
            // URL 对象
            const urlStr = (data as URL).toString()
            const match = urlStr.match(/^data:([^;]+);base64,(.+)$/)
            if (match) {
              resolvedMediaType = match[1]
              base64Data = match[2]
            } else {
              continue // HTTP URL 暂不支持
            }
          }
          contentBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: resolvedMediaType, data: base64Data },
          })
        }
      }

      if (contentBlocks.length > 0) {
        yield {
          type: 'user',
          session_id: '',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: contentBlocks,
          },
        } as SDKUserMessage
      }
    } else {
      // 非 user 消息：序列化后存入上下文缓冲，待下条 user 消息时注入
      const serialized = serializeMessage(message)
      if (serialized) {
        contextParts.push(serialized)
      }
    }
  }
}
