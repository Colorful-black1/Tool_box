import type { JSX } from 'react'
import { formatFileSize, normalizeDisplayPath } from '../../../../../shared/file-tools'
import { useFileToolsStore } from '../../../stores/file-tools-store'

/** 查重结果只读，不提供删除、移动或自动释放空间操作。 */
export function DuplicatePanel(): JSX.Element {
  const directory = useFileToolsStore((state) => state.directory)
  const snapshot = useFileToolsStore((state) => state.snapshot)
  const busy = useFileToolsStore((state) => state.busy)
  const error = useFileToolsStore((state) => state.error)
  const choose = useFileToolsStore((state) => state.choose)
  const scan = useFileToolsStore((state) => state.scan)
  const cancel = useFileToolsStore((state) => state.cancel)
  const ready = Boolean(window.toolbox?.files)
  return (
    <section className="capability-tool" aria-label="重复文件查找">
      <p className="field-hint">
        只读比较文件内容，不删除或修改文件。最多 20,000 个文件、12 层目录，不跟随链接，不跨盘。
      </p>
      {!ready ? <p className="status-banner">桌面桥接未就绪，请重启桌面应用。</p> : null}
      <div className="capability-actions">
        <button
          type="button"
          className="btn-ghost"
          disabled={!ready || busy}
          onClick={() => void choose()}
        >
          选择目录
        </button>
        <button
          type="button"
          className="btn-gold"
          disabled={!ready || busy || !directory}
          onClick={() => void scan()}
        >
          开始查重
        </button>
        {busy ? (
          <button type="button" className="btn-ghost" onClick={() => void cancel()}>
            取消扫描
          </button>
        ) : null}
      </div>
      {directory ? (
        <p className="capability-path">{normalizeDisplayPath(directory.label)}</p>
      ) : null}
      {error || snapshot?.error ? (
        <p className="status-banner" role="alert">
          {error || snapshot?.error}
        </p>
      ) : null}
      {busy ? (
        <p role="status" aria-live="polite">
          {snapshot?.phase === 'hashing'
            ? `正在比较内容：${snapshot.hashed} / ${snapshot.candidates}`
            : `正在枚举：${snapshot?.files ?? 0} 个文件`}
        </p>
      ) : null}
      {snapshot && !busy ? (
        <p role="status">
          {snapshot.phase === 'cancelled'
            ? '扫描已取消，可重新开始。'
            : `已扫描 ${snapshot.files} 个文件 · ${snapshot.groups.length} 组重复 · 可释放 ${formatFileSize(snapshot.groups.reduce((sum, group) => sum + group.reclaimableBytes, 0))}（仅供参考）`}
        </p>
      ) : null}
      {snapshot?.warnings.map((warning) => (
        <p key={warning} className="field-hint">
          {warning}
        </p>
      ))}
      {!snapshot && !busy ? (
        <p className="sheet-empty">先选择一个目录，再查找内容完全相同的非空文件。</p>
      ) : null}
      {snapshot?.phase === 'completed' && !snapshot.groups.length ? (
        <p className="sheet-empty">本次扫描范围内没有发现重复文件，可换一个目录继续。</p>
      ) : null}
      {snapshot?.groups.map((group) => (
        <details className="duplicate-group" key={group.id}>
          <summary>
            {formatFileSize(group.size)} · {group.paths.length} 份 · 可释放{' '}
            {formatFileSize(group.reclaimableBytes)}
          </summary>
          <ul className="capability-list">
            {group.paths.map((path) => (
              <li className="capability-path" key={path}>
                {normalizeDisplayPath(path)}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  )
}
