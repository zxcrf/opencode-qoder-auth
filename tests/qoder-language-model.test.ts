import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider'

// mock @ali/qoder-agent-sdk
const mockQueryMessages: any[] = []
const mockQuery = vi.fn(() => {
  // 返回一个 async generator
  return (async function* () {
    for (const msg of mockQueryMessages) {
      yield msg
    }
  })()
})

vi.mock('../src/vendor/qoder-agent-sdk.mjs', () => ({
  query: mockQuery,
  IntegrationMode: { QoderWork: 'qoder_work', Quest: 'quest' },
}))

describe('QoderLanguageModel', () => {
  let QoderLanguageModel: any

  beforeEach(async () => {
    vi.resetModules()
    mockQueryMessages.length = 0
    mockQuery.mockClear()
    const mod = await import('../src/qoder-language-model.js')
    QoderLanguageModel = mod.QoderLanguageModel
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('基本属性', () => {
    it('specificationVersion 为 v2', () => {
      const model = new QoderLanguageModel('auto')
      expect(model.specificationVersion).toBe('v2')
    })

    it('provider 为 qoder', () => {
      const model = new QoderLanguageModel('auto')
      expect(model.provider).toBe('qoder')
    })

    it('modelId 正确设置', () => {
      const model = new QoderLanguageModel('performance')
      expect(model.modelId).toBe('performance')
    })
  })

  describe('doStream', () => {
    // SDK 实际行为：只发 assistant 消息，不发 stream_event
    // (--print 模式下，qodercli 直接返回完整消息)
    it('assistant 消息文本正确输出为 text-delta', async () => {
      mockQueryMessages.push({
        type: 'assistant',
        uuid: 'uuid-1',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello, world!' }],
        },
      })
      mockQueryMessages.push({
        type: 'result',
        subtype: 'success',
        uuid: 'uuid-2',
        session_id: 'sess-1',
        result: 'Hello, world!',
        duration_ms: 100,
        duration_api_ms: 80,
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0,
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
      })

      const model = new QoderLanguageModel('auto')
      const { stream } = await model.doStream(buildCallOptions('Say hello'))
      const parts = await collectStream(stream)

      const textDeltas = parts.filter((p: any) => p.type === 'text-delta')
      expect(textDeltas.length).toBeGreaterThan(0)
      const text = textDeltas.map((p: any) => p.delta).join('')
      expect(text).toContain('Hello')
    })

    it('多轮 assistant 消息文本按顺序输出', async () => {
      // 工具调用场景：assistant(tool_use) → user(tool_result) → assistant(text)
      mockQueryMessages.push({
        type: 'assistant',
        uuid: 'uuid-1',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      })
      mockQueryMessages.push({
        type: 'user',
        uuid: 'uuid-2',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file.txt' }],
        },
      })
      mockQueryMessages.push({
        type: 'assistant',
        uuid: 'uuid-3',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done!' }],
        },
      })
      mockQueryMessages.push({
        type: 'result',
        subtype: 'success',
        uuid: 'uuid-4',
        session_id: 'sess-1',
        result: 'Done!',
        duration_ms: 200,
        duration_api_ms: 150,
        is_error: false,
        num_turns: 2,
        total_cost_usd: 0,
        usage: { input_tokens: 20, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
      })

      const model = new QoderLanguageModel('auto')
      const { stream } = await model.doStream(buildCallOptions('test'))
      const parts = await collectStream(stream)

      const textDeltas = parts.filter((p: any) => p.type === 'text-delta')
      const text = textDeltas.map((p: any) => p.delta).join('')
      expect(text).toBe('Done!')

      // 工具调用也应该出现，并标记为 providerExecuted，避免 opencode 重复执行
      const toolStart = parts.find((p: any) => p.type === 'tool-input-start')
      expect(toolStart).toBeDefined()
      expect(toolStart.toolName).toBe('bash')
      expect(toolStart.providerExecuted).toBe(true)
    })

    it('result success 输出 finish 事件', async () => {
      mockQueryMessages.push({
        type: 'result',
        subtype: 'success',
        uuid: 'uuid-2',
        session_id: 'sess-1',
        result: '',
        duration_ms: 50,
        duration_api_ms: 40,
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0,
        usage: { input_tokens: 5, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
      })

      const model = new QoderLanguageModel('auto')
      const { stream } = await model.doStream(buildCallOptions('test'))
      const parts = await collectStream(stream)

      const finish = parts.find((p: any) => p.type === 'finish')
      expect(finish).toBeDefined()
      expect(finish.finishReason).toBe('stop')
    })

    it('result error 输出 finish reason=error', async () => {
      mockQueryMessages.push({
        type: 'result',
        subtype: 'error_during_execution',
        uuid: 'uuid-2',
        session_id: 'sess-1',
        duration_ms: 50,
        duration_api_ms: 40,
        is_error: true,
        num_turns: 1,
        total_cost_usd: 0,
        usage: { input_tokens: 5, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        errors: ['Something went wrong'],
      })

      const model = new QoderLanguageModel('auto')
      const { stream } = await model.doStream(buildCallOptions('test'))
      const parts = await collectStream(stream)

      const finish = parts.find((p: any) => p.type === 'finish')
      expect(finish).toBeDefined()
      expect(finish.finishReason).toBe('error')
    })

    it('assistant 消息 tool_use block 输出完整工具调用链，且标记 providerExecuted', async () => {
      // SDK 实际场景：assistant 消息包含 tool_use block，后面 user 消息带 tool_result
      mockQueryMessages.push({
        type: 'assistant',
        uuid: 'uuid-1',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_abc123',
              name: 'Bash',
              input: { command: 'ls -la' },
            },
          ],
        },
      })
      mockQueryMessages.push({
        type: 'user',
        uuid: 'uuid-1b',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_abc123', content: 'total 0\n' }],
        },
      })
      mockQueryMessages.push({
        type: 'result',
        subtype: 'success',
        uuid: 'uuid-2',
        session_id: 'sess-1',
        result: '',
        duration_ms: 100,
        duration_api_ms: 80,
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0,
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
      })

      const model = new QoderLanguageModel('auto')
      const { stream } = await model.doStream(buildCallOptions('run bash'))
      const parts = await collectStream(stream)

      const toolStart = parts.find((p: any) => p.type === 'tool-input-start')
      expect(toolStart).toBeDefined()
      expect(toolStart.id).toBe('toolu_abc123')
      expect(toolStart.toolName).toBe('bash')
      expect(toolStart.providerExecuted).toBe(true)

      const toolDeltas = parts.filter((p: any) => p.type === 'tool-input-delta')
      expect(toolDeltas.length).toBe(1)
      const parsed = JSON.parse(toolDeltas[0].delta)
      expect(parsed.command).toBe('ls -la')

      const toolEnd = parts.find((p: any) => p.type === 'tool-input-end')
      expect(toolEnd).toBeDefined()
      expect(toolEnd.id).toBe('toolu_abc123')

      const toolCall = parts.find((p: any) => p.type === 'tool-call')
      expect(toolCall).toBeDefined()
      expect(toolCall.toolCallId).toBe('toolu_abc123')
      expect(toolCall.toolName).toBe('bash')
      expect(toolCall.providerExecuted).toBe(true)
      const inputParsed = JSON.parse(toolCall.input)
      expect(inputParsed.command).toBe('ls -la')

      const toolResult = parts.find((p: any) => p.type === 'tool-result')
      expect(toolResult).toBeDefined()
      expect(toolResult.toolCallId).toBe('toolu_abc123')
      expect(toolResult.toolName).toBe('bash')
      expect(toolResult.providerExecuted).toBe(true)
      expect(toolResult.result).toEqual({
        output: 'total 0\n',
        title: 'bash',
        metadata: {},
      })

      const idxStart = parts.findIndex((p: any) => p.type === 'tool-input-start')
      const idxDelta = parts.findIndex((p: any) => p.type === 'tool-input-delta')
      const idxEnd = parts.findIndex((p: any) => p.type === 'tool-input-end')
      const idxCall = parts.findIndex((p: any) => p.type === 'tool-call')
      const idxResult = parts.findIndex((p: any) => p.type === 'tool-result')
      expect(idxStart).toBeLessThan(idxDelta)
      expect(idxDelta).toBeLessThan(idxEnd)
      expect(idxEnd).toBeLessThan(idxCall)
      expect(idxCall).toBeLessThan(idxResult)
    })

    it('stream_event 路径 tool_use block 输出完整工具调用链和 providerExecuted', async () => {
      // 流式路径：SDK 发送 content_block_start/delta/stop 事件
      mockQueryMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_stream1', name: 'Read', input: {} },
        },
      })
      mockQueryMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"path":"/tmp"}' },
        },
      })
      mockQueryMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      })
      mockQueryMessages.push({
        type: 'user',
        uuid: 'uuid-u',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_stream1', content: 'file body' }],
        },
      })
      mockQueryMessages.push({
        type: 'result',
        subtype: 'success',
        uuid: 'uuid-r',
        session_id: 'sess-1',
        result: '',
        duration_ms: 100,
        duration_api_ms: 80,
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0,
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
      })

      const model = new QoderLanguageModel('auto')
      const { stream } = await model.doStream(buildCallOptions('read file'))
      const parts = await collectStream(stream)

      const toolEnd = parts.find((p: any) => p.type === 'tool-input-end')
      expect(toolEnd).toBeDefined()
      expect(toolEnd.id).toBe('toolu_stream1')

      const toolCall = parts.find((p: any) => p.type === 'tool-call')
      expect(toolCall).toBeDefined()
      expect(toolCall.toolCallId).toBe('toolu_stream1')
      expect(toolCall.toolName).toBe('read')
      expect(toolCall.providerExecuted).toBe(true)

      const toolResult = parts.find((p: any) => p.type === 'tool-result')
      expect(toolResult).toBeDefined()
      expect(toolResult.toolCallId).toBe('toolu_stream1')
      expect(toolResult.toolName).toBe('read')
      expect(toolResult.providerExecuted).toBe(true)
      expect(toolResult.result).toEqual({
        output: 'file body',
        title: 'read',
        metadata: {},
      })
    })

    it('AskUserQuestion 会规范为 question', async () => {
      mockQueryMessages.push({
        type: 'assistant',
        uuid: 'uuid-q1',
        session_id: 'sess-q',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_question1',
              name: 'AskUserQuestion',
              input: { question: '继续吗？' },
            },
          ],
        },
      })
      mockQueryMessages.push({
        type: 'user',
        uuid: 'uuid-q2',
        session_id: 'sess-q',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_question1', content: '好的' }],
        },
      })
      mockQueryMessages.push({
        type: 'result',
        subtype: 'success',
        uuid: 'uuid-q3',
        session_id: 'sess-q',
        result: '',
        duration_ms: 10,
        duration_api_ms: 8,
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0,
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
      })

      const model = new QoderLanguageModel('auto')
      const { stream } = await model.doStream(buildCallOptions('ask user'))
      const parts = await collectStream(stream)

      const toolCall = parts.find((p: any) => p.type === 'tool-call')
      expect(toolCall).toBeDefined()
      expect(toolCall.toolName).toBe('question')
    })

    it('system init 消息被忽略（不产生输出）', async () => {
      mockQueryMessages.push({
        type: 'system',
        subtype: 'init',
        uuid: 'uuid-1',
        session_id: 'sess-1',
        apiKeySource: 'user',
        cwd: '/tmp',
        tools: [],
        mcp_servers: [],
        model: 'auto',
        permissionMode: 'default',
        slash_commands: [],
        output_style: 'default',
      })
      mockQueryMessages.push({
        type: 'result',
        subtype: 'success',
        uuid: 'uuid-2',
        session_id: 'sess-1',
        result: '',
        duration_ms: 50,
        duration_api_ms: 40,
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0,
        usage: { input_tokens: 5, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
      })

      const model = new QoderLanguageModel('auto')
      const { stream } = await model.doStream(buildCallOptions('test'))
      const parts = await collectStream(stream)

      const textDeltas = parts.filter((p: any) => p.type === 'text-delta')
      expect(textDeltas.length).toBe(0)
    })

    it('使用 options.model 调用 query', async () => {
      mockQueryMessages.push({
        type: 'result',
        subtype: 'success',
        uuid: 'uuid-1',
        session_id: 'sess-1',
        result: '',
        duration_ms: 10,
        duration_api_ms: 8,
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0,
        usage: { input_tokens: 1, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
      })

      const model = new QoderLanguageModel('ultimate')
      const { stream } = await model.doStream(buildCallOptions('ping'))
      await collectStream(stream)

      expect(mockQuery).toHaveBeenCalledOnce()
      const callArgs = mockQuery.mock.calls[0][0]
      expect(callArgs.options?.model).toBe('ultimate')
    })

    it('doGenerate 返回完整文本', async () => {
      mockQueryMessages.push({
        type: 'assistant',
        uuid: 'uuid-1',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'generated response' }],
        },
      })
      mockQueryMessages.push({
        type: 'result',
        subtype: 'success',
        uuid: 'uuid-2',
        session_id: 'sess-1',
        result: 'generated response',
        duration_ms: 100,
        duration_api_ms: 80,
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0,
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
      })

      const model = new QoderLanguageModel('auto')
      const result = await model.doGenerate(buildCallOptions('generate test'))

      const textContent = result.content.find((c: any) => c.type === 'text')
      expect(textContent?.text).toContain('generated response')
      expect(result.finishReason).toBe('stop')
    })
  })
})

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildCallOptions(userText: string): LanguageModelV2CallOptions {
  return {
    inputFormat: 'prompt',
    mode: { type: 'regular' },
    prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text: userText }],
      },
    ],
  }
}

async function collectStream(
  stream: ReadableStream<LanguageModelV2StreamPart>,
): Promise<LanguageModelV2StreamPart[]> {
  const parts: LanguageModelV2StreamPart[] = []
  const reader = stream.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}
