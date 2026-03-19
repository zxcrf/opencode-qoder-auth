/**
 * opencode CLI 集成测试
 * 验证各 Qoder 模型可以通过 `opencode run -m qoder/<model>` 正常工作
 *
 * 运行方式：
 *   pnpm --filter opencode-qoder-provider test:integration
 * 或：
 *   cd packages/opencode-qoder-provider && bun vitest run tests/integration/opencode-cli.test.ts
 *
 * 前提条件：
 *   - opencode 已安装（`which opencode` 可找到）
 *   - ~/.qoder/.auth/user 有效的 Qoder 认证
 *   - ~/.config/opencode/opencode.json 已含 provider.qoder 配置
 */
import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import os from 'node:os'

// 单个模型调用可能需要 60s+，顺序执行避免资源争用
const TIMEOUT = 120_000

const OPENCODE_BIN = '/Users/yee.wang/Library/pnpm/opencode'

/**
 * 调用 opencode run，返回 stdout
 * 使用 spawn 替代 execFile，避免 buffer 截断和 timeout 实现差异
 */
function runOpencode(model: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(OPENCODE_BIN, ['run', '-m', model, prompt], {
      env: { ...process.env, HOME: os.homedir(), OPENCODE_NON_INTERACTIVE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`[${model}] timeout after ${TIMEOUT}ms`))
    }, TIMEOUT - 5000)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (stderr) console.log(`[cli][${model}] stderr:`, stderr.slice(0, 500))
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`[${model}] exited with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

// concurrent: false 确保顺序执行，避免多个 opencode 进程同时运行
describe('opencode CLI — Qoder provider', { timeout: TIMEOUT, concurrent: false }, () => {
  it('qoder/lite: 基本对话（免费模型）', async () => {
    const output = await runOpencode('qoder/lite', 'Reply with exactly the word: PONG')
    console.log('[cli][lite] output:', output)
    expect(output.toLowerCase()).toContain('pong')
  })

  it('qoder/auto: 自动路由模型', async () => {
    const output = await runOpencode('qoder/auto', 'Say "hello" and nothing else.')
    console.log('[cli][auto] output:', output)
    expect(output.toLowerCase()).toContain('hello')
  })

  it('qoder/efficient: 高效模型', async () => {
    const output = await runOpencode('qoder/efficient', 'Say "hello" and nothing else.')
    console.log('[cli][efficient] output:', output)
    expect(output.toLowerCase()).toContain('hello')
  })

  it('qoder/performance: 性能模型', async () => {
    const output = await runOpencode('qoder/performance', 'Say "hello" and nothing else.')
    console.log('[cli][performance] output:', output)
    expect(output.toLowerCase()).toContain('hello')
  })

  it('qoder/ultimate: 旗舰模型', async () => {
    const output = await runOpencode('qoder/ultimate', 'Say "hello" and nothing else.')
    console.log('[cli][ultimate] output:', output)
    expect(output.toLowerCase()).toContain('hello')
  })

  it('qoder/qmodel: QModel', async () => {
    const output = await runOpencode('qoder/qmodel', 'Say "hello" and nothing else.')
    console.log('[cli][qmodel] output:', output)
    expect(output.toLowerCase()).toContain('hello')
  })

  it('qoder/q35model: Q3.5 Model', async () => {
    const output = await runOpencode('qoder/q35model', 'Say "hello" and nothing else.')
    console.log('[cli][q35model] output:', output)
    expect(output.toLowerCase()).toContain('hello')
  })

  it('qoder/gmodel: GModel（1M context）', async () => {
    const output = await runOpencode('qoder/gmodel', 'Say "hello" and nothing else.')
    console.log('[cli][gmodel] output:', output)
    expect(output.toLowerCase()).toContain('hello')
  })

  it('qoder/kmodel: KModel', async () => {
    const output = await runOpencode('qoder/kmodel', 'Say "hello" and nothing else.')
    console.log('[cli][kmodel] output:', output)
    expect(output.toLowerCase()).toContain('hello')
  })

  it('qoder/mmodel: MModel', async () => {
    const output = await runOpencode('qoder/mmodel', 'Say "hello" and nothing else.')
    console.log('[cli][mmodel] output:', output)
    expect(output.toLowerCase()).toContain('hello')
  })
})
