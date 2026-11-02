import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useCodingAgentStore } from '../../stores/coding-agent-store'
import { CODING_AGENT_NAMES, WORKBENCH_AGENT_IDS } from '@shared/coding-agents'
import { AgentIcon, BranchIcon, FolderIcon, RefreshIcon, SettingsIcon } from '../icons'
import { AgentIdentity } from '../agent-identity'
import { AgentExtensionSettings } from './agent-extension-settings'

/** 只取项目目录最后一段作为标题；完整路径仍在旁边显示，便于区分同名目录。 */
function projectName(directory: string): string {
  const parts = directory.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? directory
}

/** 正常操作只选择 Agent 和项目，程序诊断收进连接设置。 */
export function OpenCodeConnection(): JSX.Element {
  const info = useCodingAgentStore((state) => state.info)
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const switchRuntime = useCodingAgentStore((state) => state.switchRuntime)
  const directory = useCodingAgentStore((state) => state.directory)
  const busy = useCodingAgentStore((state) => state.busy)
  const running = useCodingAgentStore((state) => Boolean(state.runs[state.runtimeId]))
  const inspect = useCodingAgentStore((state) => state.inspect)
  const chooseExecutable = useCodingAgentStore((state) => state.chooseExecutable)
  const chooseDirectory = useCodingAgentStore((state) => state.chooseDirectory)
  const connect = useCodingAgentStore((state) => state.connect)
  const disconnect = useCodingAgentStore((state) => state.disconnect)
  const openDesktop = useCodingAgentStore((state) => state.openDesktop)
  const git = useCodingAgentStore((state) => state.git)
  const loadGitStatus = useCodingAgentStore((state) => state.loadGitStatus)
  const [expanded, setExpanded] = useState(false)
  const connected = Boolean(info?.connected && info.directory === directory)
  const showSettings = expanded || Boolean(info && !info.executablePath)
  const name = CODING_AGENT_NAMES[runtimeId]
  // 切换项目、连接或任务结束后重读；主进程有短缓存，重复调用不会反复起进程。
  useEffect(() => {
    if (directory) void loadGitStatus()
  }, [directory, runtimeId, connected, loadGitStatus])
  useEffect(() => {
    if (!running) void loadGitStatus()
  }, [running, loadGitStatus])
  return (
    <section className="glass opencode-connection" aria-label={`${name} 连接`}>
      <div className="opencode-connection-head">
        <span className="opencode-brandmark">
          <AgentIcon agent={runtimeId} />
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
                  <AgentIdentity agent={id} label={CODING_AGENT_NAMES[id]} />
                </button>
              ))}
            </div>
            <span className="opencode-connection-status" data-connected={connected} role="status">
              {busy ? '处理中…' : connected ? '已连接' : '发送时连接'}
            </span>
          </div>
        </div>
        <div className="opencode-connection-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || running}
            onClick={() => void chooseDirectory()}
          >
            <FolderIcon />
            {directory ? '切换项目' : '选择项目'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            aria-expanded={showSettings}
            aria-controls="opencode-connection-settings"
            onClick={() => setExpanded(!expanded)}
          >
            <SettingsIcon />
            连接设置
          </button>
        </div>
      </div>
      <div className="opencode-project" role="group" aria-label="当前项目">
        <span className="opencode-project-icon" aria-hidden="true">
          <FolderIcon />
        </span>
        {directory ? (
          <>
            <span className="opencode-project-name" title={directory}>
              {projectName(directory)}
            </span>
            <span className="opencode-project-path" title={directory}>
              {directory}
            </span>
            {git ? (
              <span className="opencode-git" aria-label="项目分支与改动">
                <span
                  className="opencode-git-branch"
                  title={git.detached ? '当前处于分离 HEAD' : `当前分支：${git.branch}`}
                >
                  <BranchIcon />
                  <span className="opencode-git-branch-name">
                    {git.detached ? '分离 HEAD' : git.branch || '未命名分支'}
                  </span>
                </span>
                {git.ahead > 0 ? (
                  <span className="opencode-git-track" title={`领先上游 ${git.ahead} 个提交`}>
                    ↑{git.ahead}
                  </span>
                ) : null}
                {git.behind > 0 ? (
                  <span className="opencode-git-track" title={`落后上游 ${git.behind} 个提交`}>
                    ↓{git.behind}
                  </span>
                ) : null}
                <span className="opencode-git-changes">
                  {git.changedFiles > 0 ? `${git.changedFiles} 个文件已更改` : '工作区干净'}
                </span>
                {git.changedFiles > 0 && (git.insertions > 0 || git.deletions > 0) ? (
                  <span className="opencode-git-stat" title="已跟踪文件的增删行（不含未跟踪文件）">
                    <span className="opencode-git-add">+{git.insertions}</span>
                    <span className="opencode-git-del">−{git.deletions}</span>
                  </span>
                ) : null}
                <button
                  type="button"
                  className="icon-btn opencode-git-refresh"
                  aria-label="刷新分支信息"
                  title="刷新分支信息"
                  onClick={() => void loadGitStatus()}
                >
                  <RefreshIcon />
                </button>
              </span>
            ) : null}
          </>
        ) : (
          <span className="opencode-project-empty">未选择项目</span>
        )}
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
              disabled={busy || running || !directory || !info?.executablePath}
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
          {runtimeId === 'claude-desktop' ? (
            <details className="agent-connection-help">
              <summary>Desktop 会话说明</summary>
              <p className="field-hint">
                仅含当前项目的 Code 历史；新会话不会自动出现在 Desktop。 续接 Desktop
                原会话前需退出外部 Claude 程序；本地网关需保持 CC Switch 运行。
              </p>
            </details>
          ) : null}
          <AgentExtensionSettings key={`${runtimeId}:${directory}`} />
        </div>
      ) : null}
    </section>
  )
}
