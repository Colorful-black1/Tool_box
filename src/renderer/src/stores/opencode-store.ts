import { create } from 'zustand'
import type {
  OpenCodeEvent,
  OpenCodeInfo,
  OpenCodeSession,
  OpenCodeSessionSummary
} from '@shared/types'
import type { ToolboxBridge } from '@shared/bridge'

/** 桌面错误仅显示主进程收敛后的中文文案，去掉 Electron 的通道包装。 */
function errorText(error: unknown): string {
  const message = error instanceof Error ? (error.message.split('Error: ').at(-1) ?? '') : ''
  return /[\u4e00-\u9fff]/.test(message) ? message.slice(0, 300) : 'OpenCode 操作失败，请重试'
}

function bridge(): ToolboxBridge['opencode'] {
  if (!window.toolbox?.opencode) throw new Error('桌面桥接未就绪，请通过最新桌面应用运行')
  return window.toolbox.opencode
}

/** 外部会话视图和待发送草稿仅在内存中保留，原生会话由 OpenCode 管理。 */
interface OpenCodeState {
  info: OpenCodeInfo | null
  directory: string
  sessions: Record<string, OpenCodeSession>
  activeId: string | null
  history: OpenCodeSessionSummary[]
  draft: string
  busy: boolean
  error: string
  inspect(force?: boolean): Promise<void>
  chooseExecutable(): Promise<void>
  chooseDirectory(): Promise<void>
  connect(): Promise<void>
  disconnect(): Promise<void>
  openSession(id?: string): Promise<void>
  listSessions(): Promise<void>
  setOption(id: string, value: string): Promise<void>
  send(): Promise<void>
  stop(): Promise<void>
  approve(id: string, approved: boolean): Promise<void>
  openDesktop(): Promise<void>
  setDraft(text: string): void
  selectSession(id: string): void
  receive(event: OpenCodeEvent): void
  clearError(): void
}

export const useOpenCodeStore = create<OpenCodeState>((set, get) => {
  const perform = async (action: () => Promise<void>): Promise<void> => {
    if (get().busy) return
    set({ busy: true, error: '' })
    try {
      await action()
    } catch (error) {
      set({ error: errorText(error) })
    } finally {
      set({ busy: false })
    }
  }
  const upsert = (session: OpenCodeSession): void =>
    set((state) => ({ sessions: { ...state.sessions, [session.id]: session } }))
  return {
    info: null,
    directory: '',
    sessions: {},
    activeId: null,
    history: [],
    draft: '',
    busy: false,
    error: '',
    inspect: async (force = false) => {
      if (get().info && !force) return
      await perform(async () => {
        const info = await bridge().inspect()
        set({ info, directory: get().directory || info.directory })
      })
    },
    chooseExecutable: () =>
      perform(async () => {
        const info = await bridge().chooseExecutable()
        if (info) set({ info })
      }),
    chooseDirectory: () =>
      perform(async () => {
        const directory = await bridge().chooseDirectory()
        if (directory) set({ directory })
      }),
    connect: () =>
      perform(async () => {
        const info = await bridge().connect(get().directory)
        set({ info, sessions: {}, activeId: null, history: [] })
        const session = await bridge().openSession()
        upsert(session)
        set({ activeId: session.id })
      }),
    disconnect: () =>
      perform(async () => {
        await bridge().disconnect()
        set((state) => ({ info: state.info ? { ...state.info, connected: false } : null }))
      }),
    openSession: (id) =>
      perform(async () => {
        const session = await bridge().openSession(id)
        upsert(session)
        set({ activeId: session.id })
      }),
    listSessions: () => perform(async () => set({ history: await bridge().listSessions() })),
    setOption: (id, value) =>
      perform(async () => {
        if (!get().activeId) return
        upsert(await bridge().setOption({ sessionId: get().activeId!, optionId: id, value }))
      }),
    send: () =>
      perform(async () => {
        const { activeId, draft } = get()
        if (!activeId || !draft.trim()) return
        await bridge().send({ sessionId: activeId, content: draft.trim() })
        if (get().draft === draft) set({ draft: '' })
      }),
    stop: () =>
      perform(async () => {
        if (get().activeId) await bridge().stop(get().activeId!)
      }),
    approve: (approvalId, approved) =>
      perform(async () => {
        if (get().activeId)
          await bridge().approve({ sessionId: get().activeId!, approvalId, approved })
      }),
    openDesktop: () =>
      perform(async () => {
        await bridge().openDesktop()
      }),
    setDraft: (draft) => set({ draft }),
    selectSession: (id) => {
      if (get().sessions[id]) set({ activeId: id })
    },
    receive: (event) => {
      if (event.kind === 'session') upsert(event.session)
      else
        set((state) => ({
          info: state.info ? { ...state.info, connected: event.connected } : null
        }))
    },
    clearError: () => set({ error: '' })
  }
})
