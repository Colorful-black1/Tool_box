import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'

import type { SkillRootsView } from '@shared/extensions'

import { ipcErrorText } from '../../lib/extension-errors'

/**
 * 技能扫描路径。
 *
 * 默认来源固定为 5 类常用目录；这里只管理额外路径，写入 Tool_box 自己的
 * `skill-roots.json`，不修改任何 Agent 配置。
 */
export function SkillRootsSettings(): JSX.Element {
  const [view, setView] = useState<SkillRootsView | null>(null)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const bridge = window.toolbox?.skillHub

  const load = useCallback(async (): Promise<void> => {
    if (!bridge?.roots) {
      setError('当前版本未提供技能路径配置，请更新并重启应用')
      return
    }
    try {
      setView(await bridge.roots())
    } catch (reason) {
      setError(ipcErrorText(reason, '读取技能扫描路径失败'))
    }
  }, [bridge])

  useEffect(() => {
    void load()
  }, [load])

  const add = async (): Promise<void> => {
    if (!bridge?.addRoot || busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setView(await bridge.addRoot(path))
      setPath('')
      setMessage('已添加；技能页刷新后生效。')
    } catch (reason) {
      setError(ipcErrorText(reason, '添加路径失败'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (target: string): Promise<void> => {
    if (!bridge?.removeRoot || busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setView(await bridge.removeRoot(target))
      setMessage('已删除。')
    } catch (reason) {
      setError(ipcErrorText(reason, '删除路径失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="glass settings-card" aria-label="技能扫描路径" aria-busy={busy}>
      <div className="sec-head">
        <h2 className="sec-title">技能扫描路径</h2>
      </div>
      <p className="field-hint">
        默认只统计 Claude Code、Codex、OpenCode、DeepSeek Harness 与通用技能目录。需要统计其它目录（例如
        CC Switch 的主副本 <code>~/.cc-switch/skills</code>）时在这里添加，支持
        <code>~/</code> 或绝对路径，只写 Tool_box 自己的配置，不改任何 Agent。
      </p>

      <div className="skill-root-defaults">
        {(view?.defaults ?? []).map((root) => (
          <span className="skill-root-chip" key={root.path} title={root.path}>
            {root.label} · {root.displayPath}
            {root.exists ? '' : '（未发现）'}
          </span>
        ))}
      </div>

      <p className="field-label">已添加的自定义路径</p>
      {view?.custom.length ? (
        <ul className="skill-root-list">
          {view.custom.map((root) => (
            <li className="skill-root-row" key={root.path}>
              <code title={root.displayPath}>{root.displayPath}</code>
              {!root.exists ? <span className="ext-badge">路径不存在</span> : null}
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => void remove(root.path)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">尚未添加自定义路径。</p>
      )}

      <div className="skill-root-form">
        <input
          className="field-input"
          value={path}
          placeholder="~/.cc-switch/skills"
          aria-label="新增技能扫描路径"
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void add()
            }
          }}
        />
        <button
          type="button"
          className="btn-gold"
          disabled={busy || !path.trim()}
          onClick={() => void add()}
        >
          添加路径
        </button>
      </div>
      {error ? (
        <p className="status-banner" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="status-banner success-banner" role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}
