import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'

const OUT_DIR = '/Users/yee.wang/Code/github/opencode-qoder-provider/tests/fixtures'
const OPENCODE_BIN = '/Users/yee.wang/Library/pnpm/opencode'
const TIMEOUT = 120_000

mkdirSync(OUT_DIR, { recursive: true })

function runOpencode(model, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(OPENCODE_BIN, ['run', '-m', model, prompt], {
      env: { ...process.env, HOME: os.homedir(), OPENCODE_NON_INTERACTIVE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`[${model}] timeout after ${TIMEOUT}ms`))
    }, TIMEOUT)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: code })
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

const cases = [
  {
    name: 'lite-pong',
    model: 'qoder/lite',
    prompt: 'Reply with exactly the word: PONG',
  },
  {
    name: 'auto-hello',
    model: 'qoder/auto',
    prompt: 'Say "hello" and nothing else.',
  },
  {
    name: 'efficient-hello',
    model: 'qoder/efficient',
    prompt: 'Say "hello" and nothing else.',
  },
  {
    name: 'performance-hello',
    model: 'qoder/performance',
    prompt: 'Say "hello" and nothing else.',
  },
  {
    name: 'ultimate-hello',
    model: 'qoder/ultimate',
    prompt: 'Say "hello" and nothing else.',
  },
  {
    name: 'qmodel-hello',
    model: 'qoder/qmodel',
    prompt: 'You MUST respond in English only. Reply with exactly the word: hello',
  },
  {
    name: 'q35model-hello',
    model: 'qoder/q35model',
    prompt: 'Say "hello" and nothing else.',
  },
  {
    name: 'gmodel-hello',
    model: 'qoder/gmodel',
    prompt: 'Say "hello" and nothing else.',
  },
  {
    name: 'kmodel-hello',
    model: 'qoder/kmodel',
    prompt: 'Say "hello" and nothing else.',
  },
  {
    name: 'mmodel-hello',
    model: 'qoder/mmodel',
    prompt: 'Say "hello" and nothing else.',
  },
]

for (const item of cases) {
  const result = await runOpencode(item.model, item.prompt)
  const file = `${OUT_DIR}/${item.name}.json`
  writeFileSync(file, JSON.stringify({ ...item, ...result }, null, 2))
  console.log(`captured ${file}`)
}
