import { describe, expect, it } from 'vitest'

import { catalogContextWindow } from './model-context'

describe('catalogContextWindow', () => {
  it('按供应商读取已知模型窗口', () => {
    expect(catalogContextWindow('opencode-go', 'deepseek-v4.1-flash')).toBe(1_000_000)
    expect(catalogContextWindow('opencode-go', 'deepseek-v4-pro')).toBe(1_000_000)
    expect(catalogContextWindow('deepseek', 'deepseek-v4-pro')).toBe(1_048_576)
  })

  it('不跨供应商套用同名模型', () => {
    expect(catalogContextWindow('custom', 'deepseek-v4.1-flash')).toBeNull()
    expect(catalogContextWindow('openai', 'deepseek-v4.1-flash')).toBeNull()
  })

  it('自定义供应商按 OpenAI 兼容端点识别官方网关', () => {
    expect(
      catalogContextWindow('custom', 'deepseek-v4.1-flash', 'https://opencode.ai/zen/go/v1')
    ).toBe(1_000_000)
    expect(
      catalogContextWindow('custom', 'deepseek-v4.1-flash', 'https://opencode.ai/inference/go/v1')
    ).toBe(1_000_000)
    expect(
      catalogContextWindow('custom', 'deepseek-v4-pro', 'https://api.deepseek.com/v1')
    ).toBe(1_048_576)
  })

  it('OpenCode Zen 只匹配自己的免费模型，不套用 Go 目录', () => {
    expect(catalogContextWindow('opencode-zen', 'deepseek-v4.1-flash-free')).toBe(200_000)
    expect(catalogContextWindow('opencode-zen', 'deepseek-v4.1-flash')).toBeNull()
    expect(
      catalogContextWindow('custom', 'deepseek-v4.1-flash-free', 'https://opencode.ai/zen/v1')
    ).toBe(200_000)
    expect(
      catalogContextWindow(
        'custom',
        'deepseek-v4.1-flash-free',
        'https://opencode.ai/inference/openai/v1'
      )
    ).toBe(200_000)
    expect(
      catalogContextWindow('custom', 'deepseek-v4.1-flash', 'https://opencode.ai/zen/v1')
    ).toBeNull()
  })

  it('未知模型、空值与未收录供应商返回 null', () => {
    expect(catalogContextWindow('opencode-go', 'unknown-model')).toBeNull()
    expect(catalogContextWindow('opencode-go', '')).toBeNull()
    expect(catalogContextWindow('', 'deepseek-v4.1-flash')).toBeNull()
  })
})
