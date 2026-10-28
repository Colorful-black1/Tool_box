import { confirmDialog } from './dialog-store'
import { create } from 'zustand'
import { CODING_AGENT_NAMES } from '../../../shared/coding-agents'
import type {
  CodingAgentEvent,
  CodingAgentId,
  CodingAgentRuntimeView,
  CodingAgentSessionSummary,
  CodingAgentSessionView
} from '@shared/coding-agents'
import { codingAgentClient } from '../lib/coding-agent-client'
import { CODING_AGENT_IDS, WORKBENCH_AGENT_IDS } from '../../../shared/coding-agents'
import { draftEntryKey, draftIdentity, normalizeDraftDirectory } from '../../../shared/agent-drafts'
import type { AgentDraft, AgentDraftDocument } from '@shared/agent-drafts'
import type { AgentSendInput } from '@shared/agent-actions'

/** 正文只留在内存；未发送草稿由独立协调器加密保存。 */
interface RuntimeWorkspace {
  info: CodingAgentRuntimeView | null
  directory: string
  sessions: Record<string, CodingAgentSessionView>
  activeId: string | null
  history: CodingAgentSessionSummary[]
  historyLoaded: boolean
  draft: string
  drafts: Record<string, string>
  transferred: boolean
  busy: boolean
  connecting: boolean
  selection: number
  runtimeRevision: number
  error: string
}

/** 选中工作台平铺以复用旧组件；后台工作台单独保存，异步回写不改变选择。 */
interface CodingAgentState extends RuntimeWorkspace {
  runtimeId: CodingAgentId
  workspaces: Partial<Record<CodingAgentId, RuntimeWorkspace>>
  runningRuntime: CodingAgentId | null
  runningSession: string | null
  preparingRuntime: CodingAgentId | null
  switchRuntime(id: CodingAgentId): void
  inspect(force?: boolean): Promise<void>
  chooseExecutable(): Promise<void>
  chooseDirectory(): Promise<void>
  connect(): Promise<void>
  disconnect(): Promise<void>
  newSession(): void
  openSession(nativeId: string, carryDraft?: boolean): Promise<void>
  listSessions(): Promise<void>
  setOption(id: string, value: string): Promise<void>
  send(extra?: Pick<AgentSendInput, 'references' | 'literal'>): Promise<void>
  summarize(): Promise<void>
  cancelPreparation(): void
  viewRunning(): void
  stop(): Promise<void>
  approve(id: string, approved: boolean): Promise<void>
  openDesktop(): Promise<void>
  setDraft(text: string): void
  selectSession(id: string): Promise<void>
  receive(event: CodingAgentEvent): void
  clearError(): void
  transferMessage(messageId: string, targetId?: CodingAgentId): Promise<void>
  draftDocument(): AgentDraftDocument
  restoreDrafts(document: AgentDraftDocument, dirty: Set<string>, selectionChanged: boolean): void
  removeDrafts(identity?: string): void
  retrieveDraft(draft: AgentDraft): Promise<void>
}

function emptyWorkspace(): RuntimeWorkspace {
  return {
    info: null,
    directory: '',
    sessions: {},
    activeId: null,
    history: [],
    historyLoaded: false,
    draft: '',
    drafts: {},
    transferred: false,
    busy: false,
    connecting: false,
    selection: 0,
    runtimeRevision: 0,
    error: ''
  }
}

function workspace(state: RuntimeWorkspace): RuntimeWorkspace {
  const {
    info,
    directory,
    sessions,
    activeId,
    history,
    historyLoaded,
    draft,
    drafts,
    transferred,
    busy,
    connecting,
    selection,
    runtimeRevision,
    error
  } = state
  return {
    info,
    directory,
    sessions,
    activeId,
    history,
    historyLoaded,
    draft,
    drafts,
    transferred,
    busy,
    connecting,
    selection,
    runtimeRevision,
    error
  }
}

function draftKey(state: RuntimeWorkspace): string {
  const session = state.activeId ? state.sessions[state.activeId] : undefined
  return session
    ? draftEntryKey(session.directory, session.nativeSessionId)
    : draftEntryKey(state.directory, null)
}

