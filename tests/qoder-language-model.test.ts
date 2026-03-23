// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider'

// ── Mock vendor SDK ──────────────────────────────────────────────────────────
// 控制每个测试推送的 SDKMessage 事件
const mockMessages: unknown[] = []

// 记录最近一次 query() 调用时的参数
let lastQueryParams: { prompt: unknown; options: unknown } | null = null

// 控制 query() 是否抛出异常
let mockQueryError: Error | null = null

const mockQueryFn = vi.fn((params: { prompt: unknown; options: unknown }) => {
  lastQueryParams = params
  if (mockQueryError) {
    throw mockQueryError
  }
  return (async function* () {
    for (const msg of mockMessages) {
      yield msg
    }
  })()
})

vi.mock('../src/vendor/qoder-agent-sdk.mjs', () => ({
  configure: vi.fn(),
  IntegrationMode: { Quest: 'quest', QoderWork: 'qoder_work' },
  query: mockQueryFn,
}))

// ── Test suite ───────────────────────────────────────────────────────────────

describe('QoderLanguageModel', () => {
  let QoderLanguageModel: unknown

  beforeEach(async () => {
    vi.resetModules()
    mockMessages.length = 0
    lastQueryParams = null
    mockQueryError = null
    mockQueryFn.mockClear()
    // 重新注册 mock，使 resetModules 后的新 import 依然生效
    vi.mock('../src/vendor/qoder-agent-sdk.mjs', () => ({
      configure: vi.fn(),
      IntegrationMode: { Quest: 'quest', QoderWork: 'qoder_work' },
      query: mockQueryFn,
    }))
    const mod = await import('../src/qoder-language-model.js')
    QoderLanguageModel = mod.QoderLanguageModel
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── 基本属性 ──────────────────────────────────────────────────────────────

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

  // ── doStream ──────────────────────────────────────────────────────────────

  describe('doStream', () => {
    it('stream_event text_delta 正确转换为 text-start + text-delta + text-end', async () => {
      pushTextDelta('Hello, ')
      pushTextDelta('world!')
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const { stream } = await model.doStream(buildCallOptions('Say hello'))
      const parts = await collectStream(stream)

      expect(parts.find((p) => p.type === 'text-start')).toBeDefined()

      const deltas = parts.filter((p) => p.type === 'text-delta')
      expect(deltas).toHaveLength(2)
      expect(deltas.map((p) => p.delta).join('')).toBe('Hello, world!')

      expect(parts.find((p) => p.type === 'text-end')).toBeDefined()
    })

    it('result subtype=success → finishReason stop', async () => {
      pushTextDelta('hi')
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream((await model.doStream(buildCallOptions('ping'))).stream)

      const finish = parts.find((p) => p.type === 'finish')
      expect(finish?.finishReason).toBe('stop')
    })

    it('result usage 正确映射到 finish.usage', async () => {
      pushTextDelta('hi')
      mockMessages.push({
        type: 'result',
        subtype: 'success',
        is_error: false,
        usage: { input_tokens: 10, output_tokens: 20 },
      })

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream((await model.doStream(buildCallOptions('ping'))).stream)

      const finish = parts.find((p) => p.type === 'finish')
      expect(finish?.usage?.inputTokens).toBe(10)
      expect(finish?.usage?.outputTokens).toBe(20)
      expect(finish?.usage?.totalTokens).toBe(30)
    })

    it('result subtype=error_during_execution → finishReason error', async () => {
      mockMessages.push({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
      })

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream((await model.doStream(buildCallOptions('test'))).stream)

      const error = parts.find((p) => p.type === 'error')
      expect(error).toBeDefined()
      expect(error.error.message).toContain('error_during_execution')

      const finish = parts.find((p) => p.type === 'finish')
      expect(finish?.finishReason).toBe('error')
    })

    it('query() 抛出异常 → error + finish reason=error', async () => {
      mockQueryError = new Error('CLI not found')

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream((await model.doStream(buildCallOptions('test'))).stream)

      const error = parts.find((p) => p.type === 'error')
      expect(error?.error.message).toContain('CLI not found')

      const finish = parts.find((p) => p.type === 'finish')
      expect(finish?.finishReason).toBe('error')
    })

    it('stream 结束无 result 事件时，自动补 finish stop', async () => {
      pushTextDelta('hi')
      // 不推 result 事件

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream((await model.doStream(buildCallOptions('test'))).stream)

      const finish = parts.find((p) => p.type === 'finish')
      expect(finish?.finishReason).toBe('stop')
    })

    it('使用正确的 modelId 传递给 query()', async () => {
      pushSuccessResult()

      const model = new QoderLanguageModel('ultimate')
      await collectStream((await model.doStream(buildCallOptions('ping'))).stream)

      expect(lastQueryParams).toBeDefined()
      expect(lastQueryParams.options.model).toBe('ultimate')
    })

    it('prompt 文本内容传递到 query()', async () => {
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      await collectStream((await model.doStream(buildCallOptions('hello world'))).stream)

      expect(mockQueryFn).toHaveBeenCalledOnce()
      expect(typeof lastQueryParams.prompt).toBe('string')
      expect(lastQueryParams.prompt).toContain('hello world')
    })

    it('非 text_delta 的 stream_event 被忽略', async () => {
      // content_block_start 不是文本 delta，应忽略
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      })
      pushTextDelta('real text')
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream((await model.doStream(buildCallOptions('test'))).stream)

      const deltas = parts.filter((p) => p.type === 'text-delta')
      expect(deltas).toHaveLength(1)
      expect(deltas[0].delta).toBe('real text')
    })

    it('透传 providerOptions.qoder.mcpServers 到 query() options', async () => {
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              providerOptions: {
                qoder: {
                  mcpServers: {
                    weather: {
                      command: 'npx',
                      args: ['-y', '@acme/weather-mcp'],
                      env: { API_KEY: 'secret' },
                    },
                  },
                },
              },
            }),
          )
        ).stream,
      )

      expect(lastQueryParams?.options?.mcpServers).toBeDefined()
      const weatherServer = lastQueryParams.options.mcpServers.weather
      expect(weatherServer).toBeDefined()
      expect(weatherServer.command).toBe('npx')
      expect(weatherServer.args).toEqual(['-y', '@acme/weather-mcp'])
      expect(weatherServer.env).toEqual({ API_KEY: 'secret' })
    })

    it('从 provider-defined tools 推导 mcpServers 并传递', async () => {
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              tools: [
                {
                  type: 'provider-defined',
                  id: 'qoder.weather',
                  name: 'weather_forecast',
                  args: {
                    serverName: 'weather',
                    command: 'uvx',
                    args: ['weather-mcp'],
                    env: { WEATHER_TOKEN: 'token' },
                  },
                },
              ],
            }),
          )
        ).stream,
      )

      const weatherServer = lastQueryParams?.options?.mcpServers?.weather
      expect(weatherServer).toBeDefined()
      expect(weatherServer.command).toBe('uvx')
      expect(weatherServer.args).toEqual(['weather-mcp'])
      expect(weatherServer.env).toEqual({ WEATHER_TOKEN: 'token' })
    })

    it('doGenerate 返回完整文本', async () => {
      pushTextDelta('generated response')
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const result = await model.doGenerate(buildCallOptions('generate test'))

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent?.text).toContain('generated response')
      expect(result.finishReason).toBe('stop')
    })

    // ── SDK in-process MCP server (type: 'sdk') ───────────────────────────────

    it('SDK in-process MCP server via providerOptions 直接透传 type/name/instance', async () => {
      pushSuccessResult()

      const mockInstance = { connect: vi.fn(), close: vi.fn() }
      const sdkServer = { type: 'sdk' as const, name: 'echo', instance: mockInstance }

      const model = new QoderLanguageModel('auto')
      await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              providerOptions: {
                qoder: {
                  mcpServers: {
                    echo: sdkServer,
                  },
                },
              },
            }),
          )
        ).stream,
      )

      expect(lastQueryParams?.options?.mcpServers?.echo).toBeDefined()
      expect(lastQueryParams.options.mcpServers.echo.type).toBe('sdk')
      expect(lastQueryParams.options.mcpServers.echo.name).toBe('echo')
      expect(lastQueryParams.options.mcpServers.echo.instance).toBe(mockInstance)
    })

    it('SDK in-process MCP server via provider-defined tools 透传 type/instance', async () => {
      pushSuccessResult()

      const mockInstance = { connect: vi.fn(), close: vi.fn() }

      const model = new QoderLanguageModel('auto')
      await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              tools: [
                {
                  type: 'provider-defined',
                  id: 'qoder.calc',
                  name: 'calculator',
                  args: {
                    serverName: 'calc',
                    type: 'sdk',
                    name: 'calc',
                    instance: mockInstance,
                  },
                },
              ],
            }),
          )
        ).stream,
      )

      const calcServer = lastQueryParams?.options?.mcpServers?.calc
      expect(calcServer).toBeDefined()
      expect(calcServer.type).toBe('sdk')
      expect(calcServer.instance).toBe(mockInstance)
    })

    it('SDK server enabled=false 时被过滤', async () => {
      pushSuccessResult()

      const mockInstance = { connect: vi.fn(), close: vi.fn() }
      const sdkServer = { type: 'sdk' as const, name: 'echo', instance: mockInstance, enabled: false }

      const model = new QoderLanguageModel('auto')
      await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              providerOptions: {
                qoder: {
                  mcpServers: {
                    echo: sdkServer,
                  },
                },
              },
            }),
          )
        ).stream,
      )

      // enabled=false 应该过滤掉，mcpServers 为空或不含 echo
      expect(lastQueryParams?.options?.mcpServers?.echo).toBeUndefined()
    })

    it('有 mcpServers 时不设置 disallowedTools，允许模型调用工具', async () => {
      pushSuccessResult()

      const mockInstance = { connect: vi.fn(), close: vi.fn() }

      const model = new QoderLanguageModel('auto')
      await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              providerOptions: {
                qoder: {
                  mcpServers: {
                    myserver: { type: 'sdk', name: 'myserver', instance: mockInstance },
                  },
                },
              },
            }),
          )
        ).stream,
      )

      // 提供了 mcpServers，不应设置 disallowedTools: ['*']
      expect(lastQueryParams?.options?.disallowedTools).toBeUndefined()
    })

    it('无 mcpServers 时也不设置 disallowedTools（允许 CLI 内建工具被调用）', async () => {
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      await collectStream((await model.doStream(buildCallOptions('ping'))).stream)

      expect(lastQueryParams?.options?.disallowedTools).toBeUndefined()
    })
  })
})

// ── helpers ───────────────────────────────────────────────────────────────────

function pushTextDelta(text: string) {
  mockMessages.push({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    },
  })
}

function pushSuccessResult() {
  mockMessages.push({
    type: 'result',
    subtype: 'success',
    is_error: false,
    usage: { input_tokens: 5, output_tokens: 10 },
  })
}

function buildCallOptions(
  userText: string,
  extra: Partial<LanguageModelV2CallOptions> = {},
): LanguageModelV2CallOptions {
  return {
    inputFormat: 'prompt',
    mode: { type: 'regular' },
    prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text: userText }],
      },
    ],
    ...extra,
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
