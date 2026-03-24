import { describe, it, expect } from 'vitest'

const qoderCliBuiltinTools = [
  'Bash',
  'BashOutput',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'AskUserQuestion',
  'Agent',
  'KillBash',
  'NotebookEdit',
  'ExitPlanMode',
  'ListMcpResources',
  'ReadMcpResource',
] as const

const supportedByOpencode = new Set([
  'bash',
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'webfetch',
  'websearch',
  'todowrite',
  'question',
  'task',
  'plan_exit',
])

function normalize(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'askuserquestion') return 'question'
  if (lower === 'agent') return 'task'
  if (lower === 'exitplanmode') return 'plan_exit'
  return lower
}

describe('Qoder CLI builtin tools compatibility matrix', () => {
  it('列出当前可映射到 opencode 的工具', () => {
    const mapped = qoderCliBuiltinTools.map(normalize).filter((name) => supportedByOpencode.has(name))
    expect(mapped.sort()).toEqual([
      'bash',
      'edit',
      'glob',
      'grep',
      'plan_exit',
      'question',
      'read',
      'task',
      'todowrite',
      'webfetch',
      'websearch',
      'write',
    ])
  })

  it('列出当前 opencode 不原生支持的 Qoder 内置工具', () => {
    const unsupported = qoderCliBuiltinTools.map(normalize).filter((name) => !supportedByOpencode.has(name))
    expect(unsupported.sort()).toEqual([
      'bashoutput',
      'killbash',
      'listmcpresources',
      'notebookedit',
      'readmcpresource',
    ])
  })
})