/** 两个运行时使用同一规范化项目路径；不把 renderer 路径当作主进程校验。 */
function sameDirectory(a: string, b: string): boolean {
  const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/$/, '')
  const left = normalize(a),
    right = normalize(b)
  return /^[a-z]:/i.test(left) ? left.toLowerCase() === right.toLowerCase() : left === right
}

function changeProject(state: RuntimeWorkspace, directory: string): RuntimeWorkspace {
  if (sameDirectory(state.directory, directory)) return state
  return {
    ...state,
    directory,
    activeId: null,
    history: [],
    historyLoaded: false,
    selection: state.selection + 1,
    drafts: { ...state.drafts, [draftKey(state)]: state.draft },
    draft: state.drafts[draftEntryKey(directory, null)] ?? (state.directory ? '' : state.draft),
    transferred: false
  }
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? (error.message.split('Error: ').at(-1) ?? '') : ''
  return /[\u4e00-\u9fff]/.test(message) ? message.slice(0, 300) : 'Agent 操作失败，请重试'
}

export const useCodingAgentStore = create<CodingAgentState>((set, get) => {
  // 锁覆盖首次连接、新建和发送确认窗口，切换页面也不能重复提交；不做后台排队。
  let submission: { cancelled: boolean; sending: boolean } | null = null
  const read = (id: CodingAgentId): RuntimeWorkspace =>
    id === get().runtimeId ? workspace(get()) : (get().workspaces[id] ?? emptyWorkspace())
  const update = (
    id: CodingAgentId,
    change: Partial<RuntimeWorkspace> | ((current: RuntimeWorkspace) => Partial<RuntimeWorkspace>)
  ): void => {
    set((state) => {
      const current =
        id === state.runtimeId ? workspace(state) : (state.workspaces[id] ?? emptyWorkspace())
      const patch = typeof change === 'function' ? change(current) : change
      return id === state.runtimeId
        ? patch
        : {
            workspaces: { ...state.workspaces, [id]: { ...current, ...patch } }
          }
    })
  }
  const perform = async (
    action: (id: CodingAgentId) => Promise<void>,
    id = get().runtimeId
  ): Promise<void> => {
    if (read(id).busy) return
    update(id, { busy: true, error: '' })
    try {
      await action(id)
    } catch (error) {
      update(id, { error: errorText(error) })
    } finally {
      update(id, { busy: false })
    }
  }
  const upsert = (view: CodingAgentSessionView): void => {
    const id = view.runtimeId
    const current = read(id)
    if (current.info?.connectionId !== view.connectionId) return
    if ((current.sessions[view.id]?.revision ?? -1) >= view.revision) return
    update(id, (state) => ({
      sessions: { ...state.sessions, [view.id]: view },
      history: state.history.map((item) =>
        item.id === view.nativeSessionId ? { ...item, title: view.title } : item
      )
    }))
    if (view.status === 'running' || view.status === 'stopping')
      set({ runningRuntime: id, runningSession: view.id })
    else if (get().runningRuntime === id && get().runningSession === view.id)
      set({ runningRuntime: null, runningSession: null })
  }
  const ensureConnected = async (id: CodingAgentId, directory: string): Promise<void> => {
    const before = read(id)
    if (!directory) throw new Error('请先选择项目')
    if (before.info?.connected && sameDirectory(before.info.directory, directory)) return
    update(id, { connecting: true })
    try {
      const info = await codingAgentClient().connect({ runtimeId: id, directory })
      if (!sameDirectory(read(id).directory, directory))
        throw new Error('项目已变化，请在当前项目重新操作')
      update(id, (state) => {
        const selected = state.activeId ? state.sessions[state.activeId] : undefined
        // 重连只准备通信；选中的旧会话须明确恢复，不能变成新会话并重发旧草稿。
        const retain = selected && sameDirectory(selected.directory, info.directory)
        return {
          info,
          directory: info.directory,
          drafts: { ...state.drafts, [draftKey(state)]: state.draft },
          sessions: retain ? { [selected.id]: { ...selected, status: 'disconnected' } } : {},
          activeId: retain ? selected.id : null,
          history: [],
          historyLoaded: false
        }
      })
    } finally {
      update(id, { connecting: false })
    }
  }
  // 确认框不阻塞事件循环，恢复/同步期间的新输入不能被旧快照覆盖。
  const unchanged = (id: CodingAgentId, before: RuntimeWorkspace): boolean => {
    const current = read(id)
    return (
      current.selection === before.selection &&
      sameDirectory(current.directory, before.directory) &&
      current.draft === before.draft &&
      Object.keys(current.drafts).length === Object.keys(before.drafts).length &&
      Object.entries(before.drafts).every(([key, text]) => current.drafts[key] === text)
    )
  }
  const activate = async (id: CodingAgentId, ref: string, carryDraft = false): Promise<void> => {
    const state = read(id)
    const session = state.sessions[ref]
    if (!session || !sameDirectory(session.directory, state.directory)) return
    if (state.activeId === ref) return
    const key = draftEntryKey(session.directory, session.nativeSessionId)
    const existing = state.drafts[key] ?? ''
    if (
      carryDraft &&
      existing.trim() &&
      existing !== state.draft &&
      !(await confirmDialog('目标会话已有未发送草稿，是否替换？'))
    )
      return
    if (!unchanged(id, state) || !read(id).sessions[ref]) {
      update(get().runtimeId, { error: '草稿或当前选择已变化，请重新操作' })
      return
    }
    update(id, {
      activeId: ref,
      selection: state.selection + 1,
      drafts: { ...state.drafts, [draftKey(state)]: state.draft },
      draft: carryDraft ? state.draft : existing,
      transferred: carryDraft && state.transferred
    })
  }
  const submit = async (
    summary = false,
    extra: Pick<AgentSendInput, 'references' | 'literal'> = {}
  ): Promise<void> => {
    const id = get().runtimeId
    const before = read(id)
    if (before.busy || submission || get().runningRuntime) return
    const content = summary
      ? '请依据本会话已有信息，为接手任务的另一个编程 Agent 输出简洁的交接说明。包含任务目标、关键约束、已完成工作与涉及文件、重要决定、验证结果、未完成事项及建议下一步。区分事实与推测；未执行的验证写明“未执行”，无法确认的写明“待核对”。仅输出说明，不为总结执行命令、调用工具或修改文件，不包含密钥及其他敏感内容。'
      : before.draft.trim()
    if (!content || content.length > 50_000) {
      update(id, { error: '任务需在 1 至 50,000 字以内' })
      return
    }
    if (!before.activeId && /^\/compact(?:\s|$)/.test(content) && !extra.literal) {
      update(id, { error: '请先打开已有会话，再压缩上下文；未创建新会话' })
      return
    }
    if (summary && !before.activeId) return
    const attempt = { cancelled: false, sending: false }
    submission = attempt
    set({ preparingRuntime: id })
    try {
      await perform(async () => {
        const verifySelection = (): void => {
          if (attempt.cancelled) throw new Error('已取消本次发送，草稿已保留')
          if (
            read(id).selection !== before.selection ||
            !sameDirectory(read(id).directory, before.directory)
          )
            throw new Error('当前选择已变化，未发送任务，草稿已保留')
        }
        if (before.activeId && !before.info?.connected)
          throw new Error('会话已断开，请从历史恢复，或开始新对话')
        await ensureConnected(id, before.directory)
        verifySelection()
        let ref = before.activeId
        if (!ref) {
          const view = await codingAgentClient().createSession(id)
          upsert(view)
          if (read(id).info?.connectionId !== view.connectionId)
            throw new Error('连接已结束，草稿已保留')
          ref = view.id
          if (read(id).selection === before.selection)
            update(id, (state) => ({
              activeId: view.id,
              drafts: { ...state.drafts, [draftKey(state)]: '' }
            }))
          verifySelection()
        }
        const state = read(id)
        const session = state.sessions[ref]
        if (
          !session ||
          session.connectionId !== state.info?.connectionId ||
          !sameDirectory(session.directory, before.directory)
        )
          throw new Error('会话已变化，未发送任务，请重新选择')
        if (session.status !== 'ready' && session.status !== 'error')
          throw new Error('会话尚未就绪，请等待或从历史恢复')
        const model = session.options.find((option) => option.category === 'model')
        if (model && !state.info?.visibleModelIds.includes(model.currentValue))
          throw new Error('请先选择可用模型，再发送任务')
        const key = draftKey(state)
        attempt.sending = true
        set({ preparingRuntime: null })
        await codingAgentClient().send({ runtimeId: id, sessionId: ref, content, ...extra })
        if (summary) return
        update(id, (current) => {
          const drafts = { ...current.drafts }
          if (drafts[key] === before.draft) drafts[key] = ''
          return {
            drafts,
            ...(draftKey(current) === key && current.draft === before.draft
              ? { draft: '', transferred: false }
              : {})
          }
        })
      }, id)
    } finally {
      if (submission === attempt) {
        submission = null
        set({ preparingRuntime: null })
      }
    }
  }
  return {
    ...emptyWorkspace(),
    runtimeId: 'opencode',
    workspaces: {},
    runningRuntime: null,
    runningSession: null,
    preparingRuntime: null,
    switchRuntime: (id) => {
      if (id === get().runtimeId) return
      set((state) => {
        const next = state.workspaces[id] ?? emptyWorkspace()
        return {
          ...(next.busy || state.runningRuntime === id
            ? next
            : changeProject(next, state.directory || next.directory)),
          runtimeId: id,
          workspaces: { ...state.workspaces, [state.runtimeId]: workspace(state) }
        }
      })
    },
    inspect: (force = false) => {
      if (get().info && !force) return Promise.resolve()
      return perform(async (id) => {
        const info = await codingAgentClient().inspect(id)
        update(id, (state) => ({ info, directory: state.directory || info.directory }))
      })
    },
    chooseExecutable: () =>
      perform(async (id) => {
        const info = await codingAgentClient().chooseExecutable(id)
        if (info) update(id, { info })
      }),
    chooseDirectory: () =>
      perform(async (id) => {
        const directory = await codingAgentClient().chooseDirectory()
        if (!directory) return
        update(id, (state) => changeProject(state, directory))
      }),
    connect: () => perform((id) => ensureConnected(id, read(id).directory)),
    disconnect: () =>
      perform(async (id) => {
        await codingAgentClient().disconnect(id)
        update(id, (state) => ({ info: state.info ? { ...state.info, connected: false } : null }))
      }),
    newSession: () => {
      const id = get().runtimeId
      const state = read(id)
      if (state.busy || !state.activeId) return
      update(id, {
        activeId: null,
        selection: state.selection + 1,
        drafts: { ...state.drafts, [draftKey(state)]: state.draft },
        draft: state.drafts[draftEntryKey(state.directory, null)] ?? '',
        transferred: false
      })
    },
    openSession: (nativeId, carryDraft = false) =>
      perform(async (id) => {
        const before = read(id)
        const cached = Object.values(before.sessions).find(
          (item) =>
            item.nativeSessionId === nativeId &&
            before.info?.connected &&
            item.connectionId === before.info?.connectionId &&
            item.status !== 'disconnected' &&
            sameDirectory(item.directory, before.directory)
        )
        // Claude 的正文可能由外部客户端更新；空闲时明确点选就重读，不只激活缓存。
        if (
          cached &&
          ((id !== 'claude' && id !== 'claude-desktop') || get().runningRuntime || submission)
        ) {
          await activate(id, cached.id, carryDraft)
          return
        }
        if (get().runningRuntime || submission) throw new Error('请先等待或停止当前任务')
        const selection = before.selection + 1
        update(id, { selection })
        await ensureConnected(id, before.directory)
        const view = await codingAgentClient().resumeSession({ runtimeId: id, sessionId: nativeId })
        upsert(view)
        if (read(id).info?.connectionId !== view.connectionId) return
        if (read(id).selection === selection) await activate(id, view.id, carryDraft)
      }),
    listSessions: () =>
      perform(async (id) => {
        const directory = read(id).directory
        await ensureConnected(id, directory)
        const connection = read(id).info?.connectionId
        const history = await codingAgentClient().listSessions(id)
        if (
          connection === read(id).info?.connectionId &&
          sameDirectory(directory, read(id).directory)
        ) {
          update(id, { history, historyLoaded: true })
          const current = read(id)
          const selected = current.activeId ? current.sessions[current.activeId] : undefined
          if (
            (id === 'claude' || id === 'claude-desktop') &&
            !get().runningRuntime &&
            !submission &&
            selected &&
            selected.connectionId === connection &&
            history.some((item) => item.id === selected.nativeSessionId)
          ) {
            const view = await codingAgentClient().resumeSession({
              runtimeId: id,
              sessionId: selected.nativeSessionId
            })
            if (sameDirectory(directory, read(id).directory)) upsert(view)
          }
        }
      }),
    setOption: (optionId, value) =>
      perform(async (id) => {
        const sessionId = read(id).activeId
        if (sessionId)
          upsert(await codingAgentClient().setOption({ runtimeId: id, sessionId, optionId, value }))
      }),
    send: (extra) => submit(false, extra),
    summarize: () => submit(true),
    cancelPreparation: () => {
      if (submission && !submission.sending) submission.cancelled = true
    },
    viewRunning: () => {
      const { runningRuntime: id, runningSession: ref } = get()
      if (!id || !ref) return
      get().switchRuntime(id)
      const session = read(id).sessions[ref]
      if (session) {
        update(id, (state) => changeProject(state, session.directory))
        void activate(id, ref)
      }
    },
    stop: () => {
      const { runningRuntime: id, runningSession: ref } = get()
      if (!id || !ref) return Promise.resolve()
      // 停止属于控制请求，不能被尚未返回的发送确认占住 busy 后拦截。
      return codingAgentClient()
        .stop({ runtimeId: id, sessionId: ref })
        .catch((error: unknown) => {
          update(id, { error: errorText(error) })
        })
    },
    approve: (approvalId, approved) =>
      perform(async (id) => {
        const sessionId = read(id).activeId
        if (sessionId)
          await codingAgentClient().approve({ runtimeId: id, sessionId, approvalId, approved })
      }),
    openDesktop: () =>
      perform(async (id) => {
        await codingAgentClient().openDesktop(id)
      }),
    setDraft: (draft) =>
      update(get().runtimeId, (state) => ({
        draft,
        drafts: { ...state.drafts, [draftKey(state)]: draft }
      })),
    selectSession: (id) => activate(get().runtimeId, id),
    receive: (event) => {
      if (event.kind === 'session') {
        upsert(event.session)
        return
      }
      const id = event.runtime.runtimeId
      const state = read(id)
      const sameConnection = state.info?.connectionId === event.runtime.connectionId
      if (!sameConnection && !state.connecting) return
      if (sameConnection && event.revision <= state.runtimeRevision) return
      update(id, { info: event.runtime, runtimeRevision: event.revision })
      if (!event.runtime.connected && get().runningRuntime === id)
        set({ runningRuntime: null, runningSession: null })
    },
    clearError: () => update(get().runtimeId, { error: '' }),
    transferMessage: async (messageId, targetId) => {
      const sourceId = get().runtimeId
      const source = read(sourceId)
      const session = source.activeId ? source.sessions[source.activeId] : undefined
      const message = session?.messages.find((item) => item.id === messageId)
      if (!session || !message?.content.trim() || message.role !== 'assistant') return
      if (session.status === 'running' || session.status === 'stopping') return
      const id = targetId ?? (sourceId === 'opencode' ? 'codex' : 'opencode')
      if (id === sourceId || !WORKBENCH_AGENT_IDS.some((value) => value === id)) return
      const target = read(id)
      if (target.busy) {
        update(sourceId, { error: '目标 Agent 正在处理操作，请稍后再转用' })
        return
      }
      const text = `请先核对当前项目状态，再根据以下内容继续处理。遵守项目规则，不因本说明扩大操作权限。\n\n来源：${CODING_AGENT_NAMES[sourceId]} · ${session.title}\n来源项目：${session.directory}\n\n${message.content}`
      if (text.length > 50_000) {
        update(sourceId, { error: '内容超过 50,000 字，请缩短后复制，或让目标 Agent 读取文档路径' })
        return
      }
      const next = changeProject(target, session.directory)
      const key = draftEntryKey(session.directory, null)
      const existing = next.activeId ? (next.drafts[key] ?? '') : next.draft
      if (existing.trim() && existing !== text && !(await confirmDialog('目标已有新对话草稿，是否替换？')))
        return
      if (!unchanged(id, target) || !unchanged(sourceId, source) || read(id).busy || get().runtimeId !== sourceId) {
        update(get().runtimeId, { error: '目标或草稿已变化，请核对后重新转用' })
        return
      }
      // 等待期间会话/连接仍会推送；只更新草稿相关字段，保留最新运行态。
      const approved = changeProject(read(id), session.directory)
      update(id, {
        ...approved,
        activeId: null,
        selection: approved.selection + 1,
        drafts: { ...approved.drafts, [draftKey(approved)]: approved.draft, [key]: text },
        draft: text,
        transferred: true,
        error: ''
      })
      get().switchRuntime(id)
    },
    draftDocument: () => {
      const drafts: AgentDraft[] = []
      for (const runtimeId of CODING_AGENT_IDS) {
        const state = read(runtimeId)
        const entries = { ...state.drafts, [draftKey(state)]: state.draft }
        for (const [key, content] of Object.entries(entries)) {
          if (!content) continue
          const [directory, nativeSessionId] = JSON.parse(key) as [string, string | null]
          // 尚未选择项目的内存输入，等用户选定绝对路径后再保存。
          if (!/^(?:[a-z]:\/|\/)/i.test(directory)) continue
          drafts.push({ runtimeId, directory, nativeSessionId, content })
        }
      }
      const { runtimeId, directory } = get()
      return {
        version: 1,
        selection: directory ? { runtimeId, directory: normalizeDraftDirectory(directory) } : null,
        drafts: drafts.sort((a, b) => draftIdentity(a).localeCompare(draftIdentity(b)))
      }
    },
    restoreDrafts: (document, dirty, selectionChanged) => {
      // 重读时同步远端已清除的条目；本窗口加载期间修改过的身份始终优先。
      for (const runtimeId of CODING_AGENT_IDS) {
        update(runtimeId, (state) => {
          const drafts = Object.fromEntries(
            Object.entries(state.drafts).filter(([key]) =>
              dirty.has(JSON.stringify([runtimeId, key]))
            )
          )
          return {
            drafts,
            ...(dirty.has(JSON.stringify([runtimeId, draftKey(state)])) ? {} : { draft: '' })
          }
        })
      }
      for (const entry of document.drafts) {
        if (dirty.has(draftIdentity(entry))) continue
        update(entry.runtimeId, (state) => ({
          drafts: {
            ...state.drafts,
            [draftEntryKey(entry.directory, entry.nativeSessionId)]: entry.content
          },
          ...(draftKey(state) === draftEntryKey(entry.directory, entry.nativeSessionId)
            ? { draft: entry.content }
            : {})
        }))
      }
      if (!selectionChanged && document.selection) {
        const { runtimeId, directory } = document.selection
        const previous = get()
        const next = changeProject(read(runtimeId), directory)
        set({
          ...next,
          runtimeId,
          workspaces: { ...previous.workspaces, [previous.runtimeId]: workspace(previous) }
        })
      }
    },
    removeDrafts: (identity) => {
      for (const runtimeId of CODING_AGENT_IDS) {
        update(runtimeId, (state) => {
          const drafts = { ...state.drafts }
          for (const key of Object.keys(drafts)) {
            const [directory, nativeSessionId] = JSON.parse(key) as [string, string | null]
            if (!identity || identity === draftIdentity({ runtimeId, directory, nativeSessionId }))
              delete drafts[key]
          }
          const current = JSON.stringify([runtimeId, draftKey(state)])
          return {
            drafts,
            ...(!identity || identity === current ? { draft: '', transferred: false } : {})
          }
        })
      }
    },
    retrieveDraft: async (entry) => {
      const target = read(entry.runtimeId)
      if (target.busy || get().runningRuntime) return
      const next = changeProject(target, entry.directory)
      const key = draftEntryKey(entry.directory, null)
      const existing = next.activeId ? (next.drafts[key] ?? '') : next.draft
      if (existing && existing !== entry.content && !(await confirmDialog('新对话已有草稿，是否替换？')))
        return
      if (!unchanged(entry.runtimeId, target) || read(entry.runtimeId).busy || get().runningRuntime) {
        update(get().runtimeId, { error: '目标或草稿已变化，请核对后重新取回' })
        return
      }
      const approved = changeProject(read(entry.runtimeId), entry.directory)
      update(entry.runtimeId, {
        ...approved,
        activeId: null,
        selection: approved.selection + 1,
        drafts: { ...approved.drafts, [draftKey(approved)]: approved.draft, [key]: entry.content },
        draft: entry.content,
        transferred: false
      })
      get().switchRuntime(entry.runtimeId)
    }
  }
})
