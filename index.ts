import type { Plugin, Hooks } from '@opencode-ai/plugin'
import { QODER_MODELS } from './src/models.js'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const QoderProviderPlugin: Plugin = async () => {
  // 解析 provider.ts 的 file:// URL，opencode 识别 file:// 前缀后直接 import
  const providerFileUrl = new URL('./provider.ts', import.meta.url).href

  return {
    async config(config) {
      config.provider = config.provider ?? {}
      const existing = config.provider.qoder ?? {}

      // 将 QODER_MODELS 转换为 opencode provider models 格式（去掉 cost 字段，opencode 不识别）
      const builtinModels: Record<string, object> = {}
      for (const [key, m] of Object.entries(QODER_MODELS)) {
        builtinModels[key] = {
          name: m.name,
          attachment: m.attachment,
          reasoning: m.reasoning,
          temperature: m.temperature,
          tool_call: m.tool_call,
          limit: m.limit,
        }
      }

      // 用户在 opencode.json 里覆写的 models 优先级更高
      const mergedModels = { ...builtinModels, ...(existing.models ?? {}) }

      config.provider.qoder = {
        ...existing,
        // opencode 用 npm 字段来加载 SDK：file:// 开头则直接 import，否则 BunProc.install()
        npm: existing.npm ?? providerFileUrl,
        name: existing.name ?? 'Qoder',
        models: mergedModels,
      }
    },

    auth: {
      provider: 'qoder',

      // loader：检查本地登录态，已登录则静默通过，无需用户输入任何东西
      async loader(getAuth) {
        const authFile = join(homedir(), '.qoder', '.auth', 'user')
        if (existsSync(authFile)) {
          // 已登录，返回空 options 即可，SDK 会自动读取 ~/.qoder/.auth/user
          return {}
        }
        // 未登录，返回空对象让 opencode 触发 auth UI
        return {}
      },

      methods: [
        {
          type: 'api',
          // label 作为 opencode auth UI 里的提示文案
          label: 'Run `qoder login` in your terminal to authenticate',
          // 没有需要用户填写的字段
          prompts: [],
          async authorize() {
            const authFile = join(homedir(), '.qoder', '.auth', 'user')
            if (existsSync(authFile)) {
              // 已经通过 qoder login 完成登录，标记为成功
              return { type: 'success', key: 'qoder-cli-auth' }
            }
            // 未登录，提示用户去终端执行 qoder login
            return { type: 'failed' }
          },
        },
      ],
    },
  } satisfies Hooks
}

export default QoderProviderPlugin
