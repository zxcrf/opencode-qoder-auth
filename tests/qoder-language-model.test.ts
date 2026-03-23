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
    // 重置 mcp-bridge 全局状态，避免测试间污染
    const bridge = await import('../src/mcp-bridge.js')
    bridge.setMcpBridgeServers({})
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

    // ── mcp-bridge：opencode config.mcp → query() mcpServers ─────────────────

    it('mcp-bridge 中设置的服务器自动注入到 query() mcpServers', async () => {
      pushSuccessResult()

      // 模拟 config hook 设置了 context7
      const bridge = await import('../src/mcp-bridge.js')
      bridge.setMcpBridgeServers({
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp@latest'],
        },
      })

      const mod = await import('../src/qoder-language-model.js')
      const model = new mod.QoderLanguageModel('auto')
      await collectStream((await model.doStream(buildCallOptions('ping'))).stream)

      expect(lastQueryParams?.options?.mcpServers?.context7).toBeDefined()
      expect(lastQueryParams.options.mcpServers.context7.command).toBe('npx')
      expect(lastQueryParams.options.mcpServers.context7.args).toEqual(['-y', '@upstash/context7-mcp@latest'])
    })

    it('providerOptions.qoder.mcpServers 优先级高于 mcp-bridge', async () => {
      pushSuccessResult()

      // mcp-bridge 设置了 context7（默认 endpoint）
      const bridge = await import('../src/mcp-bridge.js')
      bridge.setMcpBridgeServers({
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp@latest'],
        },
      })

      const mod = await import('../src/qoder-language-model.js')
      const model = new mod.QoderLanguageModel('auto')
      await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              providerOptions: {
                qoder: {
                  mcpServers: {
                    context7: {
                      // 用户在 providerOptions 里覆盖 context7 指向不同版本
                      command: 'npx',
                      args: ['-y', '@upstash/context7-mcp@1.0.0'],
                    },
                  },
                },
              },
            }),
          )
        ).stream,
      )

      // providerOptions 覆盖 bridge，版本为 1.0.0
      expect(lastQueryParams?.options?.mcpServers?.context7?.args).toEqual(['-y', '@upstash/context7-mcp@1.0.0'])
    })

    it('mcp-bridge 为空时 query() 不传 mcpServers', async () => {
      pushSuccessResult()

      // bridge 已在 beforeEach 中重置为空
      const model = new QoderLanguageModel('auto')
      await collectStream((await model.doStream(buildCallOptions('ping'))).stream)

      expect(lastQueryParams?.options?.mcpServers).toBeUndefined()
    })

    // ── MCP proxy 工具名转换：mcp__server__tool → server_tool ──

    it('CLI mcp__context7__* 转换为 context7_* 后匹配 opencode function tool', async () => {
      // CLI 发出 mcp__context7__resolve-library-id（CLI MCP proxy 格式）
      // opencode tools 有 context7_resolve-library-id（opencode 格式）
      // normalizeToolName 转换后能匹配 → 正常发出，不带 providerExecuted
      mockMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_mcp_001', name: 'mcp__context7__resolve-library-id' },
        },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"libraryName":"react"}' } },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      })
      pushTextDelta('Done.')
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              // opencode 有 context7 的 function 工具
              tools: [
                { type: 'function', name: 'bash', description: 'Run bash', inputSchema: { type: 'object', properties: {} } },
                { type: 'function', name: 'context7_resolve-library-id', description: 'Resolve library', inputSchema: { type: 'object', properties: {} } },
              ],
            }),
          )
        ).stream,
      )

      // mcp__context7__resolve-library-id → context7_resolve-library-id（匹配 functionToolNames）
      // → isProviderExecuted=false → 正常发出，不带 providerExecuted
      const toolCall = parts.find((p) => p.type === 'tool-call')
      expect(toolCall).toBeDefined()
      expect((toolCall as any).toolName).toBe('context7_resolve-library-id')
      expect((toolCall as any).providerExecuted).toBeUndefined()

      // 文本仍然正常输出
      const deltas = parts.filter((p) => p.type === 'text-delta')
      expect(deltas.map((p) => (p as any).delta).join('')).toBe('Done.')
    })

    it('CLI mcp__* 工具不在 opencode tools 中时，不发出 tool 事件', async () => {
      // CLI 发出 mcp__context7__resolve-library-id，但 opencode 没有 context7 相关工具
      mockMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_mcp_002', name: 'mcp__context7__resolve-library-id' },
        },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"libraryName":"react"}' } },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      })
      mockMessages.push({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'call_mcp_002', content: 'react docs' }] },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              // opencode 没有 context7 工具
              tools: [
                { type: 'function', name: 'bash', description: 'Run bash', inputSchema: { type: 'object', properties: {} } },
                { type: 'function', name: 'read', description: 'Read file', inputSchema: { type: 'object', properties: {} } },
              ],
            }),
          )
        ).stream,
      )

      // context7_resolve-library-id 不在 functionToolNames → isProviderExecuted=true → 不发事件
      const toolEvents = parts.filter((p) =>
        ['tool-input-start', 'tool-input-delta', 'tool-input-end', 'tool-call', 'tool-result'].includes(p.type)
      )
      expect(toolEvents).toHaveLength(0)
    })

    it('CLI 大写工具（Read）正确映射到 opencode 小写工具（read）', async () => {
      // CLI 内部调用 Read（大写），opencode tools 有 read（小写）
      // normalizeToolName 统一转小写后能正确匹配 → 作为 opencode 工具发出
      mockMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_read_001', name: 'Read' },
        },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"/tmp/file.txt"}' } },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      })
      mockMessages.push({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'call_read_001', content: 'file contents' }] },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              tools: [
                { type: 'function', name: 'read', description: 'Read file', inputSchema: { type: 'object', properties: { filePath: { type: 'string' } } } },
              ],
            }),
          )
        ).stream,
      )

      // CLI 的 Read（大写）经 normalizeToolName 转为 read（小写）→ 匹配 functionToolNames
      // → isProviderExecuted=false → 正常发出 tool 事件（不带 providerExecuted）
      const toolCall = parts.find((p) => p.type === 'tool-call')
      expect(toolCall).toBeDefined()
      expect((toolCall as any).toolName).toBe('read')
      expect((toolCall as any).providerExecuted).toBeUndefined()
    })

    it('options.tools 为空时，CLI 的所有工具调用都发出（不过滤）', async () => {
      mockMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_bash_001', name: 'bash' },
        },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' } },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      })
      mockMessages.push({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'call_bash_001', content: 'file.ts' }] },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      // 不传 tools → shouldFilterTools = false → 不过滤
      const parts = await collectStream((await model.doStream(buildCallOptions('ping'))).stream)

      const toolCalls = parts.filter((p) => p.type === 'tool-call')
      expect(toolCalls).toHaveLength(1)
      expect((toolCalls[0] as any).toolName).toBe('bash')
    })

    it('options.tools 有已知工具时，已知工具调用正常发出', async () => {
      mockMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_bash_002', name: 'bash' },
        },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"pwd"}' } },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      })
      mockMessages.push({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'call_bash_002', content: '/home' }] },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              tools: [
                { type: 'function', name: 'bash', description: 'Run bash', inputSchema: { type: 'object', properties: {} } },
              ],
            }),
          )
        ).stream,
      )

      // bash 在 options.tools 里 → 正常发出
      const toolCalls = parts.filter((p) => p.type === 'tool-call')
      expect(toolCalls).toHaveLength(1)
      expect((toolCalls[0] as any).toolName).toBe('bash')
    })

    // ── 标准工具调用流（opencode 执行工具，不带 providerExecuted） ────────────

    it('options.tools 中 function 类型工具调用不带 providerExecuted', async () => {
      // CLI 发出 bash 工具调用（bash 在 options.tools 里是 function 类型）
      mockMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_func_001', name: 'bash' },
        },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' } },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              tools: [
                { type: 'function', name: 'bash', description: 'Run bash', inputSchema: { type: 'object', properties: {} } },
              ],
            }),
          )
        ).stream,
      )

      const toolCall = parts.find((p) => p.type === 'tool-call')
      expect(toolCall).toBeDefined()
      expect((toolCall as any).toolName).toBe('bash')
      // function 类型工具不带 providerExecuted → opencode 负责执行
      expect((toolCall as any).providerExecuted).toBeUndefined()
    })

    it('CLI 内置工具（不在 options.tools 中）不向 opencode 发 tool 事件', async () => {
      // CLI 发出 Bash（CLI 内置，大写），不在 options.tools 里
      mockMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_cli_001', name: 'Bash' },
        },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"echo hi"}' } },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      })
      mockMessages.push({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'call_cli_001', content: 'hi' }] },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      // options.tools 传入一个不同的工具（不含 bash/Bash）
      const parts = await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              tools: [
                { type: 'function', name: 'read', description: 'Read file', inputSchema: { type: 'object', properties: {} } },
              ],
            }),
          )
        ).stream,
      )

      // CLI 内置工具（不在 options.tools 中）→ 不向 opencode 发任何 tool 事件
      const toolEvents = parts.filter((p) =>
        ['tool-input-start', 'tool-input-delta', 'tool-input-end', 'tool-call', 'tool-result'].includes(p.type)
      )
      expect(toolEvents).toHaveLength(0)
    })

    it('opencode 执行的 function 工具不发出 tool-result（opencode 自己处理）', async () => {
      // CLI 发出 bash 工具调用，但 bash 是 function 类型（opencode 执行）
      // CLI 后续发出 user tool_result，但我们不应 re-emit 给 opencode
      mockMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_func_002', name: 'bash' },
        },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      })
      mockMessages.push({
        type: 'user',
        // 这是 CLI 内部发的 tool_result，不应转发给 opencode
        message: { content: [{ type: 'tool_result', tool_use_id: 'call_func_002', content: '/home' }] },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              tools: [
                { type: 'function', name: 'bash', description: 'Run bash', inputSchema: { type: 'object', properties: {} } },
              ],
            }),
          )
        ).stream,
      )

      // function 工具 → opencode 执行，不应有 tool-result 被 re-emit
      const toolResults = parts.filter((p) => p.type === 'tool-result')
      expect(toolResults).toHaveLength(0)
    })

    it('双轨 MCP：即使 opencode 有对应的 function 工具，mcp-bridge 的 servers 仍传给 CLI', async () => {
      pushSuccessResult()

      // mcp-bridge 中设置了 context7，同时 options.tools 里有 function 类型的 context7 工具
      // 双轨策略下 CLI 也需要连接 context7 来自主完成 agent loop
      const bridge = await import('../src/mcp-bridge.js')
      bridge.setMcpBridgeServers({
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp@latest'],
        },
      })

      const mod = await import('../src/qoder-language-model.js')
      const model = new mod.QoderLanguageModel('auto')
      await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              // opencode 传入了 context7 的 function 工具
              tools: [
                { type: 'function', name: 'context7_resolve-library-id', description: 'Resolve library', inputSchema: { type: 'object', properties: {} } },
                { type: 'function', name: 'context7_get-library-docs', description: 'Get docs', inputSchema: { type: 'object', properties: {} } },
              ],
            }),
          )
        ).stream,
      )

      // 双轨 MCP：CLI 也需要连接 context7，不过滤
      expect(lastQueryParams?.options?.mcpServers?.context7).toBeDefined()
      expect(lastQueryParams.options.mcpServers.context7.command).toBe('npx')
      expect(lastQueryParams.options.mcpServers.context7.args).toEqual(['-y', '@upstash/context7-mcp@latest'])
    })

    // ── tool-call input 格式：必须是已解析的对象，不是 JSON 字符串 ──────────

    it('stream_event 路径：tool-call 的 input 是 JSON 字符串（AI SDK 内部 trim+parse）', async () => {
      mockMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_input_001', name: 'bash' },
        },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"ls -la","timeout":30}' } },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              tools: [
                { type: 'function', name: 'bash', description: 'Run bash', inputSchema: { type: 'object', properties: {} } },
              ],
            }),
          )
        ).stream,
      )

      const toolCall = parts.find((p) => p.type === 'tool-call')
      expect(toolCall).toBeDefined()
      // AI SDK 期望 input 是 JSON 字符串（内部调用 input.trim() 再 JSON.parse）
      expect(typeof (toolCall as any).input).toBe('string')
      expect(JSON.parse((toolCall as any).input)).toEqual({ command: 'ls -la', timeout: 30 })
    })

    it('assistant 路径：tool-call 的 input 是 JSON 字符串', async () => {
      // assistant 消息中 tool_use 的 input 是对象，需要序列化为 JSON 字符串
      mockMessages.push({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'call_input_002', name: 'read', input: { filePath: '/tmp/test.txt' } },
          ],
        },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              tools: [
                { type: 'function', name: 'read', description: 'Read file', inputSchema: { type: 'object', properties: {} } },
              ],
            }),
          )
        ).stream,
      )

      const toolCall = parts.find((p) => p.type === 'tool-call')
      expect(toolCall).toBeDefined()
      expect(typeof (toolCall as any).input).toBe('string')
      expect(JSON.parse((toolCall as any).input)).toEqual({ filePath: '/tmp/test.txt' })
    })

    it('assistant 路径：tool_use input 是字符串时，直接透传', async () => {
      mockMessages.push({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'call_input_003', name: 'bash', input: '{"command":"pwd"}' },
          ],
        },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              tools: [
                { type: 'function', name: 'bash', description: 'Run bash', inputSchema: { type: 'object', properties: {} } },
              ],
            }),
          )
        ).stream,
      )

      const toolCall = parts.find((p) => p.type === 'tool-call')
      expect(toolCall).toBeDefined()
      expect(typeof (toolCall as any).input).toBe('string')
      expect((toolCall as any).input).toBe('{"command":"pwd"}')
    })

    // ── finishReason：有 tool-call 时应为 'tool-calls' ─────────────────────

    it('有 function tool-call 时 finishReason 为 tool-calls', async () => {
      mockMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_finish_001', name: 'bash' },
        },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' } },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              tools: [
                { type: 'function', name: 'bash', description: 'Run bash', inputSchema: { type: 'object', properties: {} } },
              ],
            }),
          )
        ).stream,
      )

      // 有 tool-call 发出时，finishReason 应为 'tool-calls' 而非 'stop'
      const finish = parts.find((p) => p.type === 'finish')
      expect(finish).toBeDefined()
      expect((finish as any).finishReason).toBe('tool-calls')
    })

    it('只有 providerExecuted tool-call 时 finishReason 仍为 stop', async () => {
      // CLI 调用 Bash（不在 options.tools 中）→ providerExecuted → 不对 opencode 发 tool-call
      mockMessages.push({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_finish_002', name: 'Bash' },
        },
      })
      mockMessages.push({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream(
        (
          await model.doStream(
            buildCallOptions('ping', {
              tools: [
                { type: 'function', name: 'read', description: 'Read file', inputSchema: { type: 'object', properties: {} } },
              ],
            }),
          )
        ).stream,
      )

      // 没有向 opencode 发出 tool-call（都是 providerExecuted）→ finishReason = stop
      const finish = parts.find((p) => p.type === 'finish')
      expect(finish).toBeDefined()
      expect((finish as any).finishReason).toBe('stop')
    })

    it('无 tools 时纯文本 finishReason 仍为 stop', async () => {
      pushTextDelta('hello')
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream((await model.doStream(buildCallOptions('ping'))).stream)

      const finish = parts.find((p) => p.type === 'finish')
      expect(finish).toBeDefined()
      expect((finish as any).finishReason).toBe('stop')
    })

    // ── reasoning/thinking 流式支持 ───────────────────────────────────────

    it('stream_event thinking_delta 正确转换为 reasoning-start + reasoning-delta + reasoning-end', async () => {
      pushThinkingBlockStart(0)
      pushThinkingDelta('Let me think...', 0)
      pushThinkingDelta(' step by step', 0)
      pushContentBlockStop(0)
      pushTextBlockStart(1)
      pushTextDeltaWithIndex('Final answer', 1)
      pushContentBlockStop(1)
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const { stream } = await model.doStream(buildCallOptions('Reason about this'))
      const parts = await collectStream(stream)

      // reasoning 事件
      expect(parts.find((p) => p.type === 'reasoning-start')).toBeDefined()
      const reasoningDeltas = parts.filter((p) => p.type === 'reasoning-delta')
      expect(reasoningDeltas).toHaveLength(2)
      expect(reasoningDeltas.map((p) => (p as any).delta).join('')).toBe('Let me think... step by step')
      expect(parts.find((p) => p.type === 'reasoning-end')).toBeDefined()

      // text 事件
      expect(parts.find((p) => p.type === 'text-start')).toBeDefined()
      const textDeltas = parts.filter((p) => p.type === 'text-delta')
      expect(textDeltas.map((p) => (p as any).delta).join('')).toBe('Final answer')
      expect(parts.find((p) => p.type === 'text-end')).toBeDefined()
    })

    it('thinking_delta 无 content_block_start 时自动补 reasoning-start', async () => {
      // 直接发 thinking_delta，不先发 content_block_start（应自动补 reasoning-start）
      pushThinkingDelta('Direct thinking', 0)
      pushContentBlockStop(0)
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream((await model.doStream(buildCallOptions('test'))).stream)

      expect(parts.find((p) => p.type === 'reasoning-start')).toBeDefined()
      const reasoningDeltas = parts.filter((p) => p.type === 'reasoning-delta')
      expect(reasoningDeltas).toHaveLength(1)
      expect((reasoningDeltas[0] as any).delta).toBe('Direct thinking')
    })

    it('assistant 路径 thinking block 正确转换为 reasoning-start + reasoning-delta + reasoning-end', async () => {
      // 走 assistant fallback（非 stream_event）
      mockMessages.push({
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'I need to analyze this carefully.' },
            { type: 'text', text: 'Here is the answer.' },
          ],
        },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream((await model.doStream(buildCallOptions('test'))).stream)

      // reasoning 事件
      expect(parts.find((p) => p.type === 'reasoning-start')).toBeDefined()
      const reasoningDeltas = parts.filter((p) => p.type === 'reasoning-delta')
      expect(reasoningDeltas).toHaveLength(1)
      expect((reasoningDeltas[0] as any).delta).toBe('I need to analyze this carefully.')
      expect(parts.find((p) => p.type === 'reasoning-end')).toBeDefined()

      // text 事件
      expect(parts.find((p) => p.type === 'text-start')).toBeDefined()
      const textDeltas = parts.filter((p) => p.type === 'text-delta')
      expect(textDeltas.map((p) => (p as any).delta).join('')).toBe('Here is the answer.')
    })

    it('stream_event reasoning 阻止 assistant fallback 重复发 thinking', async () => {
      // 先通过 stream_event 发了 thinking_delta
      pushThinkingDelta('streamed thinking', 0)
      pushContentBlockStop(0)
      // 然后 assistant 消息也有 thinking block（应忽略）
      mockMessages.push({
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'streamed thinking' },
            { type: 'text', text: 'Answer.' },
          ],
        },
      })
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream((await model.doStream(buildCallOptions('test'))).stream)

      // 应只有一组 reasoning（来自 stream_event，不重复）
      const reasoningStarts = parts.filter((p) => p.type === 'reasoning-start')
      expect(reasoningStarts).toHaveLength(1)
    })

    it('result 时自动关闭未关闭的 reasoning block', async () => {
      // thinking block 开始了但没有 content_block_stop
      pushThinkingBlockStart(0)
      pushThinkingDelta('incomplete thinking', 0)
      // 直接发 result（不发 content_block_stop）
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const parts = await collectStream((await model.doStream(buildCallOptions('test'))).stream)

      // 应有 reasoning-start 和 reasoning-end（自动关闭）
      expect(parts.find((p) => p.type === 'reasoning-start')).toBeDefined()
      expect(parts.find((p) => p.type === 'reasoning-end')).toBeDefined()
    })

    it('doGenerate 返回 reasoning + text content', async () => {
      pushThinkingBlockStart(0)
      pushThinkingDelta('thinking process', 0)
      pushContentBlockStop(0)
      pushTextBlockStart(1)
      pushTextDeltaWithIndex('generated text', 1)
      pushContentBlockStop(1)
      pushSuccessResult()

      const model = new QoderLanguageModel('auto')
      const result = await model.doGenerate(buildCallOptions('test'))

      const reasoningContent = result.content.find((c) => c.type === 'reasoning')
      expect(reasoningContent).toBeDefined()
      expect((reasoningContent as any).text).toBe('thinking process')

      const textContent = result.content.find((c) => c.type === 'text')
      expect(textContent).toBeDefined()
      expect((textContent as any).text).toBe('generated text')
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

function pushTextDeltaWithIndex(text: string, index: number) {
  mockMessages.push({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'text_delta', text },
    },
  })
}

function pushTextBlockStart(index: number) {
  mockMessages.push({
    type: 'stream_event',
    event: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
  })
}

function pushThinkingBlockStart(index: number) {
  mockMessages.push({
    type: 'stream_event',
    event: { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } },
  })
}

function pushThinkingDelta(thinking: string, index: number) {
  mockMessages.push({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'thinking_delta', thinking },
    },
  })
}

function pushContentBlockStop(index: number) {
  mockMessages.push({
    type: 'stream_event',
    event: { type: 'content_block_stop', index },
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
