import { useState } from 'react'
import type { JSX } from 'react'
import type { BackupResult } from '../../../../shared/backup'
import { useAppStore } from '../../stores/app-store'
import { flushAgentDrafts } from '../../lib/agent-draft-sync'

/** 本机快照明确提示设备绑定与外传风险，恢复确认由主进程原生对话框执行。 */
export function BackupSettings(): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<BackupResult | null>(null)
  const bridge = window.toolbox?.backup
  const run = async (purpose: 'export' | 'restore'): Promise<void> => {
    if (!bridge || busy) return
    if (purpose === 'restore' && useAppStore.getState().hasUnsavedChanges) {
      setMessage('请先保存或放弃当前编辑，再从快照恢复。')
      return
    }
    setBusy(true)
    setMessage('')
    setResult(null)
    try {
      if (purpose === 'restore' && !(await flushAgentDrafts())) {
        setMessage('最新 Agent 草稿尚未确认保存，请重试后再恢复。')
        return
      }
      const folder = await bridge.chooseFolder(purpose)
      if (!folder) return
      const outcome =
        purpose === 'export'
          ? await bridge.export(folder.token)
          : await bridge.restore(folder.token)
      setResult(outcome)
      if (outcome)
        setMessage(
          purpose === 'export'
            ? '本机快照已导出，仅本机可恢复。请勿上传网盘或发给他人。'
            : '恢复完成，请手动重新启动应用。'
        )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
          : '快照操作失败，请重试。'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="glass settings-card" aria-label="数据与备份" aria-busy={busy}>
      <div className="sec-head">
        <h2 className="sec-title">数据与备份</h2>
      </div>
      <p className="field-hint">
        本机快照包含数据库、封面、背景、AI
        配置与系统封装的主密钥文件。仅可在原电脑、原系统用户与原安全存储环境下恢复，不能用于换机迁移。
      </p>
      <p className="status-banner">
        快照含敏感数据，请勿上传网盘或发给他人。重装系统后 DPAPI
        可能失效，请保留原系统用户的安全存储环境。
      </p>
      {!bridge ? <p className="status-banner">桌面桥接未就绪，请重启桌面应用。</p> : null}
      <div className="capability-actions">
        <button
          type="button"
          className="btn-ghost"
          disabled={!bridge || busy}
          onClick={() => void run('export')}
        >
          导出本机快照
        </button>
        <button
          type="button"
          className="btn-danger"
          disabled={!bridge || busy}
          onClick={() => void run('restore')}
        >
          从快照恢复
        </button>
      </div>
      {busy ? <p role="status">正在处理快照，请勿关闭应用…</p> : null}
      {message ? (
        <p role="status" className={`status-banner${result ? ' success-banner' : ''}`}>
          {message}
        </p>
      ) : null}
      {result ? <p className="capability-path">{result.path}</p> : null}
      <p className="field-hint">
        导出在文档目录内新建独立文件夹，不覆盖已有快照。恢复前自动生成当前数据快照，完成后退出应用，需手动重新打开。
      </p>
    </section>
  )
}
