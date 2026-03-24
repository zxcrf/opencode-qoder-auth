import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function getQoderAuthFile(): string | undefined {
  const candidates = [
    path.join(os.homedir(), '.qoderwork', '.auth', 'user'),
    path.join(os.homedir(), '.qoder', '.auth', 'user'),
  ]
  return candidates.find((file) => fs.existsSync(file))
}

export function requireQoderAuth(): string {
  const authFile = getQoderAuthFile()
  if (!authFile) {
    throw new Error(
      '未检测到 Qoder 登录态：缺少 ~/.qoder/.auth/user 或 ~/.qoderwork/.auth/user。请先执行 `qoder login`，否则所有真实集成测试结果都不可信。',
    )
  }
  return authFile
}
