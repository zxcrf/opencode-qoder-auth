// @ts-nocheck
import { describe, expect, it } from 'vitest'
import { buildPromptFromOptions } from '../src/prompt-builder.js'

describe('buildPromptFromOptions', () => {
  it('纯文本 prompt 返回字符串', () => {
    const prompt = buildPromptFromOptions({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
        },
      ],
    })

    expect(typeof prompt).toBe('string')
    expect(prompt).toContain('hello')
  })

  it('图片 prompt 返回 AsyncIterable，并产出 image content block', async () => {
    const prompt = buildPromptFromOptions({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
              mimeType: 'image/png',
            },
            {
              type: 'text',
              text: 'describe this image',
            },
          ],
        },
      ],
    })

    expect(typeof prompt).not.toBe('string')

    const messages: unknown[] = []
    for await (const message of prompt as AsyncIterable<unknown>) {
      messages.push(message)
    }

    expect(messages).toHaveLength(1)
    expect(messages[0].message.content).toEqual([
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
        },
      },
      {
        type: 'text',
        text: 'describe this image',
      },
    ])
  })
})
