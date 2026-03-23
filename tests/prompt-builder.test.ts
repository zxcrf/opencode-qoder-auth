// @ts-nocheck
import { describe, expect, it } from 'vitest'
import { buildPromptFromOptions } from '../src/prompt-builder.js'

const BASE_OPTIONS = { inputFormat: 'prompt', mode: { type: 'regular' } }

describe('buildPromptFromOptions', () => {
  it('纯文本 prompt 返回字符串', () => {
    const prompt = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })

    expect(typeof prompt).toBe('string')
    expect(prompt).toContain('hello')
  })

  it('空 prompt 返回 Hello', () => {
    const prompt = buildPromptFromOptions({ ...BASE_OPTIONS, prompt: [] })
    expect(prompt).toBe('Hello')
  })

  it('system 消息用 <system> 标签包裹', () => {
    const prompt = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ],
    }) as string

    expect(prompt).toContain('<system>')
    expect(prompt).toContain('You are helpful.')
    expect(prompt).toContain('</system>')
    expect(prompt).toContain('hi')
  })

  it('assistant 消息用 <assistant> 标签包裹', () => {
    const prompt = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
        { role: 'user', content: [{ type: 'text', text: 'follow-up' }] },
      ],
    }) as string

    expect(prompt).toContain('<assistant>')
    expect(prompt).toContain('world')
    expect(prompt).toContain('</assistant>')
    expect(prompt).toContain('follow-up')
  })

  it('assistant tool-call 用 <tool_call> 子块序列化', () => {
    const prompt = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'list files' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'tc-1',
              toolName: 'Bash',
              input: { command: 'ls' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'tc-1',
              toolName: 'Bash',
              output: [{ type: 'text', value: 'file.txt\ndir/' }],
            },
          ],
        },
        { role: 'user', content: [{ type: 'text', text: 'what did you find?' }] },
      ],
    }) as string

    expect(prompt).toContain('<tool_call id="tc-1" name="Bash">')
    expect(prompt).toContain('"command":"ls"')
    expect(prompt).toContain('</tool_call>')
    expect(prompt).toContain('<tool_result id="tc-1" name="Bash">')
    expect(prompt).toContain('file.txt')
    expect(prompt).toContain('</tool_result>')
    expect(prompt).toContain('what did you find?')
  })

  it('tool 消息 error-text output 格式化为 [Error] 前缀', () => {
    const prompt = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'tc-2',
              toolName: 'Read',
              output: [{ type: 'error-text', value: 'file not found' }],
            },
          ],
        },
        { role: 'user', content: [{ type: 'text', text: 'ok' }] },
      ],
    }) as string

    expect(prompt).toContain('[Error] file not found')
  })

  it('图片 prompt 返回 AsyncIterable，并产出 image content block', async () => {
    const prompt = buildPromptFromOptions({
      ...BASE_OPTIONS,
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
            { type: 'text', text: 'describe this image' },
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
      { type: 'text', text: 'describe this image' },
    ])
  })

  // === TDD: clipboard image fix (type='file' parts) ===

  it('file part (image mediaType) 触发 AsyncIterable 路径', () => {
    const result = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [{
        role: 'user',
        content: [{
          type: 'file',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1Pe',
          mediaType: 'image/png',
        }],
      }],
    })
    expect(typeof result).not.toBe('string')
  })

  it('file part 裸 base64 data → image content block', async () => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
    const result = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [{
        role: 'user',
        content: [
          { type: 'file', data: b64, mediaType: 'image/png' },
          { type: 'text', text: 'describe this' },
        ],
      }],
    })
    const messages: unknown[] = []
    for await (const msg of result as AsyncIterable<unknown>) messages.push(msg)
    expect((messages[0] as any).message.content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: b64 },
    })
  })

  it('file part data: URL → 正确提取 base64', async () => {
    const b64 = 'abc123=='
    const result = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [{
        role: 'user',
        content: [{ type: 'file', data: `data:image/png;base64,${b64}`, mediaType: 'image/png' }],
      }],
    })
    const messages: unknown[] = []
    for await (const msg of result as AsyncIterable<unknown>) messages.push(msg)
    expect((messages[0] as any).message.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: b64 },
    })
  })

  it('file part Uint8Array → 转换为 base64', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71])
    const result = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [{
        role: 'user',
        content: [{ type: 'file', data: bytes, mediaType: 'image/png' }],
      }],
    })
    const messages: unknown[] = []
    for await (const msg of result as AsyncIterable<unknown>) messages.push(msg)
    const block = (messages[0] as any).message.content[0]
    expect(block.type).toBe('image')
    expect(block.source.type).toBe('base64')
    expect(block.source.media_type).toBe('image/png')
    expect(block.source.data).toBe(Buffer.from(bytes).toString('base64'))
  })

  it('file part 非图片 mediaType 不触发图片路径', () => {
    const result = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [{
        role: 'user',
        content: [{ type: 'file', data: 'aGVsbG8=', mediaType: 'text/plain' }],
      }],
    })
    expect(typeof result).toBe('string')
  })

  it('多模态模式：非 user 历史以 <conversation_history> 注入下一条 user 消息', async () => {
    const prompt = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: [{ type: 'text', text: 'first question' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: 'data:image/png;base64,abc123==',
              mimeType: 'image/png',
            },
            { type: 'text', text: 'second question' },
          ],
        },
      ],
    })

    expect(typeof prompt).not.toBe('string')

    const messages: unknown[] = []
    for await (const message of prompt as AsyncIterable<unknown>) {
      messages.push(message)
    }

    // 第一条 user 消息：前面有 system，所以注入了 <conversation_history>
    const firstContent = messages[0].message.content
    expect(firstContent[0].text).toContain('<conversation_history>')
    expect(firstContent[0].text).toContain('<system>')
    expect(firstContent[0].text).toContain('You are helpful.')
    expect(firstContent[1].text).toContain('first question')

    // 第二条 user 消息前注入了 <conversation_history>（含 assistant 回复）
    const secondContent = messages[1].message.content
    expect(secondContent[0].text).toContain('<conversation_history>')
    expect(secondContent[0].text).toContain('first answer')
    expect(secondContent[1].type).toBe('image')
    expect(secondContent[2].text).toBe('second question')
  })
})
