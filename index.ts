import type { Plugin, Hooks } from '@opencode-ai/plugin'
import { QODER_MODELS } from './src/models.js'

export const QoderProviderPlugin: Plugin = async () => {
  // 解析 provider.ts 的 file:// URL，opencode 识别 file:// 前缀后直接 import
  const providerFileUrl = new URL('./provider.ts', import.meta.url).href

  return {
    async config(config) {
      config.provider = config.provider ?? {}
      const existing = config.provider['qoder'] ?? {}

      const existingModels = { ...QODER_MODELS, ...(existing.models ?? {}) }

      config.provider['qoder'] = {
        ...existing,
        // opencode 用 npm 字段来加载 SDK：file:// 开头则直接 import，否则 BunProc.install()
        npm: existing.npm ?? providerFileUrl,
        name: existing.name ?? 'Qoder',
        models: existingModels,
      }
    },
  } satisfies Hooks
}

export default QoderProviderPlugin
