import { describe, expect, it } from 'vitest'

import { findAiProvider, isAiProviderId, matchProviderByBaseUrl } from './types'

describe('OpenCode provider presets', () => {
  it('keeps Zen separate from the Go subscription', () => {
    expect(isAiProviderId('opencode-zen')).toBe(true)
    expect(isAiProviderId('opencode-go')).toBe(true)

    const zen = findAiProvider('opencode-zen')
    expect(zen.name).toBe('OpenCode Zen')
    expect(zen.baseUrl).toBe('https://opencode.ai/zen/v1')
    expect(zen.consoleUrl).toBe('https://opencode.ai/zen')
    expect(zen.models).toContain('deepseek-v4.1-flash-free')
    expect(matchProviderByBaseUrl('https://opencode.ai/zen/v1/')).toBe('opencode-zen')
    expect(matchProviderByBaseUrl('https://opencode.ai/zen/go/v1')).toBe('opencode-go')
  })
})
