import { useState } from 'react'
import type { JSX } from 'react'
import { useCodingAgentStore } from '../../stores/coding-agent-store'
import { CODING_AGENT_NAMES, WORKBENCH_AGENT_IDS } from '@shared/coding-agents'
import { CodeIcon, RefreshIcon, SettingsIcon } from '../icons'

/** 正常操作只选择 Agent 和项目，程序诊断收进连接设置。 */
export function OpenCodeConnection(): JSX.Element {
  const info = useCodingAgentStore((state) => state.info)
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const switchRuntime = useCodingAgentStore((state) => state.switchRuntime)
  const directory = useCodingAgentStore((state) => state.directory)
  const busy = useCodingAgentStore((state) => state.busy)
  const runningRuntime = useCodingAgentStore((state) => state.runningRuntime)
  const inspect = useCodingAgentStore((state) => state.inspect)
  const chooseExecutable = useCodingAgentStore((state) => state.chooseExecutable)
  const chooseDirectory = useCodingAgentStore((state) => state.chooseDirectory)
  const connect = useCodingAgentStore((state) => state.connect)
  const disconnect = useCodingAgentStore((state) => state.disconnect)
  const openDesktop = useCodingAgentStore((state) => state.openDesktop)
  const [expanded, setExpanded] = useState(false)
  const connected = Boolean(info?.connected && info.directory === directory)
  const showSettings = expanded || Boolean(info && !info.executablePath)
  const name = CODING_AGENT_NAMES[runtimeId]
  return (
    <section className="glass opencode-connection" aria-label={`${name} 连接`}>
      <div className="opencode-connection-head">
        <span className="opencode-brandmark">
          <CodeIcon />
        </span>
        <div className="opencode-identity">
          <div className="opencode-identity-title">
            <div className="opencode-agent-switch" role="group" aria-label="选择编程 Agent">
              {WORKBENCH_AGENT_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="btn-ghost"
                  aria-pressed={runtimeId === id}
                  onClick={() => switchRuntime(id)}
                >
                  {CODING_AGENT_NAMES[id]}
                </button>
              ))}
            </div>
            <span className="opencode-connection-status" data-connected={connected} role="status">
              {busy ? '处理中…' : connected ? '已连接' : '发送时连接'}
            </span>
          </div>
          <p title={directory}>{directory || '先选择项目，再输入任务'}</p>
        </div>
        <div className="opencode-connection-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || runningRuntime === runtimeId}
            onClick={() => void chooseDirectory()}
          >
            {directory ? '切换项目' : '选择项目'}
          </button>
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
        </div>
      </div>
      {showSettings ? (
        <div className="opencode-connection-settings" id="opencode-connection-settings">
          <div className="opencode-path-field">
            <label className="tool-io">
              <span className="field-label">
                {runtimeId === 'claude-desktop' ? 'Claude SDK 运行程序' : `${name} 程序`} ·{' '}
                {info?.version ?? '待检测'}
              </span>
              <input
                className="field-input"
                aria-label={`${name} 程序路径`}
                value={info?.executablePath ?? ''}
                readOnly
                placeholder={
                  runtimeId === 'claude-desktop'
                    ? '使用自带运行程序，也可选择官方 Claude Code CLI'
                    : '选择已安装的原生 CLI'
                }
              />
            </label>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy || !!info?.connected}
              onClick={() => void chooseExecutable()}
            >
              选择程序
            </button>
          </div>
          <div className="tool-controls">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void inspect(true)}
            >
              <RefreshIcon />
              重新检测
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy || !!runningRuntime || !directory || !info?.executablePath}
              onClick={() => (connected ? void disconnect() : void connect())}
            >
              {connected ? '断开连接' : `连接 ${name}`}
            </button>
            {runtimeId === 'opencode' ? (
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => void openDesktop()}
              >
                打开 OpenCode Desktop
              </button>
            ) : null}
          </div>
          <p className="field-hint">
            {info?.detail || '无需先打开桌面窗口；运行时沿用自己的登录和配置。'}
          </p>
        </div>
      ) : null}
    </section>
  )
}
