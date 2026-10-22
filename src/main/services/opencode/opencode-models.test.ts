import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readOpenCodeModelPreferences,
  readOpenCodeVisibleModels,
  visibleOpenCodeModelIds
} from './opencode-models'

const run = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: run }))
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: vi.fn(original.homedir) }
})

const now = Date.parse('2026-10-22T00:00:00Z')
const model = (id: string, released: string, extra: Record<string, unknown> = {}) => ({
  id,
  providerID: 'fixture',
  family: 'family',
  time: { released: Date.parse(released) },
  ...extra
})
const preference = (modelID: string, visibility: string) => ({
  providerID: 'fixture',
  modelID,
  visibility
})
const fixtures: Array<{ root: string; file: string; profile: boolean }> = []

function database(value?: string, profile = false): string {
  const root = mkdtempSync(join(tmpdir(), 'toolbox-model-test-'))
  let base = root
  if (profile) {
    vi.stubEnv('APPDATA', root)
    vi.stubEnv('XDG_CONFIG_HOME', root)
    vi.mocked(homedir).mockReturnValue(root)
    if (process.platform === 'darwin') base = join(root, 'Library', 'Application Support')
    base = join(base, 'ai.opencode.desktop')
    mkdirSync(base, { recursive: true })
  }
  const file = join(base, 'drafts.sqlite')
  fixtures.push({ root, file, profile })
  const db = new Database(file)
  db.exec('CREATE TABLE state (name TEXT, key TEXT, value TEXT, PRIMARY KEY (name, key))')
  const insert = db.prepare('INSERT INTO state VALUES (?, ?, ?)')
  insert.run('other', 'model', 'unrelated synthetic row')
  if (value !== undefined) insert.run('opencode.global.dat', 'model', value)
  db.close()
  return file
}

afterEach(() => {
  vi.unstubAllEnvs()
  run.mockReset()
  vi.mocked(homedir).mockReset()
  for (const { root, file } of fixtures.splice(0)) {
    // 仅清理本测试通过 mkdtemp 创建的单个文件和空目录，不递归删除。
    rmSync(file)
    let current = dirname(file)
    while (current !== root) {
      rmdirSync(current)
      current = dirname(current)
    }
    rmdirSync(root)
  }
})

describe('OpenCode Desktop 模型可见性', () => {
  it('显式显示旧模型、隐藏默认模型，并以最后一条勾选为准', () => {
    const data = [model('old', '2025-01-01'), model('new', '2026-10-01')]
    expect(
      visibleOpenCodeModelIds(
        { user: [preference('old', 'hide'), preference('old', 'show'), preference('new', 'hide')] },
        { data },
        now
      )
    ).toEqual(['fixture/old'])
  })

  it('无显式偏好时按供应商和家族选择最近模型，旧模型不默认显示', () => {
    const data = [
      model('older', '2026-09-01'),
      model('newer', '2026-10-01'),
      model('other-family', '2026-09-01', { family: 'other' }),
      model('other-provider', '2026-09-01', { providerID: 'other' }),
      model('too-old', '2025-01-01', { family: 'old' })
    ]
    expect(visibleOpenCodeModelIds({ user: [] }, { data }, now)).toEqual([
      'fixture/newer',
      'fixture/other-family',
      'other/other-provider'
    ])
  })

  it('仅 OpenCode 供应商按免费和付费分组，并使用默认计费档', () => {
    const data = [
      model('free', '2026-09-01', { providerID: 'opencode', cost: [{ input: 0 }] }),
      model('paid', '2026-10-01', {
        providerID: 'opencode',
        cost: [{ tier: 'large', input: 0 }, { input: 2 }]
      }),
      model('external-free', '2026-09-01', { cost: [{ input: 0 }] }),
      model('external-paid', '2026-10-01', { cost: [{ input: 2 }] })
    ]
    expect(visibleOpenCodeModelIds({ user: [] }, { data }, now)).toEqual([
      'opencode/free',
      'opencode/paid',
      'fixture/external-paid'
    ])
  })

  it('按 UTC 日期比较，同日保留首项；无有效发布日期的模型默认可见', () => {
    const data = [
      model('first', '2026-10-01T01:00:00Z'),
      model('second', '2026-10-01T23:00:00Z'),
      model('unknown', 'invalid')
    ]
    expect(visibleOpenCodeModelIds({ user: [] }, { data }, now)).toEqual([
      'fixture/first',
      'fixture/unknown'
    ])
  })

  it('隐藏未知日期模型，排除废弃或目录外模型，并去重', () => {
    const data = [
      model('unknown', 'invalid'),
      model('deprecated', '2026-10-01', { status: 'deprecated' }),
      model('same', '2026-10-01'),
      model('same', '2026-10-01'),
      null,
      { id: 'bad' }
    ]
    expect(
      visibleOpenCodeModelIds(
        {
          user: [
            preference('unknown', 'hide'),
            preference('deprecated', 'show'),
            preference('absent', 'show')
          ]
        },
        { data },
        now
      )
    ).toEqual(['fixture/same'])
  })

  it('拒绝不兼容或过大的偏好与目录，不退回完整模型列表', () => {
    expect(() => visibleOpenCodeModelIds({}, { data: [] })).toThrow('偏好格式不兼容')
    expect(() => visibleOpenCodeModelIds({ user: [] }, {})).toThrow('模型目录')
    expect(() => visibleOpenCodeModelIds({ user: Array(10001) }, { data: [] })).toThrow()
    expect(() => visibleOpenCodeModelIds({ user: [] }, { data: Array(10001) })).toThrow()
  })
})

