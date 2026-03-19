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

      // 工具调用也应该出现
      const toolStart = parts.find((p: any) => p.type === 'tool-input-start')
      expect(toolStart).toBeDefined()
      expect(toolStart.toolName).toBe('Bash')
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

    it('assistant 消息 tool_use block 输出 tool-input-start 和 tool-input-delta', async () => {
      // SDK 实际场景：assistant 消息包含 tool_use block
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
      expect(toolStart.toolName).toBe('Bash')

      const toolDeltas = parts.filter((p: any) => p.type === 'tool-input-delta')
      expect(toolDeltas.length).toBe(1)
      const parsed = JSON.parse(toolDeltas[0].delta)
      expect(parsed.command).toBe('ls -la')
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
