import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const README = readFileSync(join(process.cwd(), 'README.md'), 'utf8')

describe('README installation guide', () => {
  it('documents that opencode installs npm plugins automatically from config', () => {
    expect(README).toMatch(/installs npm plugins automatically on startup/i)
    expect(README).toMatch(/OpenCode 会在启动时自动安装/i)
  })
})
