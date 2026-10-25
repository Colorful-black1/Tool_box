import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { basename } from 'node:path'
import { readClaudeDesktopProviderSettings } from './claude-desktop-settings'

const files = vi.hoisted(() => ({ readFile: vi.fn(), stat: vi.fn() }))
vi.mock('node:fs/promises', () => files)
vi.mock('node:os', () => ({ homedir: () => process.cwd() }))

const PROFILE = '00000000-0000-4000-8000-000000000001'
const TOKEN = 'fixture-desktop-private-token'
let meta: Record<string, unknown>
let profile: Record<string, unknown>
let fetchModels: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('LOCALAPPDATA', process.cwd())
  meta = { appliedId: PROFILE, entries: [{ id: PROFILE, name: '合成配置' }] }
  profile = {
    inferenceProvider: 'gateway',
    inferenceGatewayBaseUrl: 'http://127.0.0.1:43210/claude-desktop',
    inferenceGatewayAuthScheme: 'bearer',
    inferenceGatewayApiKey: TOKEN,
    inferenceModels: [
      { name: 'claude-sonnet-fixture', labelOverride: '供应商主力模型' },
      { name: 'claude-haiku-fixture', labelOverride: '' }
    ],
    hooks: { SessionStart: 'unexpected' },
    env: { NODE_OPTIONS: 'unexpected', ANTHROPIC_API_KEY: 'unrelated-key' }
  }
  files.stat.mockResolvedValue({ isFile: () => true, size: 1000 })
  files.readFile.mockImplementation(async (path: string) =>
    JSON.stringify(basename(path) === '_meta.json' ? meta : profile)
  )
  fetchModels = vi.fn()
  vi.stubGlobal('fetch', fetchModels)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Claude Desktop 第三方 profile', () => {
  it('只读取当前 profile 的网关、认证与模型，保留映射角色而非推断上游模型', async () => {
    expect(await readClaudeDesktopProviderSettings()).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:43210/claude-desktop',
        ANTHROPIC_AUTH_TOKEN: TOKEN
      },
      model: 'claude-sonnet-fixture',
      models: [
        { value: 'claude-sonnet-fixture', label: '供应商主力模型' },
        { value: 'claude-haiku-fixture', label: 'claude-haiku-fixture' }
      ]
    })
    expect(files.readFile.mock.calls.map(([path]) => basename(path))).toEqual([
      '_meta.json',
      `${PROFILE}.json`
    ])
    expect(fetchModels).not.toHaveBeenCalled()
  })

  it('供应商切换后重读当前 profile，支持 BOM，不遍历或回退到旧配置', async () => {
    files.readFile.mockImplementation(
      async (path: string) =>
        '\uFEFF' + JSON.stringify(basename(path) === '_meta.json' ? meta : profile)
    )
    await readClaudeDesktopProviderSettings()
    const next = '00000000-0000-4000-8000-000000000002'
    meta = { appliedId: next, entries: [{ id: PROFILE }, { id: next }] }
    profile.inferenceGatewayBaseUrl = 'https://gateway.example.test/anthropic'
    profile.inferenceGatewayApiKey = 'next-fixture-key'
    profile.inferenceModels = [{ name: 'claude-opus-fixture' }]
    const result = await readClaudeDesktopProviderSettings()
    expect(result.env.ANTHROPIC_BASE_URL).toBe('https://gateway.example.test/anthropic')
    expect(result.env.ANTHROPIC_AUTH_TOKEN).toBe('next-fixture-key')
    expect(result.model).toBe('claude-opus-fixture')
    expect(basename(files.readFile.mock.calls.at(-1)![0])).toBe(`${next}.json`)
  })

  it('拒绝路径穿越、未登记 profile 与官方模式，不读 Code 或其他 profile', async () => {
    for (const appliedId of ['../private', '', 'unknown-profile']) {
      meta.appliedId = appliedId
      await expect(readClaudeDesktopProviderSettings()).rejects.toThrow('有效的第三方配置')
    }
    meta.appliedId = PROFILE
    meta.entries = []
    await expect(readClaudeDesktopProviderSettings()).rejects.toThrow('有效的第三方配置')
    expect(files.readFile.mock.calls.every(([path]) => basename(path) === '_meta.json')).toBe(true)
    meta.entries = [{ id: PROFILE }]
    profile.inferenceProvider = 'firstParty'
    await expect(readClaudeDesktopProviderSettings()).rejects.toThrow('不使用官方登录回退')
  })

  it('缺失、损坏、无权及超大文件停止读取，不暴露配置原文或凭据', async () => {
    files.stat.mockRejectedValueOnce(Object.assign(new Error(TOKEN), { code: 'ENOENT' }))
    await expect(readClaudeDesktopProviderSettings()).rejects.toThrow('启用第三方供应商')
    files.readFile.mockResolvedValueOnce(`invalid ${TOKEN}`)
    await expect(readClaudeDesktopProviderSettings()).rejects.not.toThrow(TOKEN)
    files.stat.mockRejectedValueOnce(Object.assign(new Error(TOKEN), { code: 'EACCES' }))
    await expect(readClaudeDesktopProviderSettings()).rejects.toThrow('无法读取')
    files.readFile.mockClear()
    files.stat.mockResolvedValueOnce({ isFile: () => true, size: 512 * 1024 + 1 })
    await expect(readClaudeDesktopProviderSettings()).rejects.toThrow('上限')
    expect(files.readFile).not.toHaveBeenCalled()
  })

  it('认证、地址和模型边界拒绝危险配置，错误不包含原始值', async () => {
    for (const address of [
      'file:///private',
      'http://remote.example.test',
      'https://user:fixture-key@example.test',
      `https://example.test?key=${TOKEN}`,
      'not-an-address'
    ]) {
      profile.inferenceGatewayBaseUrl = address
      await expect(readClaudeDesktopProviderSettings()).rejects.not.toThrow(address)
    }
    profile.inferenceGatewayBaseUrl = 'https://gateway.example.test'
    profile.inferenceGatewayAuthScheme = 'unsupported'
    await expect(readClaudeDesktopProviderSettings()).rejects.toThrow('不使用官方登录回退')
    profile.inferenceGatewayAuthScheme = 'bearer'
    profile.inferenceGatewayApiKey = 'invalid\nheader'
    await expect(readClaudeDesktopProviderSettings()).rejects.toThrow('认证配置无效')
    profile.inferenceGatewayApiKey = TOKEN
    profile.inferenceModels = [{ name: 'duplicate' }, { name: 'duplicate' }]
    await expect(readClaudeDesktopProviderSettings()).rejects.toThrow('重复项')
    profile.inferenceModels = Array.from({ length: 201 }, (_, i) => ({ name: `model-${i}` }))
    await expect(readClaudeDesktopProviderSettings()).rejects.toThrow('200 项')
    profile.inferenceModels = [{ name: 'bad\0model' }]
    await expect(readClaudeDesktopProviderSettings()).rejects.toThrow('模型配置无效')
  })

  it('未指定模型时只查询同一网关模型元数据，禁止重定向并设置超时', async () => {
    delete profile.inferenceModels
    fetchModels.mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'claude-sonnet-fixture', display_name: '主力' }] })
      )
    )
    const result = await readClaudeDesktopProviderSettings()
    expect(result.models).toEqual([{ value: 'claude-sonnet-fixture', label: '主力' }])
    expect(fetchModels).toHaveBeenCalledWith(
      'http://127.0.0.1:43210/claude-desktop/v1/models',
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({ authorization: `Bearer ${TOKEN}` })
      })
    )
    expect(fetchModels).toHaveBeenCalledTimes(1)
  })

  it('网关错误、空模型与超大响应不回退原生模型，也不输出响应或 Key', async () => {
    delete profile.inferenceModels
    for (const response of [
      new Response(TOKEN, { status: 401 }),
      new Response(JSON.stringify({ data: [] })),
      new Response('x'.repeat(512 * 1024 + 1)),
      new Response(JSON.stringify({ data: { private: TOKEN } }))
    ]) {
      fetchModels.mockResolvedValueOnce(response)
      await expect(readClaudeDesktopProviderSettings()).rejects.not.toThrow(TOKEN)
    }
  })
})
