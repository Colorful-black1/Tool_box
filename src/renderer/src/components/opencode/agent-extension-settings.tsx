import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useCodingAgentStore } from '../../stores/coding-agent-store'
import { codingAgentClient } from '../../lib/coding-agent-client'
import { confirmDialog } from '../../stores/dialog-store'

/** 用户按入口和项目选择本机配置，默认隔离；不改写原生配置文件。 */
export function AgentExtensionSettings(): JSX.Element {
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const directory = useCodingAgentStore((state) => state.directory)
  const info = useCodingAgentStore((state) => state.info)
  const running = useCodingAgentStore((state) => state.runningRuntime)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const supported = runtimeId === 'claude' || runtimeId === 'claude-desktop'
  useEffect(() => {
    let cancelled = false
    setEnabled(false)
    setError('')
    if (supported && info?.connected && !running) {
      setBusy(true)
      void codingAgentClient()
        .readCatalog({ runtimeId })
        .then((catalog) => {
          if (!cancelled) setEnabled(catalog.extensionsEnabled)
        })
        .catch(() => {
          if (!cancelled) setError('扩展状态读取失败，可重新展开连接设置重试')
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }
    return () => {
      cancelled = true
    }
  }, [runtimeId, directory, info?.connectionId, info?.connected, supported, running])
  const change = async (): Promise<void> => {
    if (busy || running || !info?.connected) return
    const next = !enabled
    const selected = { runtimeId, directory, connectionId: info.connectionId }
    if (
      next &&
      !(await confirmDialog(
        `为当前项目加载${runtimeId === 'claude-desktop' ? '项目 / 本地' : '用户 / 项目 / 本地'}扩展配置？其中可能包含 Skill、MCP 子进程、hooks、环境变量和原生权限规则。不会修改原生配置，也不会发送模型任务。关闭后下次任务恢复隔离加载。`
      ))
    )
      return
    const current = useCodingAgentStore.getState()
    if (
      current.runtimeId !== selected.runtimeId ||
      current.directory !== selected.directory ||
      current.info?.connectionId !== selected.connectionId
    )
      return
    setBusy(true)
    setError('')
    try {
      await codingAgentClient().setExtensions({ runtimeId, directory, enabled: next })
      setEnabled(next)
    } catch {
      setError('扩展配置选择失败，请在任务结束后重试')
    } finally {
      setBusy(false)
    }
  }
  return supported ? (
    <div className="agent-extension-settings">
      <button
        type="button"
        className="btn-ghost"
        aria-pressed={enabled}
        disabled={!info?.connected || busy || Boolean(running)}
        onClick={() => void change()}
      >
        本机扩展配置：{busy ? '读取中…' : enabled ? '已开启' : '已关闭'}
      </button>
      <span className="field-hint">
        {runtimeId === 'claude-desktop'
          ? 'Desktop 仅加载项目扩展，保持 CLI 用户路由隔离。'
          : '开启后可发现本机 Skill / MCP；仅对本入口和当前项目生效。'}
      </span>
      {error ? (
        <p className="status-banner" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  ) : (
    <></>
  )
}
