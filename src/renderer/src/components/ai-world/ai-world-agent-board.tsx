import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import { AI_AGENT_ARENA_CHECK_INTERVAL_MS, AI_AGENT_ARENA_SOURCES } from '@shared/ai-agent-arena'
import type {
  AiAgentArenaBoard,
  AiAgentArenaEntry,
  AiAgentArenaSourceId
} from '@shared/ai-agent-arena'
import { Dropdown } from '../dropdown'
import { RefreshIcon, SearchIcon } from '../icons'
import { useAiAgentArenaStore } from '../../stores/ai-agent-arena-store'
import {
  formatAgentDate,
  formatAgentDateTime,
  formatAgentValue,
  formatRelativeTime
} from '../../lib/ai-agent-arena-format'
import { AiWorldAgentDetail } from './ai-world-agent-detail'
import { AiWorldSources } from './ai-world-sources'

const PAGE_SIZE = 30

interface AiWorldAgentBoardProps {
  onOpenSource: (url: string) => void
}

function boardModelKey(entry: AiAgentArenaEntry): string {
  return `${entry.modelName}\u0000${entry.modelVariant ?? ''}`
}

function boardModelLabel(entry: AiAgentArenaEntry): string {
  return `${entry.modelName}${entry.modelVariant ? ` · ${entry.modelVariant}` : ''}`
}

