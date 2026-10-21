import { useState } from 'react'
import type { JSX } from 'react'
import { useOpenCodeStore } from '../../stores/opencode-store'
import { CodeIcon, RefreshIcon, SettingsIcon } from '../icons'

/** 连接配置只显示程序路径和目录，不请求或展示 OpenCode 凭据。 */
export function OpenCodeConnection(): JSX.Element {
  const info = useOpenCodeStore((state) => state.info)
  const directory = useOpenCodeStore((state) => state.directory)
  const busy = useOpenCodeStore((state) => state.busy)
  const inspect = useOpenCodeStore((state) => state.inspect)
  const chooseExecutable = useOpenCodeStore((state) => state.chooseExecutable)
  const chooseDirectory = useOpenCodeStore((state) => state.chooseDirectory)
  const connect = useOpenCodeStore((state) => state.connect)
  const disconnect = useOpenCodeStore((state) => state.disconnect)
  const openDesktop = useOpenCodeStore((state) => state.openDesktop)
  const connected = info?.connected === true
  const [expanded, setExpanded] = useState(false)
  const showSettings = !connected || expanded
  let connectionHint = '准备就绪，点击「连接 OpenCode」即可；无需先打开 Desktop。'
  if (busy) connectionHint = '正在处理 OpenCode 操作，请稍候…'
  else if (!info)
    connectionHint = '程序检测尚未完成，请点击「重新检测」；如仍失败，请重启 Tool_box。'
  else if (!info.executablePath)
    connectionHint = '未检测到 OpenCode 内置程序，请点击「重新检测」或「选择程序」。'
  else if (!directory) connectionHint = '已检测到 OpenCode 程序，请先点击「选择项目」，再连接。'
  return (
    <section className="glass opencode-connection" aria-label="OpenCode 连接">
      <div className="opencode-connection-head">
        <span className="opencode-brandmark">
          <CodeIcon />
        </span>
        <div className="opencode-identity">
          <div className="opencode-identity-title">
            <h2>OpenCode</h2>
            <span className="opencode-connection-status" data-connected={connected} role="status">
              {busy ? '处理中…' : connected ? `已连接 · ${info.version}` : '未连接'}
            </span>
          </div>
          <p title={connected ? directory : undefined}>
            {connected ? directory : '复用 Desktop 内置运行时 · 登录与模型沿用 OpenCode 配置'}
          </p>
        </div>
        <div className="opencode-connection-actions">
          {connected ? (
            <button
              type="button"
              className="btn-ghost"
              aria-expanded={expanded}
              aria-controls="opencode-connection-settings"
              onClick={() => setExpanded(!expanded)}
            >
              <SettingsIcon />
              连接设置
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => void openDesktop()}
          >
            打开 OpenCode Desktop
          </button>
          {connected ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              断开连接
            </button>
          ) : null}
        </div>
      </div>
      {showSettings ? (
        <div className="opencode-connection-settings" id="opencode-connection-settings">
          <div className="opencode-connection-fields">
            <div className="opencode-path-field">
              <label className="tool-io">
                <span className="field-label">运行程序</span>
                <input
                  className="field-input"
                  aria-label="OpenCode 程序路径"
                  value={info?.executablePath ?? ''}
                  readOnly
                  placeholder="自动检测标准桌面安装位置，或手动选择 CLI"
                />
              </label>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || connected}
                onClick={() => void chooseExecutable()}
              >
                选择程序
              </button>
            </div>
            <div className="opencode-path-field">
              <label className="tool-io">
                <span className="field-label">项目目录</span>
                <input
                  className="field-input"
                  aria-label="编程项目目录"
                  value={directory}
                  readOnly
                  placeholder="选择需要分析或修改的项目"
                />
              </label>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || connected}
                onClick={() => void chooseDirectory()}
              >
                选择项目
              </button>
            </div>
          </div>
          <div className="tool-controls">
            {!connected ? (
              <button
                type="button"
                className="btn-gold"
                disabled={busy || !directory || !info?.executablePath}
                aria-describedby="opencode-connection-hint"
                title={connectionHint}
                onClick={() => void connect()}
              >
                连接 OpenCode
              </button>
            ) : null}
            {!connected ? (
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => void inspect(true)}
              >
                <RefreshIcon />
                重新检测
              </button>
            ) : null}
            <span className="field-hint" id="opencode-connection-hint" role="status">
              {connected
                ? '连接不会发送任务；目录不是沙箱，操作权限由 OpenCode 执行。'
                : connectionHint}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  )
}
