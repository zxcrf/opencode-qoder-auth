/**
 * 真实 API 集成测试
 * 需要有效的 Qoder CLI 认证（~/.qoder/.auth/user）
 *
 * 运行方式：
 *   pnpm --filter opencode-qoder-provider test:integration
 * 或：
 *   cd packages/opencode-qoder-provider && bun vitest run tests/integration
 */
import { describe, it, expect } from 'vitest'
import { QoderLanguageModel } from '../../src/qoder-language-model.js'

// 设置较长超时，真实 API 调用可能需要 30s+
const TIMEOUT = 60_000

describe('Qoder Real API Integration', { timeout: TIMEOUT }, () => {
  it('should respond to a simple text prompt with lite model', async () => {
    const model = new QoderLanguageModel('lite')

    const result = await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Reply with exactly one word: PONG',
            },
          ],
        },
      ],
    })

    console.log('[integration] result:', JSON.stringify(result, null, 2))

    expect(result.content).toBeDefined()
    expect(result.content.length).toBeGreaterThan(0)

    const textParts = result.content.filter((c) => c.type === 'text')
    expect(textParts.length).toBeGreaterThan(0)

    const fullText = textParts.map((c) => (c as { type: 'text'; text: string }).text).join('')
    console.log('[integration] response text:', fullText)

    expect(fullText.toLowerCase()).toContain('pong')
  })

  it('should stream text delta events', async () => {
    const model = new QoderLanguageModel('lite')

    const { stream } = await model.doStream({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Say "hello world" and nothing else.',
            },
          ],
        },
      ],
    })

    const reader = stream.getReader()
    const parts: Array<{ type: string; [key: string]: unknown }> = []

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      parts.push(value as { type: string; [key: string]: unknown })
    }

    console.log('[integration] stream parts:', JSON.stringify(parts, null, 2))

    const textDeltas = parts.filter((p) => p.type === 'text-delta')
    const finish = parts.find((p) => p.type === 'finish')

    expect(textDeltas.length).toBeGreaterThan(0)
    expect(finish).toBeDefined()

    const fullText = textDeltas.map((p) => p.delta as string).join('')
    console.log('[integration] streamed text:', fullText)
    expect(fullText.toLowerCase()).toContain('hello')
  })

  it('should handle multimodal image input (auto model)', async () => {
    // 1x1 红色像素 PNG (base64, RGB=255,0,0, 有效 checksum)
    const RED_1x1_PNG =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

    // auto 模型支持多模态
    const model = new QoderLanguageModel('auto')

    const result = await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: `data:image/png;base64,${RED_1x1_PNG}`,
              mimeType: 'image/png',
            },
            {
              type: 'text',
              text: 'What color is this image? Reply with one word.',
            },
          ],
        },
      ],
    })

    console.log('[integration] multimodal result:', JSON.stringify(result, null, 2))

    expect(result.content).toBeDefined()
    const textParts = result.content.filter((c) => c.type === 'text')
    expect(textParts.length).toBeGreaterThan(0)

    const fullText = textParts.map((c) => (c as { type: 'text'; text: string }).text).join('')
    console.log('[integration] multimodal response:', fullText)
    // 验证多模态图片传输链路正常（模型能返回文字内容即可）
    expect(fullText.length).toBeGreaterThan(0)
  })
})
