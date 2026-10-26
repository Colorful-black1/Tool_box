import type { JSX } from 'react'
import { USAGE_CLIENTS } from '@shared/agent-usage'
import { AgentIdentity } from '../agent-identity'
import type { UsageClient, UsageSourceView } from '@shared/agent-usage'
import { formatTokens } from '@shared/usage-format'

const STATUS_LABEL: Record<UsageSourceView['status'], string> = {
  ready: '已读取',
  partial: '部分可用',
  error: '读取失败',
  missing: '未发现',
  empty: '暂无用量'
}

const STATUS_ORDER: Record<UsageSourceView['status'], number> = {
  error: 0,
  partial: 1,
  ready: 2,
  empty: 3,
  missing: 4
}

function duration(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`
}

interface UsageSourcesProps {
  sources: UsageSourceView[]
  busy: boolean
  scanning: UsageClient | ''
  onChoose: (client: UsageClient) => void
  onReset: (client: UsageClient) => void
  onRescan: (client: UsageClient) => void
}

/** 来源管理：有数据 / 异常的来源置顶，未发现的收进折叠区。 */
export function UsageSources({
  sources,
  busy,
  scanning,
  onChoose,
  onReset,
  onRescan
}: UsageSourcesProps): JSX.Element {
  const sorted = [...sources].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.records - a.records ||
      USAGE_CLIENTS[a.client].localeCompare(USAGE_CLIENTS[b.client])
  )
  const visible = sorted.filter((source) => ['ready', 'partial', 'error'].includes(source.status))
  const hidden = sorted.filter((source) => !['ready', 'partial', 'error'].includes(source.status))
  const records = visible.reduce((total, source) => total + source.records, 0)
  const row = (source: UsageSourceView): JSX.Element => (
    <div className="agent-usage-source" key={source.client} data-status={source.status}>
      <div>
        <strong>
          <AgentIdentity agent={source.client} label={USAGE_CLIENTS[source.client]} />
        </strong>
        <span className="agent-usage-source-state" data-status={source.status}>
          {STATUS_LABEL[source.status]}
        </span>
        <p>{source.detail}</p>
        <small>{source.paths.join('；')}</small>
        <small className="agent-usage-source-meta">
          {formatTokens(source.records)} 条记录 · 耗时 {duration(source.durationMs)}
        </small>
      </div>
      <div className="agent-usage-actions">
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || Boolean(scanning)}
          onClick={() => onRescan(source.client)}
        >
          {scanning === source.client ? '扫描中…' : '重扫'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || Boolean(scanning)}
          onClick={() => onChoose(source.client)}
        >
          选择路径
        </button>
        {source.custom ? (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || Boolean(scanning)}
            onClick={() => onReset(source.client)}
          >
            恢复自动
          </button>
        ) : null}
      </div>
    </div>
  )
  return (
    <section className="glass agent-usage-sources" aria-label="统计数据来源">
      <p className="field-hint">
        自动发现常用目录。自定义路径会保存；恢复自动只调整统计路径，不修改原生文件。
        缓存在应用数据目录，只保存 Token 元数据。
      </p>
      <p className="field-hint">
        {visible.length} 个来源有数据或需要处理 · 共 {formatTokens(records)} 条记录
      </p>
      {visible.map(row)}
      {hidden.length ? (
        <details className="agent-usage-hidden-sources">
          <summary>未检测到数据的来源（{hidden.length}）</summary>
          {hidden.map(row)}
        </details>
      ) : null}
    </section>
  )
}
