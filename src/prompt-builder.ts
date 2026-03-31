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
  // 找到最后一条 user 消息的位置
  let lastUserIdx = -1
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i].role === 'user') { lastUserIdx = i; break }
  }

  if (lastUserIdx === -1) return 'Hello'

  // 将最后一条 user 消息之前的历史序列化
  const historyParts = serializePromptRange(prompt, 0, lastUserIdx)

  // 当前任务：最后一条 user 消息
  const currentMsg = serializeMessage(prompt[lastUserIdx])

  // 最后一条 user 之后可能还有 assistant/tool 消息（如 tool-call/tool-result），
  // 它们属于已发生的后续上下文，需按原始顺序保留，不能丢弃。
  const trailingParts = serializePromptRange(prompt, lastUserIdx + 1, prompt.length)

  if (historyParts.length > 0) {
    const segments = [
      `<conversation_history>\n${historyParts.join('\n\n')}\n</conversation_history>`,
      currentMsg,
    ]
    if (trailingParts.length > 0) {
      segments.push(`<conversation_continuation>\n${trailingParts.join('\n\n')}\n</conversation_continuation>`)
    }
    return segments.filter(Boolean).join('\n\n')
  }
  if (trailingParts.length > 0) {
    return [
      currentMsg,
      `<conversation_continuation>\n${trailingParts.join('\n\n')}\n</conversation_continuation>`,
    ].filter(Boolean).join('\n\n')
  }
  return currentMsg || 'Hello'
}

/** 多模态模式：将完整消息历史转为 AsyncIterable<SDKUserMessage>（含图片） */
async function* buildAsyncIterablePrompt(
  prompt: LanguageModelV2Prompt,
): AsyncIterable<SDKUserMessage> {
  // 只产出最后一条 user 消息，避免 SDK 因多条用户消息而在第一条 result 后终止。
  // 历史（最后一条 user 消息之前的所有消息）序列化后作为 <conversation_history> 前缀注入。
  let lastUserIdx = -1
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i].role === 'user') { lastUserIdx = i; break }
  }
  if (lastUserIdx === -1) return

  // 构建历史前缀（最后一条 user 之前的消息）
  const historyParts = serializePromptRange(prompt, 0, lastUserIdx)

  // 最后一条 user 之后可能还有 assistant/tool 消息（如 tool-call/tool-result），
  // 它们属于已发生的后续上下文，需按原始顺序保留，不能丢弃。
  const trailingParts = serializePromptRange(prompt, lastUserIdx + 1, prompt.length)

  const contentBlocks: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  > = []

  // 注入历史前缀
  if (historyParts.length > 0) {
    contentBlocks.push({
      type: 'text',
      text: `<conversation_history>\n${historyParts.join('\n\n')}\n</conversation_history>`,
    })
  }

  // 处理最后一条 user 消息的内容块
  const lastMsg = prompt[lastUserIdx]
  if (lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
    for (const part of lastMsg.content) {
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
  }

  if (trailingParts.length > 0) {
    contentBlocks.push({
      type: 'text',
      text: `<conversation_continuation>\n${trailingParts.join('\n\n')}\n</conversation_continuation>`,
    })
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
}

function serializePromptRange(
  prompt: LanguageModelV2Prompt,
  start: number,
  end: number,
): string[] {
  const parts: string[] = []
  for (let i = start; i < end; i++) {
    const serialized = serializeMessage(prompt[i])
    if (serialized) parts.push(serialized)
  }
  return parts
}
