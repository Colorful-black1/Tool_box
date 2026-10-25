import { create } from 'zustand'
import type { ToolboxBridge } from '@shared/bridge'
import type { AgentDraft, AgentDraftDocument } from '@shared/agent-drafts'
import { draftIdentity } from '../../../shared/agent-drafts'
import { useCodingAgentStore } from '../stores/coding-agent-store'

/** 保存状态只反映持久化，不影响发送和内存编辑。 */
interface DraftSaveState {
  status: 'loading' | 'saving' | 'saved' | 'error'
  message: string
  entries: AgentDraft[]
}

export const useAgentDraftSaveStore = create<DraftSaveState>(() => ({
  status: 'loading',
  message: '',
  entries: []
}))

/** 唯一协调器：加载合并、500ms 防抖、串行 CAS 和退出刷新共用一条写入路径。 */
export function createAgentDraftSync(bridge: ToolboxBridge['agentDrafts'] | undefined): {
  load(): Promise<void>
  flush(): Promise<boolean>
  dispose(): void
} {
  let revision = 0
  let loaded = false
  let disposed = false
  let applying = false
  let generation = 0
  let savedGeneration = -1
  let previous = useCodingAgentStore.getState().draftDocument()
  let selectionChanged = Boolean(previous.selection)
  const references = (): unknown[] => {
    const state = useCodingAgentStore.getState()
    const workspaces = [state, ...Object.values(state.workspaces)]
    return [
      state.runtimeId,
      ...workspaces.flatMap((item) => [item.directory, item.draft, item.drafts, item.activeId])
    ]
  }
  let previousReferences = references()
  let visible = {
    runtimeId: useCodingAgentStore.getState().runtimeId,
    selection: useCodingAgentStore.getState().selection,
    draft: useCodingAgentStore.getState().draft
  }
  const dirty = new Set<string>(previous.drafts.map(draftIdentity))
  let timer: ReturnType<typeof setTimeout> | undefined
  let loading: Promise<void> | null = null
  let writing: Promise<boolean> | null = null
  const state = useAgentDraftSaveStore.setState
  const error = (message: string): void => state({ status: 'error', message })
  const schedule = (): void => {
    clearTimeout(timer)
    if (loaded && !disposed)
      timer = setTimeout(() => {
        void flush()
      }, 500)
  }
  const unsubscribe = useCodingAgentStore.subscribe(() => {
    if (applying || disposed) return
    const nextReferences = references()
    if (
      nextReferences.length === previousReferences.length &&
      nextReferences.every((value, index) => value === previousReferences[index])
    )
      return
    previousReferences = nextReferences
    const current = useCodingAgentStore.getState()
    if (
      current.runtimeId !== visible.runtimeId ||
      current.selection !== visible.selection ||
      current.draft !== visible.draft
    )
      selectionChanged = true
    if (current.runtimeId === visible.runtimeId && current.draft !== visible.draft) {
      const session = current.activeId ? current.sessions[current.activeId] : undefined
      dirty.add(
        draftIdentity({
          runtimeId: current.runtimeId,
          directory: current.directory,
          nativeSessionId: session?.nativeSessionId ?? null
        })
      )
    }
    visible = { runtimeId: current.runtimeId, selection: current.selection, draft: current.draft }
    const document = useCodingAgentStore.getState().draftDocument()
    if (JSON.stringify(document) === JSON.stringify(previous)) return
    const old = new Map(previous.drafts.map((entry) => [draftIdentity(entry), entry.content]))
    const next = new Map(document.drafts.map((entry) => [draftIdentity(entry), entry.content]))
    for (const key of new Set([...old.keys(), ...next.keys()]))
      if (old.get(key) !== next.get(key)) dirty.add(key)
    previous = document
    generation++
    state({ entries: document.drafts, ...(loaded ? { status: 'saving', message: '' } : {}) })
    schedule()
  })
  const load = (): Promise<void> => {
    if (loading) return loading
    if (!bridge) {
      error('桥接未就绪，草稿暂存于当前窗口')
      return Promise.resolve()
    }
    state({ status: 'loading', message: '' })
    loaded = false
    loading = (async () => {
      try {
        const snapshot = await bridge.read()
        if (disposed) return
        revision = snapshot.revision
        applying = true
        useCodingAgentStore.getState().restoreDrafts(snapshot.document, dirty, selectionChanged)
        applying = false
        previous = useCodingAgentStore.getState().draftDocument()
        previousReferences = references()
        const current = useCodingAgentStore.getState()
        visible = {
          runtimeId: current.runtimeId,
          selection: current.selection,
          draft: current.draft
        }
        loaded = true
        generation++
        savedGeneration =
          JSON.stringify(previous) === JSON.stringify(snapshot.document) ? generation : -1
        state({
          entries: previous.drafts,
          status: savedGeneration === generation ? 'saved' : 'saving',
          message: ''
        })
        schedule()
      } catch {
        if (!disposed) error('草稿读取失败，旧记录已保留，当前输入不会覆盖它；请重试')
      } finally {
        applying = false
        loading = null
      }
    })()
    return loading
  }
  const flush = (): Promise<boolean> => {
    clearTimeout(timer)
    if (writing) return writing
    writing = Promise.resolve().then(async () => {
      try {
        if (loading) await loading
        if (!loaded || !bridge || disposed) return false
        while (savedGeneration !== generation && !disposed) {
          const version = generation
          const document: AgentDraftDocument = useCodingAgentStore.getState().draftDocument()
          state({ status: 'saving', message: '' })
          const result = await bridge.save({ revision, document })
          revision = result.revision
          savedGeneration = version
        }
        const workspace = useCodingAgentStore.getState()
        if (
          [workspace, ...Object.values(workspace.workspaces)].some(
            (item) => !item.directory && item.draft.length > 0
          )
        ) {
          error('仍有未选择项目的草稿，选择项目后才能保存；退出可能丢失这部分文字')
          return false
        }
        if (!disposed) state({ status: 'saved', message: '' })
        return !disposed
      } catch (cause) {
        const message = cause instanceof Error ? (cause.message.split('Error: ').at(-1) ?? '') : ''
        if (!disposed)
          error(
            /[\u4e00-\u9fff]/.test(message)
              ? message.slice(0, 250)
              : '草稿保存失败，文字仍保留在当前窗口，请重试'
          )
        return false
      } finally {
        writing = null
      }
    })
    return writing
  }
  return {
    load,
    flush,
    dispose: () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe()
    }
  }
}

let active: ReturnType<typeof createAgentDraftSync> | null = null

export function startAgentDraftSync(): () => void {
  active = createAgentDraftSync(window.toolbox?.agentDrafts)
  void active.load()
  return () => {
    active?.dispose()
    active = null
  }
}

export async function retryAgentDraftSave(): Promise<void> {
  await active?.load()
  await active?.flush()
}

export function flushAgentDrafts(): Promise<boolean> {
  return active?.flush() ?? Promise.resolve(false)
}
