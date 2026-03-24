import { describe, it, expect } from 'vitest'
import { QODER_MODELS, getModelById, DEFAULT_MODEL_ID } from '../src/models.js'

describe('Qoder 模型定义', () => {
  it('QODER_MODELS 包含所有可用模型', () => {
    const expectedKeys = ['auto', 'efficient', 'performance', 'ultimate', 'lite', 'q35model_preview', 'qmodel', 'q35model', 'gmodel', 'kmodel', 'mmodel']
    for (const key of expectedKeys) {
      expect(QODER_MODELS[key], `缺少模型: ${key}`).toBeDefined()
    }
  })

  it('每个模型有必要字段', () => {
    for (const [id, model] of Object.entries(QODER_MODELS)) {
      expect(model.id, `${id}.id 缺失`).toBeTruthy()
      expect(model.name, `${id}.name 缺失`).toBeTruthy()
      expect(typeof model.attachment).toBe('boolean')
      expect(typeof model.reasoning).toBe('boolean')
      expect(typeof model.tool_call).toBe('boolean')
      expect(model.cost).toBeDefined()
      expect(model.limit).toBeDefined()
    }
  })

  it('lite 是免费/默认模型', () => {
    expect(DEFAULT_MODEL_ID).toBe('lite')
    expect(QODER_MODELS['lite']).toBeDefined()
  })

  it('getModelById 返回正确模型', () => {
    const model = getModelById('auto')
    expect(model).toBeDefined()
    expect(model!.id).toBe('auto')
  })

  it('getModelById 找不到时返回 undefined', () => {
    const model = getModelById('nonexistent-model')
    expect(model).toBeUndefined()
  })

  it('模型 cost 字段均为非负数', () => {
    for (const [id, model] of Object.entries(QODER_MODELS)) {
      expect(model.cost.input, `${id}.cost.input 应 >= 0`).toBeGreaterThanOrEqual(0)
      expect(model.cost.output, `${id}.cost.output 应 >= 0`).toBeGreaterThanOrEqual(0)
    }
  })

  it('模型 limit.context 大于 0', () => {
    for (const [id, model] of Object.entries(QODER_MODELS)) {
      expect(model.limit.context, `${id}.limit.context 应 > 0`).toBeGreaterThan(0)
    }
  })
})
