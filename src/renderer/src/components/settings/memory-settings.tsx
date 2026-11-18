import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, JSX } from 'react'

import {
  MEMORY_KINDS,
  MEMORY_KIND_LABELS,
  MEMORY_STATUSES,
  MEMORY_STATUS_LABELS
} from '@shared/types'
import type { MemoryExportFormat, MemoryItemView, MemoryKind, MemoryStatus } from '@shared/types'
import { confirmDialog } from '../../stores/dialog-store'
import { Dropdown } from '../dropdown'

interface MemoryDraft {
  id: string | null
  kind: MemoryKind
  title: string
  body: string
  /** 逗号 / 顿号分隔，保存时拆分去重 */
  tags: string
  pinned: boolean
}

const PAGE_SIZE = 20

const emptyDraft = (): MemoryDraft => ({
  id: null,
  kind: 'preference',
  title: '',
  body: '',
  tags: '',
  pinned: false
})

const errorText = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error) || !error.message) return fallback
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

/**
 * AI 记忆设置卡：显式记忆增删改查、自动候选审核与总开关。
 *
 * 自动候选默认只进入待确认，用户批准后才生效；记忆正文按纯文本渲染，
 * 不使用 dangerouslySetInnerHTML。
 */
export function MemorySettings(): JSX.Element {
  const [enabled, setEnabled] = useState(true)
  const [autoLearn, setAutoLearn] = useState(true)
  const [items, setItems] = useState<MemoryItemView[]>([])
  const [total, setTotal] = useState(0)
  const [pinnedCount, setPinnedCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<MemoryKind | 'all'>('all')
  const [status, setStatus] = useState<MemoryStatus | 'all'>('all')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [draft, setDraft] = useState<MemoryDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** 快速改筛选时只认最后一次请求，避免旧结果覆盖新结果 */
  const loadSequence = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    if (!window.toolbox) return
    const sequence = ++loadSequence.current
    try {
      const result = await window.toolbox.memory.list({
        ...(query.trim() ? { query: query.trim() } : {}),
        kind,
        status,
        limit,
        offset: 0
      })
      if (sequence !== loadSequence.current) return
      setItems(result.items)
      setTotal(result.total)
      setPinnedCount(result.pinnedCount)
      setPendingCount(result.pendingCount)
      setError('')
    } catch (cause) {
      if (sequence !== loadSequence.current) return
      setError(errorText(cause, '读取记忆失败'))
    }
  }, [kind, limit, query, status])

  // 首次进入读取总开关；读不到时保持默认开启，不阻塞其它设置。
  useEffect(() => {
    if (!window.toolbox) return
    void window.toolbox.config
      .get()
      .then((config) => {
        setEnabled(config?.memoryEnabled !== false)
        setAutoLearn(config?.memoryAutoLearn !== false)
      })
      .catch(() => {
        // 配置读取失败不应让整个设置页不可用
      })
  }, [])

  // 搜索输入做轻量防抖，避免每敲一个字都走 IPC
  useEffect(() => {
    const timer = setTimeout(() => void load(), 180)
    return () => clearTimeout(timer)
  }, [load])

  const resetFeedback = (): void => {
    setError('')
    setNotice('')
  }

  const toggleEnabled = async (): Promise<void> => {
    if (!window.toolbox) return
    const next = !enabled
    resetFeedback()
    try {
      await window.toolbox.config.set({ memoryEnabled: next })
      setEnabled(next)
    } catch (cause) {
      setError(errorText(cause, '保存开关失败'))
    }
  }

  const toggleAutoLearn = async (): Promise<void> => {
    if (!window.toolbox || !enabled) return
    resetFeedback()
    try {
      await window.toolbox.config.set({ memoryAutoLearn: !autoLearn })
      setAutoLearn((current) => !current)
    } catch (cause) {
      setError(errorText(cause, '保存自动学习开关失败'))
    }
  }

  const openNew = (): void => {
    resetFeedback()
    setDraft(emptyDraft())
  }

  const openEdit = (item: MemoryItemView): void => {
    resetFeedback()
    setDraft({
      id: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      tags: item.tags.join('、'),
      pinned: item.pinned
    })
  }

  const saveDraft = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!draft || busy || !window.toolbox) return
    resetFeedback()
    const tags = draft.tags
      .split(/[,，、\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    if (!draft.title.trim() || !draft.body.trim()) {
      setError('标题和正文都不能为空')
      return
    }
    setBusy(true)
    try {
      await window.toolbox.memory.save({
        ...(draft.id ? { id: draft.id } : {}),
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        tags,
        pinned: draft.pinned
      })
      setDraft(null)
      setNotice('记忆已保存')
      await load()
    } catch (cause) {
      setError(errorText(cause, '保存记忆失败'))
    } finally {
      setBusy(false)
    }
  }

  const patchState = async (
    item: MemoryItemView,
    patch: { status?: MemoryStatus; pinned?: boolean }
  ): Promise<void> => {
    if (!window.toolbox || busy) return
    resetFeedback()
    setBusy(true)
    try {
      await window.toolbox.memory.setState({ id: item.id, ...patch })
      await load()
    } catch (cause) {
      setError(errorText(cause, '更新记忆失败'))
    } finally {
      setBusy(false)
    }
  }

  const exportMemory = async (format: MemoryExportFormat): Promise<void> => {
    if (!window.toolbox || busy) return
    resetFeedback()
    setBusy(true)
    try {
      const path = await window.toolbox.memory.export(format)
      if (path) setNotice(`记忆已导出：${path}`)
    } catch (cause) {
      setError(errorText(cause, '导出记忆失败'))
    } finally {
      setBusy(false)
    }
  }

  const importMemory = async (): Promise<void> => {
    if (!window.toolbox || busy) return
    const confirmed = await confirmDialog(
      '导入会按类型和标题合并记忆；同标题以文件内容为准，文件内的状态、置信度与置顶也会一并恢复。\n是否继续？'
    )
    if (!confirmed) return
    resetFeedback()
    setBusy(true)
    try {
      const result = await window.toolbox.memory.import()
      if (result) {
        setNotice(
          `导入完成：新增 ${result.imported} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条`
        )
        await load()
      }
    } catch (cause) {
      setError(errorText(cause, '导入记忆失败'))
    } finally {
      setBusy(false)
    }
  }

  const removeItem = async (item: MemoryItemView): Promise<void> => {
    if (!window.toolbox || busy) return
    const confirmed = await confirmDialog(
      `确定删除记忆「${item.title}」吗？\n删除后无法恢复；如果只是想停用，可以改为归档。`
    )
    if (!confirmed) return
    resetFeedback()
    setBusy(true)
    try {
      await window.toolbox.memory.remove(item.id)
      if (draft?.id === item.id) setDraft(null)
      setNotice('记忆已删除')
      await load()
    } catch (cause) {
      setError(errorText(cause, '删除记忆失败'))
    } finally {
      setBusy(false)
    }
  }

  const kindOptions = [
    { value: 'all', label: '全部类型' },
    ...MEMORY_KINDS.map((value) => ({ value, label: MEMORY_KIND_LABELS[value] }))
  ]
  const statusOptions = [
    { value: 'all', label: '全部状态' },
    ...MEMORY_STATUSES.map((value) => ({ value, label: MEMORY_STATUS_LABELS[value] }))
  ]

  return (
    <section className="glass settings-card" aria-label="AI 记忆">
      <div className="sec-head">
        <h2 className="sec-title">AI 记忆</h2>
        <div className="memory-head-actions">
          <span className="field-hint">长期记忆</span>
          <button
            type="button"
            className={`toggle-switch${enabled ? ' on' : ''}`}
            role="switch"
            aria-checked={enabled}
            aria-label="启用长期记忆"
            onClick={() => void toggleEnabled()}
          >
            <span />
          </button>
        </div>
      </div>

      <p className="field-hint">
        {
          '只保存你明确确认的偏好、事实和约束；新会话会自动带上置顶记忆。使用时相关片段会随请求发送给当前模型供应商，记忆本身保存在本机；当前对话指令始终优先于记忆。'
        }
      </p>

      {notice ? (
        <div className="status-banner success-banner" role="status">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="status-banner" role="alert">
          {error}
        </div>
      ) : null}

      {!enabled ? (
        <div className="status-banner memory-off-banner" role="status">
          {
            '长期记忆已关闭：不会注入记忆，也不会向 AI 暴露记忆工具。已有记忆仍可在这里查看、编辑或删除。'
          }
        </div>
      ) : null}

      <div className="memory-learn-row">
        <span className="field-label">自动学习 · AUTO</span>
        <button
          type="button"
          className={`toggle-switch${autoLearn ? ' on' : ''}`}
          role="switch"
          aria-checked={autoLearn}
          aria-label="自动提取候选记忆"
          disabled={!enabled}
          onClick={() => void toggleAutoLearn()}
        >
          <span />
        </button>
        <span className="field-hint">
          {'每 4 个用户轮次把最近对话交给当前模型提取候选；只进入待确认，批准后才生效。'}
        </span>
      </div>

      <div className="memory-toolbar">
        <input
          className="field-input memory-search"
          type="search"
          value={query}
          placeholder="搜索标题或正文"
          aria-label="搜索记忆"
          onChange={(event) => {
            setQuery(event.target.value)
            setLimit(PAGE_SIZE)
          }}
        />
        <Dropdown
          value={kind}
          ariaLabel="按记忆类型筛选"
          options={kindOptions}
          onChange={(value) => {
            setKind(value as MemoryKind | 'all')
            setLimit(PAGE_SIZE)
          }}
        />
        <Dropdown
          value={status}
          ariaLabel="按记忆状态筛选"
          options={statusOptions}
          onChange={(value) => {
            setStatus(value as MemoryStatus | 'all')
            setLimit(PAGE_SIZE)
          }}
        />
        <button type="button" className="btn-gold btn-mini" onClick={openNew}>
          新建记忆
        </button>
      </div>

      <div className="memory-summary" role="status">
        共 {total} 条 · 置顶 {pinnedCount} 条
        {pendingCount > 0 ? ` · 待确认 ${pendingCount} 条` : ''}
        {total > items.length ? ` · 已显示 ${items.length} 条` : ''}
      </div>

      {items.length === 0 ? (
        <p className="settings-empty">还没有符合条件的记忆。点击「新建记忆」手动添加。</p>
      ) : (
        <div className="memory-list">
          {items.map((item) => (
            <article key={item.id} className={`memory-item${item.pinned ? ' pinned' : ''}`}>
              <div className="memory-item-main">
                <div className="memory-item-head">
                  <span className={`memory-kind kind-${item.kind}`}>
                    {MEMORY_KIND_LABELS[item.kind]}
                  </span>
                  <strong className="memory-item-title">{item.title}</strong>
                  {item.pinned ? <span className="memory-pin-mark">常驻</span> : null}
                  <span className={`memory-status status-${item.status}`}>
                    {MEMORY_STATUS_LABELS[item.status]}
                  </span>
                </div>
                <p className="memory-item-body">{item.body}</p>
                {item.sourceExcerpt ? (
                  <p className="memory-source">来源：{item.sourceExcerpt}</p>
                ) : null}
                <div className="memory-item-meta">
                  {item.tags.length > 0 ? (
                    <span className="memory-tags">
                      {item.tags.map((tag) => (
                        <span key={tag} className="memory-tag">
                          #{tag}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span>更新于 {formatDate(item.updatedAtMs)}</span>
                </div>
              </div>

              <div className="memory-item-actions">
                <button
                  type="button"
                  className="btn-ghost btn-mini"
                  aria-pressed={item.pinned}
                  disabled={busy}
                  onClick={() => void patchState(item, { pinned: !item.pinned })}
                >
                  {item.pinned ? '取消置顶' : '置顶'}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-mini"
                  disabled={busy}
                  onClick={() => openEdit(item)}
                >
                  编辑
                </button>
                {item.status === 'pending' ? (
                  <>
                    <button
                      type="button"
                      className="btn-ghost btn-mini"
                      disabled={busy}
                      onClick={() => void patchState(item, { status: 'active' })}
                    >
                      批准
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-mini btn-danger"
                      disabled={busy}
                      onClick={() => void patchState(item, { status: 'rejected' })}
                    >
                      拒绝
                    </button>
                  </>
                ) : item.status === 'active' ? (
                  <button
                    type="button"
                    className="btn-ghost btn-mini"
                    disabled={busy}
                    onClick={() => void patchState(item, { status: 'archived' })}
                  >
                    归档
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost btn-mini"
                    disabled={busy}
                    onClick={() => void patchState(item, { status: 'active' })}
                  >
                    恢复
                  </button>
                )}
                <button
                  type="button"
                  className="btn-ghost btn-mini btn-danger"
                  disabled={busy}
                  onClick={() => void removeItem(item)}
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {total > items.length ? (
        <div className="memory-more">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setLimit((current) => current + PAGE_SIZE)}
          >
            加载更多
          </button>
        </div>
      ) : null}

      <div className="memory-transfer">
        <span className="field-hint">备份与迁移：JSON 可恢复，Markdown 仅供阅读。</span>
        <button
          type="button"
          className="btn-ghost btn-mini"
          disabled={busy}
          onClick={() => void exportMemory('json')}
        >
          导出 JSON
        </button>
        <button
          type="button"
          className="btn-ghost btn-mini"
          disabled={busy}
          onClick={() => void exportMemory('markdown')}
        >
          导出 Markdown
        </button>
        <button
          type="button"
          className="btn-ghost btn-mini"
          disabled={busy}
          onClick={() => void importMemory()}
        >
          导入 JSON
        </button>
      </div>

      {draft ? (
        <form className="memory-editor" onSubmit={(event) => void saveDraft(event)}>
          <div className="memory-editor-head">
            <strong>{draft.id ? '编辑记忆' : '新建记忆'}</strong>
            <button type="button" className="btn-ghost btn-mini" onClick={() => setDraft(null)}>
              取消
            </button>
          </div>

          <div className="memory-editor-grid">
            <div>
              <label className="field-label" htmlFor="memory-kind">
                类型 · KIND
              </label>
              <Dropdown
                id="memory-kind"
                triggerClassName="dropdown-field"
                value={draft.kind}
                ariaLabel="记忆类型"
                options={MEMORY_KINDS.map((value) => ({
                  value,
                  label: MEMORY_KIND_LABELS[value]
                }))}
                onChange={(value) => setDraft({ ...draft, kind: value as MemoryKind })}
              />
              <p className="field-hint">
                约束优先级最高；偏好用于回答风格；事件适合有时效的项目信息。
              </p>
            </div>

            <div>
              <label className="field-label" htmlFor="memory-pinned">
                常驻注入
              </label>
              <button
                type="button"
                id="memory-pinned"
                className={`memory-pin-toggle${draft.pinned ? ' on' : ''}`}
                aria-pressed={draft.pinned}
                onClick={() => setDraft({ ...draft, pinned: !draft.pinned })}
              >
                {draft.pinned ? '已置顶，每次对话都会带上' : '设为重点，每次对话都带上'}
              </button>
              <p className="field-hint">只有置顶的偏好和约束会常驻；其它记忆按相关度使用。</p>
            </div>

            <div className="memory-editor-wide">
              <label className="field-label" htmlFor="memory-title">
                标题 · TITLE
              </label>
              <input
                id="memory-title"
                className="field-input"
                type="text"
                value={draft.title}
                maxLength={80}
                placeholder="例如：回答先给结论"
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </div>

            <div className="memory-editor-wide">
              <label className="field-label" htmlFor="memory-body">
                内容 · CONTENT
              </label>
              <textarea
                id="memory-body"
                className="field-input field-textarea"
                value={draft.body}
                maxLength={2000}
                rows={4}
                placeholder="写清适用条件和边界，例如：除非用户要求展开，否则先给结论，再补必要细节。"
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              />
              <p className="field-hint">{draft.body.length} / 2000</p>
            </div>

            <div className="memory-editor-wide">
              <label className="field-label" htmlFor="memory-tags">
                标签 · TAGS
              </label>
              <input
                id="memory-tags"
                className="field-input"
                type="text"
                value={draft.tags}
                maxLength={200}
                placeholder="用逗号分隔，例如：回答风格、发布流程"
                onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
              />
            </div>
          </div>

          <div className="settings-actions">
            <button type="submit" className="btn-gold" disabled={busy}>
              {busy ? '保存中' : '保存记忆'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              取消
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
