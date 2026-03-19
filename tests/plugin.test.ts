import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Config } from '@opencode-ai/plugin'

// 动态 import plugin，测试时 mock SDK
vi.mock('../src/vendor/qoder-agent-sdk.mjs', () => ({
  query: vi.fn(),
  IntegrationMode: { QoderWork: 'qoder_work', Quest: 'quest' },
}))

describe('QoderProviderPlugin', () => {
  let pluginModule: typeof import('../index.js')

  beforeEach(async () => {
    vi.resetModules()
    pluginModule = await import('../index.js')
  })

  describe('plugin 导出', () => {
    it('导出 QoderProviderPlugin 函数', () => {
      expect(typeof pluginModule.QoderProviderPlugin).toBe('function')
    })
  })

  describe('config hook', () => {
    it('注入 qoder provider 到 config.provider', async () => {
      const hooks = await pluginModule.QoderProviderPlugin({} as any)
      expect(hooks.config).toBeDefined()

      const config: Config = {} as Config
      await hooks.config!(config)

      expect(config.provider).toBeDefined()
      expect(config.provider!['qoder']).toBeDefined()
    })

    it('provider 包含 name 和 npm 字段', async () => {
      const hooks = await pluginModule.QoderProviderPlugin({} as any)
      const config: Config = {} as Config
      await hooks.config!(config)

      const qoderProvider = config.provider!['qoder']
      expect(qoderProvider.name).toBe('Qoder')
      // npm 字段应为 file:// URL 指向本地 provider.ts
      expect(qoderProvider.npm).toMatch(/^file:\/\//)
      expect(qoderProvider.npm).toMatch(/provider\.ts$/)
    })

    it('provider 包含至少一个 model', async () => {
      const hooks = await pluginModule.QoderProviderPlugin({} as any)
      const config: Config = {} as Config
      await hooks.config!(config)

      const models = config.provider!['qoder'].models
      expect(models).toBeDefined()
      expect(Object.keys(models!).length).toBeGreaterThan(0)
    })

    it('不覆盖用户已有的 npm 配置', async () => {
      const hooks = await pluginModule.QoderProviderPlugin({} as any)
      const config: Config = {
        provider: {
          qoder: {
            npm: 'my-custom-qoder-provider',
            models: {
              'custom-model': { name: 'My Custom Model' } as any,
            },
          } as any,
        },
      } as Config
      await hooks.config!(config)

      // 用户自定义的 npm 不被覆盖
      expect(config.provider!['qoder'].npm).toBe('my-custom-qoder-provider')
      expect(config.provider!['qoder'].models!['custom-model']).toBeDefined()
    })
  })
})
