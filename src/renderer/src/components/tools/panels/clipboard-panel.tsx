import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type {
  ClipboardHistoryConfig,
  ClipboardHistorySnapshot
} from '../../../../../shared/clipboard'
import { useClipboardStore } from '../../../stores/clipboard-store'
import { confirmDialog } from '../../../stores/dialog-store'
import { useModalFocus } from '../../../lib/use-modal-focus'
import { useOverlayEscape } from '../../../lib/use-overlay-dismiss'

/** 从命令面板打开，不新增侧栏或工具目录入口。 */
export function ClipboardPanel(): JSX.Element {
  const snapshot = useClipboardStore((state) => state.snapshot)
  const close = (): void => useClipboardStore.getState().setOpen(false)
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref)
  useOverlayEscape(close)
  const [query, setQuery] = useState('')
  const [keywords, setKeywords] = useState('')
  const [prefixes, setPrefixes] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const bridge = window.toolbox?.clipboardHistory
  useEffect(() => {
    let active = true
    if (bridge)
      void bridge
        .list()
        .then((value) => {
          if (!active) return
          useClipboardStore.getState().receive(value)
          setKeywords(value.keywords.join('\n'))
          setPrefixes(value.prefixes.join('\n'))
        })
        .catch(() => {
          if (active) setMessage('无法读取剪贴板历史，请重新打开面板')
        })
    return () => {
      active = false
    }
  }, [bridge])
  const perform = async (action: () => Promise<ClipboardHistorySnapshot>): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      useClipboardStore.getState().receive(await action())
    } catch {
      setMessage('操作失败，请检查忽略规则（每类最多 50 条，每条最多 200 字符）后重试')
    } finally {
      setBusy(false)
    }
  }
  const configure = async (enabled: boolean): Promise<void> => {
    if (!bridge) return
    if (
      enabled &&
      !snapshot?.enabled &&
      !(await confirmDialog(
        '会记录你在本机复制的所有文本（含其他应用），仅本次运行有效。密码等敏感文本也可能被记录，是否开启？'
      ))
    )
      return
    const lines = (text: string): string[] =>
      text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    const config: ClipboardHistoryConfig = {
      enabled,
      keywords: lines(keywords),
      prefixes: lines(prefixes)
    }
    await perform(() => bridge.setEnabled(config))
  }
  const entries =
    snapshot?.entries.filter((entry) =>
      entry.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    ) ?? []
  return (
    <div className="sheet-backdrop" onMouseDown={close}>
      <div
        className="sheet-panel capability-sheet"
        ref={ref}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="剪贴板历史"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-toolbar">
          <h2 className="panel-title">剪贴板历史</h2>
          <button type="button" className="btn-ghost" onClick={close}>
            关闭
          </button>
        </div>
        <div className="sheet-scroll">
          <p className="field-hint">
            仅记录纯文本，最多 200 条。退出即清空；应用内复制的内容不纳入历史。
          </p>
          {!bridge ? (
            <p className="status-banner">桌面桥接未就绪，请重启桌面应用。</p>
          ) : (
            <>
              <div className="capability-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => void configure(!snapshot?.enabled)}
                >
                  {snapshot?.enabled ? '关闭记录' : '开启记录'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy || !snapshot?.enabled}
                  onClick={() => void perform(() => bridge.pause())}
                >
                  暂停记录 30 分钟
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy || !snapshot?.entries.length}
                  onClick={() =>
                    void (async () => {
                      if (await confirmDialog('清空全部剪贴板历史（含固定项）？'))
                        await perform(() => bridge.clear())
                    })()
                  }
                >
                  清空全部
                </button>
              </div>
              <p role="status">
                {!snapshot?.enabled
                  ? '记录已关闭'
                  : snapshot.pausedUntilMs
                    ? `已暂停，${new Date(snapshot.pausedUntilMs).toLocaleTimeString('zh-CN')} 自动恢复`
                    : '正在记录'}
              </p>
              <details>
                <summary>忽略规则（仅本次运行）</summary>
                <label className="field-label">
                  关键词，每行一个
                  <textarea
                    className="field-input"
                    aria-label="忽略关键词"
                    value={keywords}
                    onChange={(event) => setKeywords(event.target.value)}
                  />
                </label>
                <label className="field-label">
                  前缀，每行一个
                  <textarea
                    className="field-input"
                    aria-label="忽略前缀"
                    value={prefixes}
                    onChange={(event) => setPrefixes(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => void configure(snapshot?.enabled ?? false)}
                >
                  保存忽略规则
                </button>
              </details>
              <input
                className="field-input"
                aria-label="搜索剪贴板历史"
                placeholder="搜索文本"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {message || snapshot?.error ? (
                <p className="status-banner" role="status">
                  {message || snapshot?.error}
                </p>
              ) : null}
              {!entries.length ? (
                <p className="sheet-empty">
                  {query
                    ? '没有匹配记录，试试其他关键词。'
                    : '暂无历史，开启后复制一段纯文本即可。'}
                </p>
              ) : (
                <ul className="capability-list">
                  {entries.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="btn-ghost clipboard-preview"
                        disabled={busy}
                        title="写回系统剪贴板"
                        onClick={() => {
                          setBusy(true)
                          void window.toolbox.system
                            .copyText(entry.text)
                            .then(() => setMessage('已复制'))
                            .catch(() => setMessage('复制失败，请重试'))
                            .finally(() => setBusy(false))
                        }}
                      >
                        {entry.preview}
                      </button>
                      <p className="field-hint">
                        {entry.pinned ? '固定 · ' : ''}
                        {new Date(entry.capturedAtMs).toLocaleTimeString('zh-CN')}
                        {entry.truncated ? ' · 已截断至 10,000 字符' : ''}
                      </p>
                      <div className="capability-actions">
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={busy}
                          onClick={() => void perform(() => bridge.pin(entry.id, !entry.pinned))}
                        >
                          {entry.pinned ? '取消固定' : '固定'}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={busy}
                          onClick={() => void perform(() => bridge.clear(entry.id))}
                        >
                          删除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
