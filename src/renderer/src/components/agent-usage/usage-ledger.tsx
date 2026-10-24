import type { JSX } from 'react'
import { USAGE_CLIENTS } from '@shared/agent-usage'
import type { UsageReport, UsageSessionView, UsageSortKey } from '@shared/agent-usage'
import { formatCost, formatDateTime, formatTokens } from '@shared/usage-format'

interface UsageLedgerProps {
  report: UsageReport | null
  busy: boolean
  exporting: boolean
  offset: number
  sort: UsageSortKey
  desc: boolean
  onSort: (key: UsageSortKey) => void
  onPage: (offset: number) => void
  onExport: () => void
  onSelect: (row: UsageSessionView) => void
}

function SortHeader({
  label,
  field,
  sort,
  desc,
  onSort
}: {
  label: string
  field: UsageSortKey
  sort: UsageSortKey
  desc: boolean
  onSort: (key: UsageSortKey) => void
}): JSX.Element {
  const active = sort === field
  return (
    <th aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        className={`agent-usage-sort${active ? ' active' : ''}`}
        onClick={() => onSort(field)}
      >
        {label}
        <span aria-hidden="true">{active ? (desc ? ' ↓' : ' ↑') : ''}</span>
      </button>
    </th>
  )
}

/** 会话明细：按会话 + 模型拆分，支持服务端排序与分页。 */
export function UsageLedger({
  report,
  busy,
  exporting,
  offset,
  sort,
  desc,
  onSort,
  onPage,
  onExport,
  onSelect
}: UsageLedgerProps): JSX.Element {
  const rows = report?.rows ?? []
  const total = report?.rowCount ?? 0
  return (
    <section className="glass agent-usage-ledger" aria-label="会话用量明细" aria-busy={busy}>
      <header className="agent-usage-ledger-head">
        <h3>
          会话明细 <small>{total} 项（按模型拆分）</small>
        </h3>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || exporting || !rows.length}
          title="导出当前筛选下的全部会话，最多 50,000 行"
          onClick={onExport}
        >
          {exporting ? '导出中…' : '导出 CSV'}
        </button>
      </header>
      {!rows.length ? (
        <p className="agent-usage-empty">
          {busy
            ? '正在扫描，首次读取可能需要一些时间…'
            : '当前范围没有可用记录。可切换周期、调整筛选，或在数据来源中选择路径。'}
        </p>
      ) : (
        <div className="agent-usage-table-wrap">
          <table>
            <caption className="sr-only">按会话和模型拆分的 Token 用量</caption>
            <thead>
              <tr>
                <th>Agent / 时间</th>
                <th>项目 / 会话</th>
                <th>模型</th>
                <SortHeader label="输入" field="input" sort={sort} desc={desc} onSort={onSort} />
                <SortHeader label="输出" field="output" sort={sort} desc={desc} onSort={onSort} />
                <SortHeader
                  label="缓存读"
                  field="cacheRead"
                  sort={sort}
                  desc={desc}
                  onSort={onSort}
                />
                <SortHeader
                  label="缓存写"
                  field="cacheWrite"
                  sort={sort}
                  desc={desc}
                  onSort={onSort}
                />
                <SortHeader
                  label="推理"
                  field="reasoning"
                  sort={sort}
                  desc={desc}
                  onSort={onSort}
                />
                <SortHeader
                  label="总 Token"
                  field="total"
                  sort={sort}
                  desc={desc}
                  onSort={onSort}
                />
                <SortHeader label="花费" field="cost" sort={sort} desc={desc} onSort={onSort} />
                <th>
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={JSON.stringify([row.client, row.sessionId, row.project, row.model])}>
                  <td>
                    {USAGE_CLIENTS[row.client]}
                    <small>{formatDateTime(row.time)}</small>
                  </td>
                  <td title={row.project}>
                    <span>{row.project || '项目未知'}</span>
                    <small title={row.sessionId}>{row.sessionId}</small>
                  </td>
                  <td title={row.model || '模型未知'}>
                    <span>{row.model || '模型未知'}</span>
                  </td>
                  <td>{formatTokens(row.tokens.input)}</td>
                  <td>{formatTokens(row.tokens.output)}</td>
                  <td>{formatTokens(row.tokens.cacheRead)}</td>
                  <td>{formatTokens(row.tokens.cacheWrite)}</td>
                  <td>{formatTokens(row.tokens.reasoning)}</td>
                  <td title={row.partial ? '字段或来源不完整，仅显示已知值' : undefined}>
                    {formatTokens(row.tokens.total)}
                    {row.partial ? ' *' : ''}
                  </td>
                  <td title={row.costPartial ? '同一会话只有部分记录上报花费' : undefined}>
                    {row.costUsd === null ? '—' : formatCost(row.costUsd)}
                    {row.costPartial ? ' *' : ''}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-ghost agent-usage-row-open"
                      onClick={() => onSelect(row)}
                    >
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report && total > 50 ? (
        <div className="agent-usage-pagination">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || !offset}
            onClick={() => onPage(Math.max(0, offset - 50))}
          >
            上一页
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 50, total)} / {total}
          </span>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || offset + 50 >= total}
            onClick={() => onPage(offset + 50)}
          >
            下一页
          </button>
        </div>
      ) : null}
    </section>
  )
}
