import type { LanguageModelV2CallOptions, LanguageModelV2Prompt } from '@ai-sdk/provider'
import type { SDKUserMessage } from './bundled-sdk/qoder-agent-sdk.mjs'

/**
 * 从 opencode 传入的 LanguageModelV2CallOptions 中构造 Qoder query 的 prompt。
 *
 * opencode 传入的 prompt 格式为 Vercel AI SDK v2 的 LanguageModelV2Prompt，
 * 包含若干 role=system / user / assistant 的消息。
 *
 * - 纯文本模式：返回字符串（拼接所有内容）
 * - 含图片模式：返回 AsyncIterable<SDKUserMessage>（支持 base64 图片块）
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
      }
    }
  }
  return false
}

/** 纯文本模式：拼接所有消息内容为字符串 */
function buildStringPrompt(prompt: LanguageModelV2Prompt): string {
  const parts: string[] = []

  for (const message of prompt) {
    switch (message.role) {
      case 'system': {
        if (typeof message.content === 'string') {
          parts.push(`[System]\n${message.content}`)
        }
        break
      }
      case 'user': {
        const texts: string[] = []
        if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === 'text') {
              texts.push(part.text)
            }
          }
        }
        if (texts.length > 0) {
          parts.push(texts.join('\n'))
        }
        break
      }
      case 'assistant': {
        const texts: string[] = []
        if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === 'text') {
              texts.push(part.text)
            }
          }
        }
        if (texts.length > 0) {
          parts.push(`[Assistant]\n${texts.join('\n')}`)
        }
        break
      }
    }
  }

  return parts.join('\n\n') || 'Hello'
}

/** 多模态模式：将消息转为 AsyncIterable<SDKUserMessage> */
async function* buildAsyncIterablePrompt(
  prompt: LanguageModelV2Prompt,
): AsyncIterable<SDKUserMessage> {
  for (const message of prompt) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue

    const contentBlocks: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    > = []

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
  }
}
