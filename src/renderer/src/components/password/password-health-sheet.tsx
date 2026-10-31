import { useMemo, useRef } from 'react'
import type { JSX } from 'react'
import type { PasswordEntryView } from '../../../../shared/types'
import { analyzePasswordHealth } from '../../../../shared/password-health'
import type { PasswordHealthItem } from '../../../../shared/password-health'
import { useModalFocus } from '../../lib/use-modal-focus'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'

/** 仅展示健康指标与条目标题，复用密码详情的定位入口。 */
export function PasswordHealthSheet(props: {
  entries: PasswordEntryView[]
  onClose(): void
  onOpen(id: string): void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref)
  useOverlayEscape(props.onClose)
  const report = useMemo(() => analyzePasswordHealth(props.entries), [props.entries])
  const healthy =
    !report.failed &&
    !report.duplicates.length &&
    !report.weak.length &&
    !report.stale.length &&
    !report.empty.length
  function items(
    list: PasswordHealthItem[],
    detail: 'strength' | 'days' | null = null
  ): JSX.Element {
    return (
      <ul className="capability-list">
        {list.map((item) => (
          <li key={item.id}>
            <button type="button" className="btn-ghost" onClick={() => props.onOpen(item.id)}>
              {item.title}
              {detail === 'strength'
                ? ` · ${item.strength}`
                : detail === 'days'
                  ? ` · ${item.days} 天`
                  : ''}
            </button>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div className="sheet-backdrop" onMouseDown={props.onClose}>
      <div
        className="sheet-panel capability-sheet"
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="密码健康报告"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-toolbar">
          <h2 className="panel-title">密码健康报告</h2>
          <button type="button" className="btn-ghost" onClick={props.onClose}>
            关闭
          </button>
        </div>
        <div className="sheet-scroll">
          <p>
            共 {report.total} 条 · 解密失败 {report.failed} 条
          </p>
          <p className="field-hint">仅在本机内存中分析，不展示或导出密码。强度为粗略提示。</p>
          {healthy ? (
            <p className="sheet-empty">
              {report.total
                ? '暂未发现健康问题，继续使用不同的强密码。'
                : '还没有密码条目，先新增一条再检查。'}
            </p>
          ) : null}
          {report.duplicates.length ? (
            <section>
              <h3>重复密码 · {report.duplicates.length} 组</h3>
              {report.duplicates.map((group, index) => (
                <details key={group[0].id}>
                  <summary>
                    第 {index + 1} 组 · {group.length} 条
                  </summary>
                  {items(group)}
                </details>
              ))}
            </section>
          ) : null}
          {report.weak.length ? (
            <section>
              <h3>弱密码 · {report.weak.length} 条</h3>
              {items(report.weak, 'strength')}
            </section>
          ) : null}
          {report.stale.length ? (
            <section>
              <h3>超过 365 天未修改 · {report.stale.length} 条</h3>
              {items(report.stale, 'days')}
            </section>
          ) : null}
          {report.empty.length ? (
            <section>
              <h3>空密码 · {report.empty.length} 条</h3>
              {items(report.empty)}
            </section>
          ) : null}
          {report.failed ? (
            <p className="status-banner">解密失败条目未参与健康分析，请在列表打开详情查看。</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
