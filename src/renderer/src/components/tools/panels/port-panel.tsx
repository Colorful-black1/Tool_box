import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { PortSnapshot, PortProcessView } from '@shared/types'
import { Dropdown } from '../../dropdown'
import { CopyButton } from '../workbench'
import { confirmDialog } from '../../../stores/dialog-store'

export function PortPanel(): JSX.Element {
  const [snapshot, setSnapshot] = useState<PortSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [stoppingPid, setStoppingPid] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [protocol, setProtocol] = useState('all')
  const [listening, setListening] = useState(true)
  const [page, setPage] = useState(0)
  const request = useRef({ sequence: 0, loading: false, stopping: false, mounted: true })
  useEffect(() => {
    const state = request.current
    state.mounted = true
    return () => {
      state.mounted = false
      state.sequence++
    }
  }, [])
  const refresh = async (afterStop = false): Promise<void> => {
    if (request.current.loading || (request.current.stopping && !afterStop)) return
    const sequence = ++request.current.sequence
    // 输入仅在手动查询时应用；停止进程后的刷新继续使用上次已提交条件。
    setAppliedQuery(afterStop ? appliedQuery : query)
    setSnapshot(null)
    setError('')
    setNotice('')
    setPage(0)
    if (!window.toolbox?.system?.portProcesses) {
      setError('端口接口未就绪，请使用最新桌面应用')
      return
    }
    request.current.loading = true
    setBusy(true)
    try {
      const result = await window.toolbox.system.portProcesses()
      if (sequence === request.current.sequence) setSnapshot(result)
    } catch (error) {
      if (sequence === request.current.sequence)
        setError(
          error instanceof Error && error.message.includes('仅支持 Windows')
            ? '端口与进程查询目前仅支持 Windows'
            : '无法读取端口占用，系统命令失败或超时，请稍后重试'
        )
    } finally {
      request.current.loading = false
      if (sequence === request.current.sequence) setBusy(false)
    }
  }
  const stopProcess = async (row: PortProcessView): Promise<void> => {
    if (busy || request.current.stopping || !row.stopToken) return
    const bridge = window.toolbox?.system
    if (!bridge?.stopPortProcess) {
      setError('停止进程接口未就绪，请更新并重启桌面应用')
      return
    }
    const sequence = request.current.sequence
    request.current.stopping = true
    setStoppingPid(row.pid)
    setError('')
    setNotice('')
    try {
      const confirmed = await confirmDialog(
        `停止进程「${row.processName}」（PID ${row.pid}）？当前占用 ${row.protocol} ${row.address}:${row.port}。这会结束整个进程并关闭其全部端口，未保存的数据可能丢失。`
      )
      if (!confirmed || sequence !== request.current.sequence || !request.current.mounted) return
      const result = await bridge.stopPortProcess(row.stopToken)
      if (!request.current.mounted) return
      await refresh(true)
      if (!request.current.mounted) return
      if (result.status === 'stopped' || result.status === 'gone') setNotice(result.message)
      else setError(result.message)
    } catch {
      if (request.current.mounted) setError('无法确认停止结果，请重新查询端口后再操作')
    } finally {
      request.current.stopping = false
      if (request.current.mounted) setStoppingPid(null)
    }
  }
  const keyword = appliedQuery.trim().toLowerCase()
  const entries = (snapshot?.entries ?? []).filter(
    (row) =>
      (protocol === 'all' || protocol === row.protocol) &&
      (!listening || row.state === 'LISTENING' || row.protocol === 'UDP') &&
      (!keyword ||
        [row.address, row.port, row.pid, row.processName].some((v) =>
          String(v).toLowerCase().includes(keyword)
        ))
  )
  const text = entries
    .map(
      (row) =>
        `${row.protocol}\t${row.address}\t${row.port}\t${row.state}\t${row.pid}\t${row.processName}\t${row.remote}`
    )
    .join('\n')
  // 监听端口对应的进程已不在快照中：可能是快照过期，也可能是子进程继承了监听句柄。
  const hasExitedListener =
    snapshot?.processNamesAvailable === true &&
    entries.some(
      (row) => row.pid > 4 && row.state === 'LISTENING' && row.processName.includes('已退出')
    )
  return (
    <section className="tool-stack tool-port-section" aria-label="端口与进程诊断">
      <header className="tool-io-head">
        <span className="tool-io-label">端口占用与进程</span>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || stoppingPid !== null}
          title="输入端口或进程后按 Enter，也可点击查询"
          onClick={() => void refresh()}
        >
          {busy ? '查询中…' : '查询端口占用'}
        </button>
      </header>
      <p className="field-hint">
        查看 Windows TCP / UDP、PID 与进程名。停止操作会结束整个进程，不仅是当前端口；
        系统关键进程及工具箱自身进程不可停止。输入后按 Enter 或点击查询，不自动查询。
      </p>
      <div className="tool-controls">
        <input
          className="field-input tool-port-search"
          aria-label="筛选端口或进程"
          value={query}
          maxLength={100}
          placeholder="端口 / PID / 进程名 / 本地地址，Enter 查询"
          aria-keyshortcuts="Enter"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            if (!event.repeat) void refresh()
          }}
        />
        <Dropdown
          ariaLabel="端口协议"
          value={protocol}
          options={[
            { value: 'all', label: '全部协议' },
            { value: 'TCP', label: 'TCP' },
            { value: 'UDP', label: 'UDP' }
          ]}
          onChange={(value) => {
            setProtocol(value)
            setPage(0)
          }}
        />
        <label className="tool-check">
          <input
            type="checkbox"
            checked={listening}
            onChange={(event) => {
              setListening(event.target.checked)
              setPage(0)
            }}
          />
          仅 TCP 监听与 UDP 绑定
        </label>
        <CopyButton text={text} label="复制筛选结果" />
      </div>
      {snapshot && query.trim() !== appliedQuery.trim() ? (
        <p className="field-hint" role="status">
          输入已修改，按 Enter 或点击查询后生效；当前显示上次查询结果。
        </p>
      ) : null}
      {error ? (
        <div className="status-banner" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="status-banner success-banner" role="status">
          {notice}
        </div>
      ) : null}
      {snapshot ? (
        <>
          {!snapshot.processNamesAvailable ? (
            <div className="status-banner" role="alert">
              <span>
                进程信息读取失败，端口与 PID 已保留；停止进程暂不可用，请重新查询后重试。
              </span>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || stoppingPid !== null}
                onClick={() => void refresh()}
              >
                重新查询
              </button>
            </div>
          ) : null}
          {hasExitedListener ? (
            <div className="status-banner" role="alert">
              <span>
                有监听端口对应的进程已退出或无法读取身份。可能是快照过期，或子进程继承了监听句柄；
                本工具不会停止无法核实的 PID，请重新查询，必要时结束实际占用端口的子进程或重启相关服务。
              </span>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || stoppingPid !== null}
                onClick={() => void refresh()}
              >
                重新查询
              </button>
            </div>
          ) : null}
          <p className="field-hint" role="status">
            快照 {new Date(snapshot.capturedAt).toLocaleTimeString()} · 共 {snapshot.total} 项 ·
            筛选后 {entries.length} 项
            {snapshot.total > snapshot.entries.length
              ? `（仅载入前 ${snapshot.entries.length} 项，可刷新）`
              : ''}
          </p>
          <div className="tool-diff">
            <table className="tool-ip-table" aria-label="端口占用列表">
              <thead>
                <tr>
                  <th>协议</th>
                  <th>本地地址 : 端口</th>
                  <th>状态</th>
                  <th>PID</th>
                  <th>进程</th>
                  <th>远端</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(page * 50, (page + 1) * 50).map((row) => (
                  <tr
                    key={`${row.protocol}/${row.address}/${row.port}/${row.remote}/${row.pid}/${row.state}`}
                  >
                    <td>{row.protocol}</td>
                    <td>
                      <code>
                        {row.address.includes(':') ? `[${row.address}]` : row.address}:{row.port}
                      </code>
                    </td>
                    <td>
                      {row.state === 'LISTENING'
                        ? '监听'
                        : row.state === 'BOUND'
                          ? '绑定'
                          : row.state}
                    </td>
                    <td>{row.pid}</td>
                    <td>{row.processName}</td>
                    <td>
                      <code>{row.remote || '—'}</code>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost btn-danger"
                        disabled={busy || stoppingPid !== null || !row.stopToken}
                        title={row.stopBlockedReason ?? '结束整个进程，不自动提权'}
                        aria-label={`停止进程 ${row.processName}，PID ${row.pid}，${row.stopBlockedReason ?? '需确认'}`}
                        onClick={() => void stopProcess(row)}
                      >
                        {stoppingPid === row.pid ? '处理中…' : '停止进程'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!entries.length ? <p className="field-hint">没有匹配的端口。</p> : null}
          {entries.length > 50 ? (
            <div className="tool-controls">
              <button
                type="button"
                className="btn-ghost"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </button>
              <span className="field-hint">
                第 {page + 1} / {Math.ceil(entries.length / 50)} 页
              </span>
              <button
                type="button"
                className="btn-ghost"
                disabled={(page + 1) * 50 >= entries.length}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