describe('OpenCode Desktop 偏好只读访问', () => {
  it('只返回固定模型偏好键，数据库内容保持原样', () => {
    const expected = { user: [preference('one', 'show')] }
    const file = database(JSON.stringify(expected))
    const before = readFileSync(file)
    expect(readOpenCodeModelPreferences(file)).toEqual(expected)
    expect(readFileSync(file)).toEqual(before)
  })

  it('未保存勾选时使用原生默认规则，损坏内容返回安全提示', () => {
    expect(readOpenCodeModelPreferences(database())).toEqual({ user: [] })
    expect(() => readOpenCodeModelPreferences(database('invalid synthetic json'))).toThrow(
      '无法读取 OpenCode Desktop 模型勾选'
    )
  })

  it('使用项目定位的只读 CLI 接口，拒绝其他目录的响应', async () => {
    const file = database(JSON.stringify({ user: [preference('old', 'show')] }), true)
    const project = dirname(file)
    let returnedDirectory = project
    run.mockImplementation((_file, _args, _options, callback) =>
      callback(
        null,
        JSON.stringify({
          location: { directory: returnedDirectory },
          data: [model('old', '2025-01-01')]
        })
      )
    )
    expect(await readOpenCodeVisibleModels('synthetic-cli', project)).toEqual(['fixture/old'])
    expect(run).toHaveBeenCalledWith(
      'synthetic-cli',
      ['api', 'model.list', '--param', `location[directory]=${project}`],
      expect.objectContaining({ windowsHide: true, timeout: 10000 }),
      expect.any(Function)
    )
    returnedDirectory = tmpdir()
    await expect(readOpenCodeVisibleModels('synthetic-cli', project)).rejects.toThrow(
      '不属于当前项目'
    )
  })

  it('CLI 失败不回显第三方错误或输出，不回退到全量模型', async () => {
    const file = database(JSON.stringify({ user: [] }), true)
    run.mockImplementation((_file, _args, _options, callback) =>
      callback(new Error('synthetic private detail'), '')
    )
    await expect(readOpenCodeVisibleModels('synthetic-cli', dirname(file))).rejects.toThrow(
      '无法同步 OpenCode 模型目录，请确认 Desktop 服务可用后重试'
    )
    run.mockImplementation((_file, _args, _options, callback) =>
      callback(null, 'invalid synthetic json')
    )
    await expect(readOpenCodeVisibleModels('synthetic-cli', dirname(file))).rejects.toThrow(
      'OpenCode 返回的模型目录格式不兼容'
    )
  })
})
