import { describe, expect, it, vi } from 'vitest'
import { CodingAgentService, unavailableRuntime } from './coding-agent-service'
import type { CodingAgentAdapter, NativeCodingEvent, NativeCodingSession } from './adapter'
import { nativeCommands } from './agent-action-catalog'
import { validateAgentFileSearch, validateCodingAgentSend } from '../../ipc/validation'

function fixture() {
  const listeners = new Set<(event: NativeCodingEvent) => void>()
  const info = { ...unavailableRuntime('codex'), directory: '/project', available: true }
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
    id: 'codex',
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
