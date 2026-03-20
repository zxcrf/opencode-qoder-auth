// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const spawnMock = vi.fn()
const createInterfaceMock = vi.fn(() => ({
  on: vi.fn(),
  close: vi.fn(),
  async *[Symbol.asyncIterator]() {},
}))

vi.mock('child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('readline', () => ({
  createInterface: createInterfaceMock,
}))

describe('vendored qoder agent sdk', () => {
  beforeEach(() => {
    vi.resetModules()
    spawnMock.mockReset()
    createInterfaceMock.mockClear()
  })

  it('将 image stream prompt 转成 qodercli --attachment + --print', async () => {
    const mockProcess = createMockProcess()
    spawnMock.mockReturnValue(mockProcess)

    const { query } = await import('../src/vendor/qoder-agent-sdk.mjs')

    const result = query({
      prompt: buildImagePrompt(),
      options: {
        model: 'auto',
        pathToQoderCLIExecutable: '/tmp/qodercli',
      },
    })

    await result.next()

    expect(spawnMock).toHaveBeenCalledOnce()

    const [command, args] = spawnMock.mock.calls[0]
    expect(command).toBe('/tmp/qodercli')
    expect(args).toContain('--print')
    expect(args).toContain('What color is this image? Reply with one word.')
    expect(args).toContain('--attachment')
    expect(args).not.toContain('--input-format')

    const attachmentIndex = args.indexOf('--attachment')
    expect(attachmentIndex).toBeGreaterThan(-1)
    expect(typeof args[attachmentIndex + 1]).toBe('string')
    expect(args[attachmentIndex + 1]).toContain('qoder-sdk-attachment-')

    expect(mockProcess.stdin.write).not.toHaveBeenCalled()
    expect(mockProcess.stdin.end).toHaveBeenCalled()
  })
})

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number
    exitCode: number | null
    stdout: Record<string, never>
    stderr: Record<string, never>
    stdin: {
      write: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
    }
    kill: ReturnType<typeof vi.fn>
  }

  proc.pid = 12345
  proc.exitCode = 0
  proc.stdout = {}
  proc.stderr = {}
  proc.stdin = {
    write: vi.fn((_data?: string, callback?: (error?: Error | null) => void) => callback?.(null)),
    end: vi.fn(),
  }
  proc.kill = vi.fn()

  return proc
}

async function* buildImagePrompt() {
  yield {
    type: 'user',
    session_id: 'default',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
          },
        },
        {
          type: 'text',
          text: 'What color is this image? Reply with one word.',
        },
      ],
    },
  }
}
