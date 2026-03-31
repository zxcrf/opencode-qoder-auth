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

  it('多模态模式：只产出最后一条 user 消息，完整历史注入为 <conversation_history> 前缀', async () => {
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

    // 修复后：只产出 1 条 SDKUserMessage（最后一条 user 消息），而非多条
    expect(messages).toHaveLength(1)

    const content = (messages[0] as any).message.content
    // 第一块：包含全量历史（system + first question + first answer）的 <conversation_history>
    expect(content[0].type).toBe('text')
    expect(content[0].text).toContain('<conversation_history>')
    expect(content[0].text).toContain('<system>')
    expect(content[0].text).toContain('You are helpful.')
    expect(content[0].text).toContain('first question')
    expect(content[0].text).toContain('first answer')
    // 第二块：图片
    expect(content[1].type).toBe('image')
    // 第三块：当前问题文本
    expect(content[2].text).toBe('second question')
  })

  // === 回归测试：最后一条 user 之后的 assistant/tool 消息不应被丢弃 ===

  it('[回归] 纯文本路径：最后一条 user 后的 tool-call/tool-result 应保留在历史中', () => {
    // 场景：user 发起请求 → assistant 发起 tool-call → tool 返回结果
    // 此时模型被再次调用，prompt 末尾是 tool 消息而非 user 消息，
    // 但最后一条 user 消息之后的 assistant/tool 不应被丢弃。
    const prompt = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'list files please' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'tc-reg-1',
              toolName: 'Bash',
              input: { command: 'ls /tmp' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'tc-reg-1',
              toolName: 'Bash',
              output: [{ type: 'text', value: 'a.txt\nb.txt' }],
            },
          ],
        },
        // 注意：此处没有再追加新的 user 消息，最后一条 user 是 "list files please"
      ],
    }) as string

    // 最后一条 user 消息应作为当前任务
    expect(prompt).toContain('list files please')
    // assistant 的 tool-call 不能被丢弃
    expect(prompt).toContain('<tool_call id="tc-reg-1" name="Bash">')
    expect(prompt).toContain('"command":"ls /tmp"')
    expect(prompt).toContain('</tool_call>')
    // tool-result 不能被丢弃
    expect(prompt).toContain('<tool_result id="tc-reg-1" name="Bash">')
    expect(prompt).toContain('a.txt')
    expect(prompt).toContain('b.txt')
    expect(prompt).toContain('</tool_result>')
    // 后缀消息必须作为 continuation 保留，且顺序在当前 user 之后
    expect(prompt).toContain('<conversation_continuation>')
    const currentMsgPos = prompt.indexOf('list files please')
    const continuationStart = prompt.indexOf('<conversation_continuation>')
    const continuationEnd = prompt.indexOf('</conversation_continuation>')
    const toolCallPos = prompt.indexOf('<tool_call id="tc-reg-1"')
    const toolResultPos = prompt.indexOf('<tool_result id="tc-reg-1"')
    expect(continuationStart).toBeGreaterThan(currentMsgPos)
    expect(toolCallPos).toBeGreaterThan(continuationStart)
    expect(toolCallPos).toBeLessThan(continuationEnd)
    expect(toolResultPos).toBeGreaterThan(continuationStart)
    expect(toolResultPos).toBeLessThan(continuationEnd)
  })

  it('[回归] 多模态路径：带图片的最后 user 后有 tool-call/tool-result，应保留且只产出 1 条 SDKUserMessage', async () => {
    // 场景：多模态对话中，用户上传图片提问后，assistant 调用了工具并拿到结果，
    // 随后模型被再次调用。此时最后一条 user 消息含图片，
    // 其后的 assistant tool-call + tool-result 不应被丢弃，且整体只能产出 1 条 SDKUserMessage。
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
    const result = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [
        { role: 'system', content: 'You are a vision assistant.' },
        {
          role: 'user',
          content: [
            { type: 'image', image: `data:image/png;base64,${b64}`, mimeType: 'image/png' },
            { type: 'text', text: 'what is in this image?' },
          ],
        },
        // 最后一条 user 之后：assistant 发起 tool-call，tool 返回结果
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'tc-mm-1',
              toolName: 'Describe',
              input: { detail: 'high' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'tc-mm-1',
              toolName: 'Describe',
              output: [{ type: 'text', value: 'A red circle on white background.' }],
            },
          ],
        },
      ],
    })

    // 必须走 AsyncIterable 路径（因为有图片）
    expect(typeof result).not.toBe('string')

    const messages: unknown[] = []
    for await (const msg of result as AsyncIterable<unknown>) {
      messages.push(msg)
    }

    // 只产出 1 条 SDKUserMessage
    expect(messages).toHaveLength(1)

    const content = (messages[0] as any).message.content as Array<{ type: string; text?: string; source?: unknown }>

    // 第一块：<conversation_history> 文本前缀，包含 system 历史
    expect(content[0].type).toBe('text')
    expect(content[0].text).toContain('<conversation_history>')
    expect(content[0].text).toContain('<system>')
    expect(content[0].text).toContain('You are a vision assistant.')

    // 第二块：图片
    expect(content[1].type).toBe('image')
    expect((content[1] as any).source).toEqual({
      type: 'base64',
      media_type: 'image/png',
      data: b64,
    })

    // 第三块：当前问题文本
    expect(content[2].type).toBe('text')
    expect(content[2].text).toBe('what is in this image?')

    // 第四块：后缀 continuation，保留 tool-call/tool-result，且顺序在当前 user 内容之后
    expect(content[3].type).toBe('text')
    expect(content[3].text).toContain('<conversation_continuation>')
    expect(content[3].text).toContain('<tool_call id="tc-mm-1" name="Describe">')
    expect(content[3].text).toContain('<tool_result id="tc-mm-1" name="Describe">')
    expect(content[3].text).toContain('A red circle on white background.')
  })

  it('buildStringPrompt 多轮对话：历史包在 <conversation_history>，末条 user 消息作为主任务', () => {
    const prompt = buildPromptFromOptions({
      ...BASE_OPTIONS,
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'first question' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
        { role: 'user', content: [{ type: 'text', text: 'second question' }] },
      ],
    }) as string

    // 历史应包在 <conversation_history> 标签中
    expect(prompt).toContain('<conversation_history>')
    expect(prompt).toContain('first question')
    expect(prompt).toContain('<assistant>')
    expect(prompt).toContain('first answer')
    expect(prompt).toContain('</conversation_history>')
    // 末条 user 消息在历史块之外（不重复嵌套）
    const historyEnd = prompt.indexOf('</conversation_history>')
    const secondQuestionPos = prompt.lastIndexOf('second question')
    expect(secondQuestionPos).toBeGreaterThan(historyEnd)
  })
})