export function AiWorldAgentBoard({ onOpenSource }: AiWorldAgentBoardProps): JSX.Element {
  const result = useAiAgentArenaStore((state) => state.result)
  const loading = useAiAgentArenaStore((state) => state.loading)
  const refreshing = useAiAgentArenaStore((state) => state.refreshing)
  const error = useAiAgentArenaStore((state) => state.error)
  const load = useAiAgentArenaStore((state) => state.load)
  const refresh = useAiAgentArenaStore((state) => state.refresh)
  const refreshIfStale = useAiAgentArenaStore((state) => state.refreshIfStale)
  const clearError = useAiAgentArenaStore((state) => state.clearError)

  const [selectedId, setSelectedId] = useState<AiAgentArenaSourceId | null>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [model, setModel] = useState('')
  const [sortKey, setSortKey] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AiAgentArenaEntry | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void refreshIfStale()
    }, AI_AGENT_ARENA_CHECK_INTERVAL_MS)
    const onVisible = (): void => {
      if (!document.hidden) void refreshIfStale()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshIfStale])

  const boards = result?.snapshot.boards ?? []
  const board: AiAgentArenaBoard | null =
    boards.find((item) => item.id === selectedId) ?? boards[0] ?? null
  const sourceState = board && result ? result.snapshot.sources[board.id] : null
  const sourceMeta = board
    ? (AI_AGENT_ARENA_SOURCES.find((source) => source.id === board.id) ?? null)
    : null

  useEffect(() => {
    setPage(0)
  }, [deferredQuery, model, sortKey])

  const modelOptions = useMemo(() => {
    if (!board) return [{ value: '', label: '全部模型' }]
    const seen = new Set<string>()
    const options = [{ value: '', label: '全部模型' }]
    for (const entry of board.entries) {
      const key = boardModelKey(entry)
      if (seen.has(key)) continue
      seen.add(key)
      options.push({ value: key, label: boardModelLabel(entry) })
    }
    return options
  }, [board])

  const sortOptions = useMemo(() => {
    if (!board) return []
    return board.columns.map((column) => ({ value: column.key, label: column.label }))
  }, [board])

  const rows = useMemo(() => {
    if (!board) return []
    const keyword = deferredQuery.trim().toLowerCase()
    const column = board.columns.find((item) => item.key === sortKey) ?? board.columns[0]
    const filtered = board.entries.filter((entry) => {
      if (model && boardModelKey(entry) !== model) return false
      if (!keyword) return true
      return [entry.agentName, entry.agentVersion, entry.modelName, entry.modelVariant]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    })
    return filtered.sort((a, b) => {
      const left = a.values[column.key] ?? null
      const right = b.values[column.key] ?? null
      let delta = 0
      if (left == null && right != null) delta = 1
      else if (left != null && right == null) delta = -1
      else if (left != null && right != null)
        delta = column.direction === 'asc' ? left - right : right - left
      return (
        delta ||
        (a.sourceRank ?? Number.POSITIVE_INFINITY) -
          (b.sourceRank ?? Number.POSITIVE_INFINITY) ||
        a.agentName.localeCompare(b.agentName) ||
        a.modelName.localeCompare(b.modelName)
      )
    })
  }, [board, deferredQuery, model, sortKey])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  const selectBoard = (next: AiAgentArenaBoard): void => {
    setSelectedId(next.id)
    setSortKey(next.primaryMetric)
    setModel('')
    setPage(0)
  }

  return (
    <div className="ai-world-agent-page">
      <section className="ai-world-hero">
        <div>
          <p className="ai-world-eyebrow">AGENT ARENA · AGENT × 模型</p>
          <h2>Agent 排行</h2>
          <p className="field-hint">
            同一模型换一个 Agent，成绩会变；按来源分榜展示，不跨榜合并成单一分数。
          </p>
        </div>
        <div className="tool-controls">
          <button
            type="button"
            className="btn-ghost"
            disabled={refreshing}
            onClick={() => void refresh(true)}
          >
            <RefreshIcon />
            {refreshing ? '刷新中…' : '刷新'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setSourcesOpen(true)}>
            数据来源
          </button>
        </div>
      </section>

      {error ? (
        <div className="status-banner" role="alert">
          <span>{error}</span>
          <span className="tool-controls">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                clearError()
                void load()
              }}
            >
              重试
            </button>
            <button type="button" className="btn-ghost" onClick={clearError}>
              关闭
            </button>
          </span>
        </div>
      ) : null}

      {!result && loading ? (
        <div aria-busy="true" aria-label="Agent 排行加载中">
          <div className="loading-skeleton" />
          <div className="loading-skeleton" />
          <div className="loading-skeleton" />
        </div>
      ) : null}

      {!result && !loading && !error ? (
        <p className="field-hint" role="status">
          暂无 Agent 排行数据，请点击刷新重试。
        </p>
      ) : null}

      {result && boards.length ? (
        <>
          {result.warning ? (
            <div className="status-banner" role="status">
              <span>{result.warning}</span>
            </div>
          ) : null}

          <div
            className="ai-world-view-switch ai-agent-source-switch"
            role="group"
            aria-label="Agent 榜单来源"
          >
            {boards.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={board?.id === item.id}
                onClick={() => selectBoard(item)}
              >
                {item.name}
                <span>{item.entries.length}</span>
              </button>
            ))}
          </div>

          {board ? (
            <>
              <section className="ai-agent-summary" aria-label="榜单说明">
                <div>
                  <div className="ai-world-section-title">
                    <h3>{board.name}</h3>
                    {sourceState ? (
                      <span
                        className={`ai-agent-source-state${sourceState.ok ? '' : ' is-error'}`}
                      >
                        {sourceState.ok ? '官方数据' : '上次缓存'}
                      </span>
                    ) : null}
                  </div>
                  <p className="field-hint">{board.description}</p>
                  {sourceMeta ? (
                    <p className="ai-agent-focus">
                      <span>测试重点</span>
                      {sourceMeta.focus}
                    </p>
                  ) : null}
                </div>
                <div className="ai-agent-summary-meta">
                  <span>官方数据：{formatAgentDateTime(board.capturedAt)}</span>
                  <span>最近检查：{formatRelativeTime(sourceState?.checkedAt ?? null)}</span>
                  <span>
                    {rows.length} 个组合
                    {board.taskCount == null ? '' : ` · ${board.taskCount} 个任务`}
                  </span>
                </div>
                {sourceState?.note ? (
                  <p className="field-hint ai-agent-source-note">{sourceState.note}</p>
                ) : null}
              </section>

              <div className="ai-world-toolbar">
                <label className="ai-world-search">
                  <SearchIcon />
                  <input
                    className="field-input"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索 Agent、模型或版本"
                    aria-label="搜索 Agent 排行"
                  />
                </label>
                <Dropdown
                  ariaLabel="按模型筛选"
                  value={model}
                  options={modelOptions}
                  onChange={(value) => {
                    setModel(value)
                    setPage(0)
                  }}
                />
                <Dropdown
                  ariaLabel="排序方式"
                  value={sortKey || board.primaryMetric}
                  options={sortOptions}
                  onChange={(value) => {
                    setSortKey(value)
                    setPage(0)
                  }}
                />
              </div>

              {visible.length ? (
                <div className="ai-world-table-wrap">
                  <table className="ai-world-table ai-agent-table" aria-label="Agent 排行">
                    <thead>
                      <tr>
                        <th title="当前筛选与排序下的名次；官方名次见详情">#</th>
                        <th>Agent</th>
                        <th>模型</th>
                        {board.columns.map((column) => (
                          <th key={column.key}>{column.label}</th>
                        ))}
                        <th>日期</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((entry, index) => (
                        <tr key={entry.id}>
                          <td className="ai-world-rank">{safePage * PAGE_SIZE + index + 1}</td>
                          <td>
                            <button
                              type="button"
                              className="ai-world-model-button"
                              onClick={() => setSelected(entry)}
                            >
                              {entry.agentName}
                            </button>
                            <span className="ai-world-model-id">
                              {entry.agentVersion || '版本未公开'}
                            </span>
                          </td>
                          <td>
                            <span className="ai-agent-model-name">{entry.modelName}</span>
                            <span className="ai-world-model-id">
                              {entry.modelVariant || '默认配置'}
                            </span>
                          </td>
                          {board.columns.map((column) => (
                            <td key={column.key}>
                              {formatAgentValue(entry.values[column.key] ?? null, column.unit)}
                            </td>
                          ))}
                          <td className="ai-agent-date">{formatAgentDate(entry.date)}</td>
                          <td>
                            <button
                              type="button"
                              className="btn-ghost btn-mini"
                              onClick={() => setSelected(entry)}
                            >
                              详情
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="field-hint" role="status">
                  没有匹配的 Agent 组合，换一个关键词或模型筛选试试。
                </p>
              )}

              {rows.length > PAGE_SIZE ? (
                <div className="ai-world-pager">
                  <button
                    type="button"
                    className="btn-ghost btn-mini"
                    disabled={safePage === 0}
                    onClick={() => setPage(Math.max(0, safePage - 1))}
                  >
                    上一页
                  </button>
                  <span className="field-hint">
                    第 {safePage + 1} / {pageCount} 页
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-mini"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {selected && board ? (
        <AiWorldAgentDetail
          board={board}
          entry={selected}
          onClose={() => setSelected(null)}
          onOpenSource={onOpenSource}
        />
      ) : null}

      {sourcesOpen ? (
        <AiWorldSources onClose={() => setSourcesOpen(false)} onOpenSource={onOpenSource} />
      ) : null}
    </div>
  )
}
