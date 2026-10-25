vi.mock('../stores/dialog-store', () => ({ confirmDialog: vi.fn(async () => true) }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyDraftDocument, draftEntryKey } from '../../../shared/agent-drafts'
import type { AgentDraftSnapshot } from '../../../shared/agent-drafts'
import { useCodingAgentStore as store } from '../stores/coding-agent-store'
import { createAgentDraftSync, useAgentDraftSaveStore } from './agent-draft-sync'

const initial = store.getState()
let sync: ReturnType<typeof createAgentDraftSync> | null = null
beforeEach(() => {
  store.setState({
    ...initial,
    directory: '',
    draft: '',
    drafts: {},
    workspaces: {},
    info: null,
    sessions: {},
    activeId: null
  })
  vi.stubGlobal('window', { confirm: () => true })
})
afterEach(() => {
  sync?.dispose()
  sync = null
  vi.unstubAllGlobals()
})
function fixture(read = vi.fn(async () => ({ revision: 0, document: emptyDraftDocument() }))) {
  const save = vi.fn(async (input: AgentDraftSnapshot) => ({
    ...input,
    revision: input.revision + 1
  }))
  sync = createAgentDraftSync({ read, save, onFlush: () => () => {}, flushed: async () => {} })
  return { save, read, sync }
}

describe('草稿持久化协调器', () => {
  it('未选项目时的新输入也不会被迟到恢复覆盖', async () => {
    let resolve!: (value: AgentDraftSnapshot) => void
    const { sync } = fixture(
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
    )
    const loading = sync.load()
    store.getState().setDraft('尚未选项目的新输入')
    resolve({
      revision: 1,
      document: {
        version: 1,
        selection: { runtimeId: 'claude', directory: 'C:/Previous' },
        drafts: []
      }
    })
    await loading
    expect(store.getState().draft).toBe('尚未选项目的新输入')
    expect(store.getState().runtimeId).toBe('opencode')
    expect(store.getState().directory).toBe('')
    expect(await sync.flush()).toBe(false)
  })
  it('迟到读取保留新输入与清空，恢复其他历史草稿且不连接', async () => {
    let resolve!: (value: AgentDraftSnapshot) => void
    const { sync, save } = fixture(
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
    )
    const loading = sync.load()
    store.setState({ directory: 'C:/Project' })
    store.getState().setDraft('加载期间新输入')
    resolve({
      revision: 4,
      document: {
        version: 1,
        selection: { runtimeId: 'codex', directory: 'C:/Other' },
        drafts: [
          {
            runtimeId: 'opencode',
            directory: 'c:/project',
            nativeSessionId: null,
            content: '旧文本'
          },
          {
            runtimeId: 'codex',
            directory: 'c:/other',
            nativeSessionId: 'native',
            content: '历史草稿'
          }
        ]
      }
    })
    await loading
    expect(store.getState().runtimeId).toBe('opencode')
    expect(store.getState().draft).toBe('加载期间新输入')
    expect(store.getState().info).toBeNull()
    expect(store.getState().draftDocument().drafts).toHaveLength(2)
    await sync.flush()
    expect(save.mock.calls[0][0].revision).toBe(4)
  })
  it('连续保存串行进行，旧版本完成不把新输入标为已保存', async () => {
    const { sync, save } = fixture()
    await sync.load()
    store.setState({ directory: 'C:/One' })
    store.getState().setDraft('第一版')
    let finish!: (value: AgentDraftSnapshot) => void
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const flush = sync.flush()
    await Promise.resolve()
    store.getState().setDraft('第二版')
    expect(useAgentDraftSaveStore.getState().status).toBe('saving')
    finish({ revision: 1, document: save.mock.calls[0][0].document })
    expect(await flush).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].document.drafts[0].content).toBe('第二版')
    expect(useAgentDraftSaveStore.getState().status).toBe('saved')
    // 无变化的刷新也必须释放写入锁，之后仍能保存。
    await sync.flush()
    store.getState().setDraft('第三版')
    await sync.flush()
    expect(save).toHaveBeenCalledTimes(3)
  })
  it('读取失败禁止写入，重试后合并本地内容；保存失败保留内存', async () => {
    const { sync, read, save } = fixture()
    read.mockRejectedValueOnce(new Error('bad'))
    await sync.load()
    store.setState({ directory: 'C:/One' })
    store.getState().setDraft('保留')
    expect(await sync.flush()).toBe(false)
    expect(save).not.toHaveBeenCalled()
    await sync.load()
    save.mockRejectedValueOnce(new Error('系统安全存储不可用'))
    expect(await sync.flush()).toBe(false)
    expect(store.getState().draft).toBe('保留')
    expect(await sync.flush()).toBe(true)
  })
  it('重启只恢复 Agent、项目和输入，不恢复连接；孤立历史可取回和清除', async () => {
    const document = {
      version: 1 as const,
      selection: { runtimeId: 'codex' as const, directory: 'C:/One' },
      drafts: [
        {
          runtimeId: 'codex' as const,
          directory: 'c:/one',
          nativeSessionId: null,
          content: '新对话草稿'
        },
        {
          runtimeId: 'codex' as const,
          directory: 'c:/one',
          nativeSessionId: 'deleted-native',
          content: '失效会话草稿'
        }
      ]
    }
    const { sync } = fixture(vi.fn(async () => ({ revision: 1, document })))
    await sync.load()
    expect(store.getState().runtimeId).toBe('codex')
    expect(store.getState().draft).toBe('新对话草稿')
    expect(store.getState().activeId).toBeNull()
    expect(store.getState().info).toBeNull()
    await store.getState().retrieveDraft(document.drafts[1])
    expect(store.getState().draft).toBe('失效会话草稿')
    expect(store.getState().drafts[draftEntryKey('c:/one', 'deleted-native')]).toBe('失效会话草稿')
    store.getState().removeDrafts()
    expect(store.getState().draftDocument().drafts).toHaveLength(0)
  })
})
