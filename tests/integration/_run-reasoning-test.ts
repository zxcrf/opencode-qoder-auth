/**
 * 独立脚本：验证 reasoning/thinking 流式透出
 * 运行: npx --yes tsx tests/integration/_run-reasoning-test.ts
 */
import { QoderLanguageModel } from '../../src/qoder-language-model.js'
import { setMcpBridgeServers } from '../../src/mcp-bridge.js'

setMcpBridgeServers({})

const model = new QoderLanguageModel('efficient')
const { stream } = await model.doStream({
  inputFormat: 'prompt',
  mode: { type: 'regular' },
  prompt: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'What is 17 * 23? Think step by step.',
        },
      ],
    },
  ],
})

const reader = stream.getReader()
const counts: Record<string, number> = {}
let reasoningText = ''
let responseText = ''
const t0 = Date.now()
const firstSeen: Record<string, number> = {}

while (true) {
  const { value, done } = await reader.read()
  if (done) break
  const type = (value as { type: string }).type
  counts[type] = (counts[type] || 0) + 1
  if (!firstSeen[type]) firstSeen[type] = Date.now() - t0
  if (type === 'reasoning-delta') reasoningText += (value as { delta: string }).delta
  if (type === 'text-delta') responseText += (value as { delta: string }).delta
}

console.log('\n=== Reasoning Streaming E2E Test (efficient model) ===')
console.log('Event counts:', JSON.stringify(counts, null, 2))
console.log('First seen (ms):', JSON.stringify(firstSeen, null, 2))
console.log('Reasoning text (first 300):', reasoningText.slice(0, 300) || '(none)')
console.log('Response text (first 300):', responseText.slice(0, 300))
console.log('Total time:', Date.now() - t0, 'ms')

if (counts['reasoning-delta'] && counts['reasoning-delta'] > 0) {
  console.log(`\n✅ reasoning 流式透出成功！${counts['reasoning-delta']} 个 reasoning-delta`)
} else {
  console.log('\nℹ️ efficient 模型未返回 reasoning（可能不支持 thinking）')
}

if (counts['text-delta'] && counts['text-delta'] > 1) {
  console.log(`✅ text 真正流式！${counts['text-delta']} 个 text-delta`)
} else {
  console.log(`⚠️ text-delta 仅 ${counts['text-delta'] || 0} 个`)
}
