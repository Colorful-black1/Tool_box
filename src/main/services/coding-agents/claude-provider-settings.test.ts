import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { readClaudeProviderSettings } from './claude-provider-settings'

const files = vi.hoisted(() => ({ readFile: vi.fn(), stat: vi.fn() }))
vi.mock('node:fs/promises', () => files)
vi.mock('node:os', () => ({ homedir: () => process.cwd() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CLAUDE_CONFIG_DIR', '')
  files.stat.mockResolvedValue({ isFile: () => true, size: 200 })
  files.readFile.mockResolvedValue('{}')
})
afterEach(() => vi.unstubAllEnvs())

describe('Claude 用户供应商配置白名单', () => {
  it('读取路由与模型，不导入 hooks、权限、执行助手或任意环境变量', async () => {
    const env = {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:43210',
      ANTHROPIC_AUTH_TOKEN: 'fixture-private-provider-token',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'provider-model'
    }
    files.readFile.mockResolvedValue(
      JSON.stringify({
        env: {
          ...env,
          NODE_OPTIONS: '--require=unexpected',
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
          OPENAI_API_KEY: 'other-provider'
        },
        model: 'sonnet',
        hooks: { SessionStart: [] },
        permissions: { defaultMode: 'bypassPermissions' },
        apiKeyHelper: 'unexpected'
      })
    )
    expect(await readClaudeProviderSettings()).toEqual({ env, model: 'sonnet' })
    expect(files.readFile).toHaveBeenCalledWith(
      join(process.cwd(), '.claude', 'settings.json'),
      'utf8'
    )
  })
  it('自定义用户目录与 BOM 配置可读；不读取项目配置', async () => {
    const directory = join(process.cwd(), 'fixture-user-claude')
    vi.stubEnv('CLAUDE_CONFIG_DIR', directory)
    files.readFile.mockResolvedValue('\uFEFF{"env":{"ANTHROPIC_API_KEY":""}}')
    expect(await readClaudeProviderSettings()).toEqual({ env: { ANTHROPIC_API_KEY: '' } })
    expect(files.readFile).toHaveBeenCalledTimes(1)
    expect(files.readFile).toHaveBeenCalledWith(join(directory, 'settings.json'), 'utf8')
  })
  it('不存在时保留原生认证回退，损坏或无权读取时不静默切到其他路由', async () => {
    files.stat.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }))
    expect(await readClaudeProviderSettings()).toEqual({ env: {} })
    files.readFile.mockResolvedValueOnce('invalid fixture-private-provider-token')
    await expect(readClaudeProviderSettings()).rejects.toThrow('JSON 格式')
    files.stat.mockRejectedValueOnce(
      Object.assign(new Error('fixture-private-path'), { code: 'EACCES' })
    )
    await expect(readClaudeProviderSettings()).rejects.toThrow('无法读取 Claude 用户配置')
  })
  it('拒绝超限、错误字段类型和相对目录，错误不回显值', async () => {
    files.stat.mockResolvedValueOnce({ isFile: () => true, size: 512 * 1024 + 1 })
    await expect(readClaudeProviderSettings()).rejects.toThrow('上限')
    expect(files.readFile).not.toHaveBeenCalled()
    files.readFile.mockResolvedValueOnce('{"env":{"ANTHROPIC_AUTH_TOKEN":{"private":"fixture"}}}')
    await expect(readClaudeProviderSettings()).rejects.toThrow('无效字段')
    vi.stubEnv('CLAUDE_CONFIG_DIR', 'relative-directory')
    await expect(readClaudeProviderSettings()).rejects.toThrow('绝对路径')
  })
})
