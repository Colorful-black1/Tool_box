import { useRef } from 'react'
import type { JSX } from 'react'

import type { AiAgentArenaBoard, AiAgentArenaEntry } from '@shared/ai-agent-arena'
import { useModalFocus } from '../../lib/use-modal-focus'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'
import {
  formatAgentDate,
  formatAgentDateTime,
  formatAgentValue
} from '../../lib/ai-agent-arena-format'

interface AiWorldAgentDetailProps {
  board: AiAgentArenaBoard
  entry: AiAgentArenaEntry
  onClose: () => void
  onOpenSource: (url: string) => void
}

function Spec({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="ai-world-spec">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

/** Agent 详情：展示来源原始名次、全部官方指标和口径说明。 */
export function AiWorldAgentDetail({
  board,
  entry,
  onClose,
  onOpenSource
}: AiWorldAgentDetailProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref)
  useOverlayEscape(onClose)
  const values = board.columns.map((column) => ({
    ...column,
    value: entry.values[column.key] ?? null
  }))

  return (
    <div
      className="ai-world-detail-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={ref}
        className="ai-world-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-agent-detail-title"
      >
        <header className="ai-world-detail-head">
          <div>
            <p className="ai-world-eyebrow">
              {board.name} · AGENT × 模型
              {entry.sourceRank == null
                ? ''
                : ` · ${board.id === 'frontierharness' ? '同模型' : '官方'}第 ${entry.sourceRank} 名`}
            </p>
            <h2 id="ai-agent-detail-title">{entry.agentName}</h2>
            <p className="field-hint">
              {entry.agentVersion || '版本未公开'} · {entry.modelName}
              {entry.modelVariant ? ` · ${entry.modelVariant}` : ''}
            </p>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="ai-world-spec-grid">
          <Spec
            label={board.id === 'frontierharness' ? '同模型官方名次' : '来源名次'}
            value={entry.sourceRank == null ? '—' : `#${entry.sourceRank}`}
          />
          <Spec label="Agent 版本" value={entry.agentVersion || '未公开'} />
          <Spec
            label="模型"
            value={`${entry.modelName}${entry.modelVariant ? ` · ${entry.modelVariant}` : ''}`}
          />
          <Spec label="数据日期" value={formatAgentDate(entry.date)} />
          <Spec
            label="任务数"
            value={entry.taskCount == null ? '—' : String(entry.taskCount)}
          />
          <Spec label="尝试数" value={entry.attempts == null ? '—' : String(entry.attempts)} />
          <Spec label="官方生成时间" value={formatAgentDateTime(board.capturedAt)} />
          <Spec label="榜单版本" value={board.version || '—'} />
        </div>

        <h3 className="ai-world-detail-section">官方指标</h3>
        <div className="ai-agent-metric-grid">
          {values.map((metric) => (
            <div className="ai-agent-metric" key={metric.key}>
              <span>{metric.label}</span>
              <strong>{formatAgentValue(metric.value, metric.unit)}</strong>
            </div>
          ))}
        </div>

        <h3 className="ai-world-detail-section">口径说明</h3>
        <ul className="ai-agent-notes">
          {board.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
          <li>不同榜单的任务与评分不同，不跨榜合并为单一分数。</li>
        </ul>

        <div className="ai-world-source-row">
          <div>
            <strong>{board.name}</strong>
            <span className="field-hint">打开官方榜单核对原始数据</span>
          </div>
          <button
            type="button"
            className="ai-world-source-link"
            onClick={() => onOpenSource(board.sourceUrl)}
          >
            打开原榜
          </button>
        </div>
      </section>
    </div>
  )
}
