import { afterEach, describe, expect, it, vi } from 'vitest'
import * as localSkills from './local-skill-catalog'
import * as localMcp from './local-mcp-catalog'
import { CodingAgentService, unavailableRuntime } from './coding-agent-service'
import type { CodingAgentAdapter, NativeCodingEvent, NativeCodingSession } from './adapter'
import { nativeCommands } from './agent-action-catalog'
import { validateAgentFileSearch, validateCodingAgentSend } from '../../ipc/validation'

afterEach(() => vi.restoreAllMocks())

function fixture(id: CodingAgentAdapter['id'] = 'codex') {
  const listeners = new Set<(event: NativeCodingEvent) => void>()
  const info = { ...unavailableRuntime(id), directory: '/project', available: true }
  const session: NativeCodingSession = {
    id: 'native',
    title: '项目',
    directory: '/project',
    status: 'ready',
    messages: [{ id: 'm', role: 'user', content: '已有任务' }],
    tools: [],
    options: [],
    approvals: [],
    error: ''
  }
  const emit = (view: NativeCodingSession): void => {
    for (const listener of listeners) listener({ kind: 'session', session: view })
  }
  const adapter: CodingAgentAdapter = {
    id,
    inspect: async () => info,
    selectExecutable: async () => info,
    connect: async () => {
      info.connected = true
      return info
    },
    disconnect: () => {
      info.connected = false
    },
    listSessions: async () => [],
    openSession: async () => session,
    setOption: async () => session,
    send: vi.fn(() => {
      emit({ ...session, status: 'running' })
    }),
    stop: vi.fn(),
    approve: vi.fn(),
    compact: vi.fn(async () => {
      emit({ ...session, status: 'running' })
    }),
    catalog: vi.fn(async () => ({
      commands: [{ name: 'compact', description: '压缩', argumentHint: '' }],
      skills: [{ name: 'verify', description: '校验', path: '/skills/verify/SKILL.md' }],
      mcp: [],
      notices: []
    })),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
  return { adapter, emit, session, service: new CodingAgentService([adapter]) }
}

describe('Agent 快捷操作边界', () => {
  it.each(['opencode', 'claude', 'claude-desktop', 'dsh'] as const)(
    '%s 的本机 Skill 可从首次目录引用发送，不伪造原生命令',
    async (id) => {
      vi.spyOn(localSkills, 'discoverLocalSkills').mockResolvedValue({
        skills: [
          {
            name: 'personal-review',
            path: '/managed/personal-review/SKILL.md',
            description: '本机文件引用 · 审查'
          }
        ],
        notices: []
      })
      vi.spyOn(localSkills, 'resolveLocalSkill').mockResolvedValue(
        '/managed/personal-review/SKILL.md'
      )
      vi.spyOn(localMcp, 'discoverConfiguredMcp').mockResolvedValue({ mcp: [], notices: [] })
      const { service, adapter } = fixture(id)
      await service.connect(id, 1, '/project')
      const catalog = await service.readCatalog(id, 1)
      const selected = catalog.skills.find((skill) => skill.label === 'personal-review')!
      const session = await service.openSession(id, 1)
      await service.send(id, 1, session.id, '$personal-review 检查', { references: [selected] })
      expect(adapter.send).toHaveBeenCalledWith(
        'native',
        expect.stringContaining('/managed/personal-review/SKILL.md'),
        { files: [], skills: [] }
      )
      expect(adapter.send).toHaveBeenCalledWith(
        'native',
        expect.stringContaining('不宣称已调用'),
        expect.anything()
      )
      service.dispose()
    }
  )
  it('原生禁用 Skill 不从共享目录复活，原生同名目录优先', async () => {
    vi.spyOn(localSkills, 'discoverLocalSkills').mockResolvedValue({
      skills: [
        { name: 'verify', path: '/local/verify/SKILL.md', description: '重复' },
        { name: 'blocked', path: '/local/blocked/SKILL.md', description: '禁用' }
      ],
      notices: []
    })
    vi.spyOn(localMcp, 'discoverConfiguredMcp').mockResolvedValue({
      mcp: [{ name: 'configured-only', status: '仅发现配置 · 未验证连接', tools: [] }],
      notices: []
    })
    const { service, adapter } = fixture()
    adapter.catalog = vi.fn(async () => ({
      commands: [],
      skills: [{ name: 'verify', path: '/native/verify/SKILL.md', description: '原生' }],
      disabledSkillNames: ['blocked'],
      mcp: [],
      notices: []
    }))
    await service.connect('codex', 1, '/project')
    const catalog = await service.readCatalog('codex', 1)
    expect(catalog.skills.map((skill) => skill.label)).toEqual(['verify'])
    expect(catalog.skills[0].description).toBe('原生')
    expect(catalog.mcp[0].tools).toEqual([])
    expect(catalog.mcp[0].status).toContain('未验证')
    service.dispose()
  })
  it('读取能力不创建会话；首次发送保留同项目初始 Skill 引用', async () => {
    const { adapter, service } = fixture()
    adapter.openSession = vi.fn(adapter.openSession)
    await service.connect('codex', 1, '/project')
    const catalog = await service.readCatalog('codex', 1)
    expect(adapter.openSession).not.toHaveBeenCalled()
    expect(adapter.send).not.toHaveBeenCalled()
    const session = await service.openSession('codex', 1)
    await service.send('codex', 1, session.id, '检查项目', { references: [catalog.skills[0]] })
    expect(adapter.send).toHaveBeenCalledWith('native', expect.stringContaining('$verify'), {
      files: [],
      skills: [{ name: 'verify', path: '/skills/verify/SKILL.md' }]
    })
    service.dispose()
  })

  it('未知命令在主进程阻断；普通文字选择不会触发原生斜杠解析', async () => {
    const { adapter, service } = fixture()
    await service.connect('codex', 1, '/project')
    const session = await service.openSession('codex', 1)
    await expect(service.send('codex', 1, session.id, '/missing')).rejects.toThrow('未识别')
    expect(adapter.send).not.toHaveBeenCalled()
    await service.send('codex', 1, session.id, '/missing', { literal: true })
    expect(adapter.send).toHaveBeenCalledWith(
      'native',
      expect.stringMatching(/^以下内容作为普通文本处理/),
      expect.anything()
    )
    service.dispose()
  })

  it('压缩占用现有运行槽；受理不结算，其他运行只能等原生终态', async () => {
    const { adapter, service, session, emit } = fixture()
    await service.connect('codex', 1, '/project')
    const view = await service.openSession('codex', 1)
    const catalog = await service.readCatalog('codex', 1, view.id)
    await service.executeCommand(1, {
      runtimeId: 'codex',
      sessionId: view.id,
      commandId: catalog.commands.find((item) => item.name === 'compact')!.id,
      arguments: ''
    })
    expect(adapter.compact).toHaveBeenCalledWith('native')
    await expect(service.send('codex', 1, view.id, '下一步')).rejects.toThrow('请先等待')
    emit({ ...session, outcome: 'completed' })
    await service.send('codex', 1, view.id, '下一步')
    expect(adapter.send).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it('旧连接的命令和其他窗口的引用不可执行', async () => {
    const { service } = fixture()
    await service.connect('codex', 1, '/project')
    const old = await service.openSession('codex', 1)
    const catalog = await service.readCatalog('codex', 1, old.id)
    await expect(service.readCatalog('codex', 2, old.id)).rejects.toThrow('另一个窗口')
    await service.connect('codex', 1, '/project')
    const current = await service.openSession('codex', 1)
    await expect(
      service.executeCommand(1, {
        runtimeId: 'codex',
        sessionId: current.id,
        commandId: catalog.commands[0].id,
        arguments: ''
      })
    ).rejects.toThrow('命令已失效')
    service.dispose()
  })

  it('外部输入限制类型、数量、原始长度和终端专属命令', () => {
    expect(
      nativeCommands([
        { name: 'compact' },
        { name: 'compact' },
        { name: 'logout' },
        { name: 'cd' },
        { name: 'bad\nname' }
      ]).map((item) => item.name)
    ).toEqual(['compact'])
    expect(() =>
      validateAgentFileSearch({ runtimeId: 'codex', directory: '/project', query: '\0' })
    ).toThrow()
    expect(() =>
      validateCodingAgentSend({ runtimeId: 'codex', sessionId: 'a', content: 'x', literal: 'yes' })
    ).toThrow()
    expect(() =>
      validateCodingAgentSend({
        runtimeId: 'codex',
        sessionId: 'a',
        content: 'x',
        references: [{ id: 'a', kind: 'rpc', label: 'x' }]
      })
    ).toThrow()
  })
})
