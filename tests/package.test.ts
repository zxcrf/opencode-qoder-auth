import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type PackageJson = {
  dependencies?: Record<string, string>
}

const pkg = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
) as PackageJson

describe('package manifest', () => {
  it('does not depend on the private qoder SDK package at install time', () => {
    expect(pkg.dependencies?.['@ali/qoder-agent-sdk']).toBeUndefined()
  })
})
