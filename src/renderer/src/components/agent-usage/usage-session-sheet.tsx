import { useModalFocus } from '../../lib/use-modal-focus'
import { useRef } from 'react'
import type { JSX } from 'react'
import { USAGE_CLIENTS } from '@shared/agent-usage'
import type { UsageSessionView } from '@shared/agent-usage'
import { formatCost, formatDateTime, formatTokens } from '@shared/usage-format'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'

interface UsageSessionSheetProps {
  row: UsageSessionView
  onClose: () => void
  onFilterModel: (model: string) => void
  onFilterProject: (project: string) => void
}

/** 会话详情抽屉：只展示已采集的统计元数据，不读取会话正文。 */
export function UsageSessionSheet({
  row,
  onClose,
  onFilterModel,
  onFilterProject
}: UsageSessionSheetProps): JSX.Element {
  const modalRef = useRef<HTMLElement>(null)
  useModalFocus(modalRef)
  useOverlayEscape(onClose)
  const tokens: Array<[string, number | null]> = [
    ['未缓存输入', row.tokens.input],
    ['输出', row.tokens.output],
    ['缓存读取', row.tokens.cacheRead],
    ['缓存写入', row.tokens.cacheWrite],
    ['推理', row.tokens.reasoning],
    ['总 Token', row.tokens.total]
  ]
  return (
    <div
      className="usage-sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside
        className="glass usage-sheet"
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="会话用量详情"
      >
        <header className="usage-sheet-head">
          <div>
            <span className="field-label">{USAGE_CLIENTS[row.client]}</span>
            <h2>{row.model || '模型未知'}</h2>
            <p title={row.project}>{row.project || '项目未知'}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭详情" onClick={onClose}>
            ×
          </button>
        </header>
        <dl className="usage-sheet-tokens">
          {tokens.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{formatTokens(value)}</dd>
            </div>
          ))}
        </dl>
        <dl className="usage-sheet-meta">
          <div>
            <dt>会话</dt>
            <dd title={row.sessionId}>{row.sessionId}</dd>
          </div>
          <div>
            <dt>最后活动</dt>
            <dd>{formatDateTime(row.time)}</dd>
          </div>
          <div>
            <dt>请求数</dt>
            <dd>{formatTokens(row.requests)}</dd>
          </div>
          <div>
            <dt>原生花费</dt>
            <dd>
              {row.costUsd === null ? '未上报' : formatCost(row.costUsd)}
              {row.costPartial ? '（部分记录）' : ''}
            </dd>
          </div>
        </dl>
        {row.partial ? (
          <div className="status-banner" role="status">
            该会话字段或来源不完整，仅展示已知值。
          </div>
        ) : null}
        <div className="usage-sheet-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={!row.model}
            onClick={() => onFilterModel(row.model)}
          >
            只看该模型
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={!row.project}
            onClick={() => onFilterProject(row.project)}
          >
            只看该项目
          </button>
          <button type="button" className="btn-gold" onClick={onClose}>
            关闭
          </button>
        </div>
      </aside>
    </div>
  )
}
