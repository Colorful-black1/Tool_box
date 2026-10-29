import { describe, expect, it } from 'vitest'
import { agentPreferences, mergeAgentPreferences } from '../../shared/agent-projects'
import { validateConfigPatch } from './validation'

describe('项目偏好配置兼容', () => {
  it('目录和程序可单独更新，Desktop 别名规范化且保留其他偏好', () => {
    const config = {
      'claude-desktop': { executablePath: '/old', extensionDirectories: ['/project'] },
      claudeDesktop: { directory: '/current' }
    }
    const patch = validateConfigPatch({ 'claude-desktop': { directory: '/next' } })
    expect(patch).toEqual({ claudeDesktop: { directory: '/next' } })
    expect(mergeAgentPreferences(config, patch)).toEqual({
      claudeDesktop: {
        executablePath: '/old',
        extensionDirectories: ['/project'],
        directory: '/next'
      }
    })
    expect(validateConfigPatch({ codex: { executablePath: null } })).toEqual({
      codex: { executablePath: null }
    })
    expect(agentPreferences(config, 'claude-desktop').directory).toBe('/current')
    expect(() =>
      validateConfigPatch({
        claudeDesktop: { directory: '/a' },
        'claude-desktop': { directory: '/b' }
      })
    ).toThrow('新旧键')
    expect(() => validateConfigPatch({ dsh: {} })).toThrow('可更新字段')
  })
})
