import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent, ReactNode } from 'react'
import type { AgentCatalog, AgentFileSearchResult, AgentReference } from '@shared/agent-actions'
import { CODING_AGENT_NAMES } from '@shared/coding-agents'
import { normalizeDraftDirectory } from '@shared/agent-drafts'
import { useCodingAgentStore } from '../../stores/coding-agent-store'
import { codingAgentClient } from '../../lib/coding-agent-client'
import {
  agentInputTrigger,
  localAgentCommand,
  LOCAL_AGENT_COMMANDS,
  type LocalAgentCommand
} from '../../lib/agent-composer-input'
import { AgentActionMenu, type AgentActionChoice } from './agent-action-menu'
import { AgentContextStatus } from './agent-context-status'
import { AgentComposerOptions } from './agent-composer-options'
import { AgentComposerTools } from './agent-composer-tools'
import { confirmDialog } from '../../stores/dialog-store'
import { CloseIcon, SendIcon, StopIcon } from '../icons'

type Menu = 'commands' | 'files' | 'skills' | 'mcp'

/** 输入区沿用一次发送准备流程，候选不创建空会话或主动执行模型任务。 */
export function AgentComposer({
  canSend,
  children,
  onLocalAction
}: {
  canSend: boolean
  children?: ReactNode
  onLocalAction(action: 'history' | 'model' | 'permissions'): void
}): JSX.Element {
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const directory = useCodingAgentStore((state) => state.directory)
  const activeId = useCodingAgentStore((state) => state.activeId)
  const info = useCodingAgentStore((state) => state.info)
  const draft = useCodingAgentStore((state) => state.draft)
  const busy = useCodingAgentStore((state) => state.busy)
  const transferred = useCodingAgentStore((state) => state.transferred)
  const recall = useCodingAgentStore((state) => state.recall)
  const recallSequence = useCodingAgentStore((state) => state.recallSequence)
  const cancelRecall = useCodingAgentStore((state) => state.cancelRecall)
  const runningSession = useCodingAgentStore((state) => state.runs[state.runtimeId]?.sessionId)
  const preparing = useCodingAgentStore((state) => state.preparations[state.runtimeId])
  const session = useCodingAgentStore((state) => (activeId ? state.sessions[activeId] : undefined))
  const setDraft = useCodingAgentStore((state) => state.setDraft)
  const send = useCodingAgentStore((state) => state.send)
  const connect = useCodingAgentStore((state) => state.connect)
  const newSession = useCodingAgentStore((state) => state.newSession)
  const stop = useCodingAgentStore((state) => state.stop)
  const cancelPreparation = useCodingAgentStore((state) => state.cancelPreparation)
  const input = useRef<HTMLTextAreaElement>(null)
  const composerBox = useRef<HTMLDivElement>(null)
  const selection = useRef<ReturnType<typeof agentInputTrigger>>(null)
  const previousSession = useRef(activeId)
  const submitting = useRef(false)
  const [mode, setMode] = useState<Menu | null>(null)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState(false)
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null)
  const [files, setFiles] = useState<AgentFileSearchResult>({ files: [], limited: false })
  const [references, setReferences] = useState<AgentReference[]>([])
  const recalledReferences = useRef<{
    draft: string
    items: AgentReference[]
    sessionId: string | null
    connectionId?: string
  } | null>(null)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const locked = busy || Boolean(runningSession || preparing)
  const close = useCallback(() => {
    setMode(null)
    setLoading(false)
    selection.current = null
  }, [setMode, setLoading])
  useEffect(() => {
    if (!recallSequence) return
    const frame = requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(input.current.value.length, input.current.value.length)
    })
    close()
    return () => cancelAnimationFrame(frame)
  }, [recallSequence, close])
  useEffect(() => {
    if (recall) {
      if (!recalledReferences.current)
        recalledReferences.current = {
          draft: recall.previousDraft,
          items: references,
          sessionId: activeId,
          connectionId: info?.connectionId
        }
      setReferences([])
    } else if (recalledReferences.current) {
      const previous = recalledReferences.current
      recalledReferences.current = null
      setReferences(
        previous.draft === draft &&
          previous.sessionId === activeId &&
          previous.connectionId === info?.connectionId
          ? previous.items
          : []
      )
    }
    // 引用快照与取回动作绑定，输入变化不应重复重建或清除它。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recall])
  const open = (next: Menu): void => {
    selection.current = null
    setQuery('')
    setActive(0)
    setManual(true)
    setMode(next)
    setError('')
  }
  useEffect(() => {
    if (previousSession.current !== activeId) {
      if (previousSession.current) setReferences([])
      previousSession.current = activeId
      setCatalog(null)
      close()
    }
  }, [activeId, close])
  useEffect(() => {
    if (!draft) setReferences([])
  }, [draft])
  useEffect(() => {
    if (!mode || mode === 'files') return
    let cancelled = false
    setLoading(true)
    setError('')
    const load = async (): Promise<void> => {
      if (
        !info?.connected ||
        normalizeDraftDirectory(info.directory) !== normalizeDraftDirectory(directory)
      )
        await connect()
      const current = useCodingAgentStore.getState()
      if (cancelled) return
      if (
        current.runtimeId !== runtimeId ||
        current.activeId !== activeId ||
        normalizeDraftDirectory(current.directory) !== normalizeDraftDirectory(directory) ||
        !current.info?.connected
      )
        throw new Error('连接尚未就绪，请检查项目与原生程序后重试')
      const result = await codingAgentClient().readCatalog({
        runtimeId,
        ...(activeId ? { sessionId: activeId } : {})
      })
      if (!cancelled && useCodingAgentStore.getState().info?.connectionId === result.connectionId)
        setCatalog(result)
    }
    void load()
      .catch((error: unknown) => {
        if (!cancelled)
          setError(error instanceof Error ? error.message : '能力读取失败，可刷新重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    mode,
    runtimeId,
    directory,
    activeId,
    info?.connectionId,
    info?.connected,
    info?.directory,
    connect,
    refresh
  ])
  useEffect(() => {
    if (mode !== 'files') return
    let cancelled = false
    setLoading(true)
    setError('')
    const timer = window.setTimeout(() => {
      void codingAgentClient()
        .searchFiles({ runtimeId, directory, query })
        .then((result) => {
          if (!cancelled) setFiles(result)
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setFiles({ files: [], limited: false })
            setError(error instanceof Error ? error.message : '文件搜索失败')
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mode, runtimeId, directory, query, refresh])
  const focusInput = (): void => {
    requestAnimationFrame(() => input.current?.focus())
  }
  const addReference = (item: AgentReference): void => {
    const existing = references.some((old) => old.kind === item.kind && old.label === item.label)
    if (!existing && references.length >= 20) {
      setError('最多选择 20 个引用')
      return
    }
    setReferences([
      ...references.filter((old) => old.kind !== item.kind || old.label !== item.label),
      item
    ])
    const marker =
      item.kind === 'file'
        ? `@${JSON.stringify(item.label)}`
        : item.kind === 'skill'
          ? `$${item.label}`
          : `[MCP:${item.label}]`
    const trigger = selection.current
    setDraft(
      trigger
        ? `${draft.slice(0, trigger.start)}${marker} ${draft.slice(trigger.end)}`
        : draft.includes(marker)
          ? draft
          : `${draft}${draft ? ' ' : ''}${marker} `
    )
    close()
    focusInput()
  }
  const local = (action: LocalAgentCommand): void => {
    if (locked) return
    const match = /^\/([\w:.-]+)(?:\s|$)/.exec(draft)
    if (match && localAgentCommand(match[1])) setDraft(draft.slice(match[0].length))
    close()
    if (action === 'skills' || action === 'mcp') open(action)
    else if (action === 'new') newSession()
    else if (!session && (action === 'model' || action === 'permissions'))
      setError('当前尚无原生会话，请先开始对话或打开历史，再选择模型或权限。')
    else onLocalAction(action)
  }
  const chooseCommand = (name: string): void => {
    const task = /^\/[^\s]*\s?/.test(draft) ? draft.replace(/^\/[^\s]*\s?/, '') : draft
    setDraft(`/${name}${task ? ` ${task}` : ' '}`)
    close()
    focusInput()
  }
  const skillChoices: AgentActionChoice[] = (catalog?.skills ?? []).map((item) => ({
    id: item.id,
    label: `${item.label} · Skill`,
    description: `Skill · ${item.description}`,
    choose: () => addReference(item)
  }))
  const mcpChoices: AgentActionChoice[] = (catalog?.mcp ?? []).flatMap((server) => {
    if (server.tools.length)
      return server.tools.map((item) => ({
        id: item.id,
        label: `${server.name} / ${item.label} · MCP`,
        description: `${server.status} · ${item.description || '准备工具使用意图'}`,
        choose: () => addReference(item)
      }))
    return [
      {
        id: `mcp-server:${server.name}`,
        label: `${server.name} · MCP 服务`,
        description: `${server.status} · 未提供工具列表，仅准备可用性检查请求`,
        choose: () => {
          if (server.status.includes('已禁用')) {
            setError('此 MCP 服务在本机配置中已禁用，请在对应原生程序配置中启用后刷新')
            return
          }
          const text = `请检查当前 Agent 是否已加载 MCP 服务 ${JSON.stringify(server.name)}，可用时使用其相关工具完成任务；不可用时说明原因。`
          const trigger = selection.current
          setDraft(
            trigger
              ? `${draft.slice(0, trigger.start)}${text} ${draft.slice(trigger.end)}`
              : `${draft}${draft ? '\n' : ''}${text}`
          )
          close()
          focusInput()
        }
      }
    ]
  })
  const choices: AgentActionChoice[] =
    mode === 'files'
      ? files.files.map((item) => ({
          id: item.id,
          label: item.label,
          description: '当前项目 · 路径引用',
          choose: () => addReference(item)
        }))
      : mode === 'skills'
        ? [
            ...skillChoices,
            ...(runtimeId !== 'codex' && runtimeId !== 'dsh'
              ? (catalog?.commands ?? []).map((item) => ({
                  id: item.id,
                  label: `/${item.name}`,
                  description: `原生命令 · ${item.description}`,
                  choose: () => chooseCommand(item.name)
                }))
              : [])
          ]
        : mode === 'mcp'
          ? mcpChoices
          : [
              ...LOCAL_AGENT_COMMANDS.map((item) => ({
                id: `local-${item.name}`,
                label: `/${item.name} · ${item.label}`,
                description: item.description,
                choose: () => local(item.name)
              })),
              ...(catalog?.commands ?? []).map((item) => ({
                id: item.id,
                label: `/${item.name}${item.targetFile ? ` · ${item.targetFile}` : ''}`,
                description: `${item.kind === 'workflow' ? '工具箱工作流' : '原生命令'} · ${item.description}${item.argumentHint ? ` · ${item.argumentHint}` : ''}`,
                choose: () => chooseCommand(item.name)
              })),
              ...skillChoices,
              ...mcpChoices
            ]
  const visible = (loading && mode !== 'commands' ? [] : choices)
    .filter(
      (item) =>
        mode === 'files' ||
        `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase())
    )
    .slice(0, 100)
  const onKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (mode && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      setActive(
        (old) =>
          (old + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(visible.length, 1)) %
          Math.max(visible.length, 1)
      )
    } else if (mode && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      event.preventDefault()
      if (!event.repeat) visible[active]?.choose()
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (!event.repeat && !locked) void submit()
    }
  }
  const submit = async (literal = false): Promise<void> => {
    const command = /^\/([\w:.-]+)(?:\s|$)/.exec(draft)
    const action = command ? localAgentCommand(command[1]) : undefined
    if (!literal && action) {
      local(action)
      return
    }
    if (!canSend || loading || submitting.current) return
    submitting.current = true
    close()
    setError('')
    try {
      if (command && !literal) {
        let current = catalog
        if (
          !current ||
          current.connectionId !== info?.connectionId ||
          current.sessionId !== (activeId ?? '')
        ) {
          if (!info?.connected) await connect()
          const selected = useCodingAgentStore.getState()
          if (
            selected.runtimeId !== runtimeId ||
            selected.directory !== directory ||
            selected.activeId !== activeId
          )
            throw new Error('当前选择已变化，未发送任务')
          current = await codingAgentClient().readCatalog({
            runtimeId,
            ...(activeId ? { sessionId: activeId } : {})
          })
          setCatalog(current)
        }
        if (!current.commands.some((item) => item.name === command[1]))
          throw new Error('未识别为可用命令；可明确选择“作为普通文字发送”')
      }
      const selected = useCodingAgentStore.getState()
      if (
        selected.runtimeId !== runtimeId ||
        selected.directory !== directory ||
        selected.activeId !== activeId ||
        selected.draft !== draft
      )
        throw new Error('当前草稿或选择已变化，本次未发送')
      await send({ references, literal })
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : '命令读取失败，可重试')
    } finally {
      submitting.current = false
    }
  }
  return (
    <form
      className={`composer${transferred ? ' opencode-transferred' : ''}`}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {children}
      {recall ? (
        <div className="status-banner opencode-desktop-hint" role="status">
          <span title="原有文件与 Skill 引用需重新选择">
            {recall.reverted
              ? '已回退原生对话 · 编辑后发送将继续新历史'
              : '取回编辑 · 发送为新消息'}
          </span>
          <button type="button" className="btn-ghost" onClick={() => void cancelRecall()}>
            {recall.reverted ? '恢复原草稿' : '取消取回'}
          </button>
        </div>
      ) : null}
      <label className="sr-only" htmlFor="opencode-draft">
        编程任务草稿
      </label>
      <div className="composer-box" ref={composerBox}>
        {references.length ? (
          <div className="agent-reference-list" aria-label="任务引用">
            {references.map((item) => (
              <button
                type="button"
                className="btn-ghost"
                key={item.id}
                disabled={locked}
                aria-label={`移除引用 ${item.label}`}
                onClick={() => {
                  setReferences(references.filter((old) => old.id !== item.id))
                  const marker =
                    item.kind === 'file'
                      ? `@${JSON.stringify(item.label)}`
                      : item.kind === 'skill'
                        ? `$${item.label}`
                        : `[MCP:${item.label}]`
                  setDraft(draft.replace(marker, ''))
                }}
              >
                <span>{item.label}</span>
                <CloseIcon />
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={input}
          id="opencode-draft"
          className="composer-input"
          rows={3}
          value={draft}
          onChange={(event) => {
            const value = event.target.value
            setDraft(value)
            setReferences((items) =>
              items.filter((item) =>
                value.includes(
                  item.kind === 'file'
                    ? `@${JSON.stringify(item.label)}`
                    : item.kind === 'skill'
                      ? `$${item.label}`
                      : `[MCP:${item.label}]`
                )
              )
            )
            const trigger = agentInputTrigger(event.target.value, event.target.selectionStart)
            selection.current = trigger
            if (trigger) {
              setMode(trigger.kind)
              setQuery(trigger.query)
              setManual(false)
              setActive(0)
            } else close()
          }}
          onKeyDown={onKey}
          placeholder="发送消息，@ 文件，/ 命令"
          title="Enter 发送，Shift + Enter 换行"
          aria-expanded={Boolean(mode)}
          aria-controls={mode ? 'agent-action-options' : undefined}
          aria-activedescendant={mode && visible[active] ? `agent-action-${active}` : undefined}
        />
        <div className="composer-actions">
          <div className="agent-composer-controls">
            <AgentComposerTools disabled={locked || !directory} onChoose={open} />
            <AgentComposerOptions session={session} disabled={locked || busy} />
          </div>
          <div className="agent-composer-submit">
            {draft.length > 45_000 ? (
              <span className="opencode-draft-count" data-over-limit={draft.length > 50_000}>
                {draft.length.toLocaleString()}/50,000
              </span>
            ) : null}
            <AgentContextStatus
              session={session}
              connected={Boolean(info?.connected && info.directory === directory)}
              canCompact={Boolean(activeId && !locked && runtimeId !== 'dsh')}
              onCompact={() =>
                void (async () => {
                  const before = useCodingAgentStore.getState()
                  if (
                    before.draft.trim() &&
                    !(await confirmDialog('准备压缩命令会替换当前草稿，是否继续？'))
                  )
                    return
                  const current = useCodingAgentStore.getState()
                  if (
                    current.runtimeId !== runtimeId ||
                    current.activeId !== activeId ||
                    current.draft !== before.draft
                  )
                    return
                  setDraft('/compact')
                  focusInput()
                })()
              }
            />
            {preparing ? (
              <button type="button" className="btn-ghost" onClick={() => cancelPreparation()}>
                取消准备
              </button>
            ) : runningSession && runningSession === activeId ? (
              <button
                type="button"
                className="btn-danger"
                aria-label="停止任务"
                title="停止任务"
                disabled={session?.status !== 'running'}
                onClick={() => void stop()}
              >
                <StopIcon />
                <span className="sr-only">停止任务</span>
              </button>
            ) : (
              <button
                type="submit"
                className="btn-gold"
                disabled={!canSend}
                aria-label={
                  busy
                    ? '准备中'
                    : session
                      ? `发送给 ${CODING_AGENT_NAMES[runtimeId]}`
                      : `开始对话 · ${CODING_AGENT_NAMES[runtimeId]}`
                }
                title="发送（Enter）"
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
      {error ? (
        <p className="status-banner" role="alert">
          {error}
        </p>
      ) : null}
      {/^\/\S/.test(draft) ? (
        <button
          type="button"
          className="btn-ghost"
          disabled={!canSend}
          onClick={() => void submit(true)}
        >
          作为普通文字发送
        </button>
      ) : null}
      {mode ? (
        <AgentActionMenu
          anchor={composerBox}
          input={input}
          fileMode={mode === 'files'}
          title={
            {
              files: '项目文件',
              commands: '快捷命令',
              skills: runtimeId === 'codex' ? 'Skill' : 'Skill / 命令',
              mcp: 'MCP 工具'
            }[mode]
          }
          query={query}
          onQuery={(value) => {
            setQuery(value)
            setActive(0)
          }}
          choices={visible}
          active={active}
          setActive={setActive}
          loading={loading}
          error={error}
          manual={manual}
          onClose={close}
          onRefresh={() => setRefresh((old) => old + 1)}
          onKeyDown={onKey}
          notices={
            mode === 'files'
              ? files.limited
                ? ['仅显示部分结果，请继续输入路径片段。']
                : []
              : [
                  ...(catalog?.notices ?? []),
                  ...(mode === 'mcp'
                    ? (catalog?.mcp ?? []).map((item) => `${item.name}：${item.status}`)
                    : [])
                ]
          }
        />
      ) : null}
    </form>
  )
}
