import { useState } from 'react'
import type { JSX } from 'react'

import type { PasswordDraft, PasswordImportMode } from '../../../../shared/types'
import { useAppStore } from '../../stores/app-store'

interface Props {
  onClose(): void
  onImported(count: number): Promise<void>
}

interface FixedImportPayload {
  imported: number
  skipped: number
  entries: PasswordDraft[]
}

const FORMAT_SAMPLE = `名称: 淘宝
网址: https://taobao.com
账号: user@example.com
密码: Pass@123
备注: 主账号

名称: 微信
账号: wx_test
密码: abc888`

/**
 * 密码批量导入：固定格式 / AI 识别 双通道 + 重复检测 + 预览勾选。
 * 对应旧项目 password_import_page.dart。
 */
export function PasswordImportSheet({ onClose, onImported }: Props): JSX.Element {
  const saveDrafts = useAppStore((state) => state.savePasswordDrafts)

  const [mode, setMode] = useState<PasswordImportMode>('fixed')
  const [drafts, setDrafts] = useState<PasswordDraft[]>([])
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [skipped, setSkipped] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function reset(): void {
    setDrafts([])
    setPicked(new Set())
    setSkipped(0)
    setError('')
  }

  function switchMode(next: PasswordImportMode): void {
    setMode(next)
    reset()
  }

  async function loadFixed(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const result = (await window.toolbox?.passwords.importFixed()) as
        | FixedImportPayload
        | null
      if (!result) return
      setDrafts(result.entries ?? [])
      setSkipped(result.skipped)
      setPicked(
        new Set(
          (result.entries ?? [])
            .map((item, index) => (item.duplicate ? -1 : index))
            .filter((index) => index >= 0)
        )
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取文件失败')
    } finally {
      setBusy(false)
    }
  }

  async function loadAi(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const list = await window.toolbox?.passwords.importAi()
      if (!list) return
      setDrafts(list)
      setSkipped(0)
      setPicked(
        new Set(
          list.map((item, index) => (item.duplicate ? -1 : index)).filter((index) => index >= 0)
        )
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'AI 识别失败')
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    if (picked.size === 0 || saving) return
    setSaving(true)
    try {
      const selected = drafts.filter((_, index) => picked.has(index))
      const imported = await saveDrafts(selected)
      await onImported(imported)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '导入失败')
      setSaving(false)
    }
  }

  const busyLabel = busy
    ? mode === 'fixed'
      ? '解析中…'
      : 'AI 识别中，请稍候…'
    : '选择文本文件'

  return (
    <div
      className="overlay import-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="批量导入密码"
    >
      <div className="glass overlay-card import-card">
        <div className="overlay-head-row">
          <h3 className="panel-title">批量导入</h3>
          <button
            type="button"
            className="sheet-close"
            aria-label="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="segmented import-mode">
          <button
            type="button"
            className={`segment${mode === 'fixed' ? ' active' : ''}`}
            onClick={() => switchMode('fixed')}
          >
            固定格式
          </button>
          <button
            type="button"
            className={`segment${mode === 'ai' ? ' active' : ''}`}
            onClick={() => switchMode('ai')}
          >
            AI 识别
          </button>
        </div>

        {mode === 'fixed' ? (
          <div className="format-hint">
            <p className="format-hint-title">格式说明</p>
            <pre className="format-sample">{FORMAT_SAMPLE}</pre>
            <p className="format-hint-note">
              条目之间空行分隔；支持中英文标签与全半角冒号；无法识别的行会被跳过。
            </p>
          </div>
        ) : (
          <div className="format-hint">
            <p className="format-hint-title">AI 智能识别</p>
            <p className="format-hint-note">
              任意格式的密码记录交给 AI 自动提取（需先在「设置 → AI 配置」中配置
              OpenAI 兼容接口）。识别结果逐条勾选后入库。
            </p>
            <p className="format-hint-warn">
              文件内容会上传到你所配置的 AI 服务商，请注意隐私。
            </p>
          </div>
        )}

        <div className="toolbar-row">
          <button
            type="button"
            className="btn-gold"
            disabled={busy}
            onClick={() => void (mode === 'fixed' ? loadFixed() : loadAi())}
          >
            {busyLabel}
          </button>
          <span className="field-hint">支持 .txt / .md</span>
        </div>

        {error ? (
          <div className="status-banner" role="alert">
            {error}
          </div>
        ) : null}

        {skipped > 0 ? (
          <div className="skipped-hint">已跳过 {skipped} 行无法识别的内容</div>
        ) : null}

        {drafts.length === 0 && !busy && !error ? (
          <p className="sheet-empty">尚未解析任何条目</p>
        ) : null}

        {drafts.length > 0 ? (
          <>
            <div className="import-preview-head">
              <span className="import-count">
                共 {drafts.length} 条，已选 {picked.size} 条
              </span>
              <button
                type="button"
                className="btn-ghost"
                onClick={() =>
                  setPicked(
                    picked.size === drafts.length
                      ? new Set()
                      : new Set(drafts.map((_, index) => index))
                  )
                }
              >
                {picked.size === drafts.length ? '取消全选' : '全选'}
              </button>
            </div>
            <ul className="import-preview-list">
              {drafts.map((draft, index) => (
                <li key={index}>
                  <label className={`import-item${draft.duplicate ? ' duplicate' : ''}`}>
                    <input
                      type="checkbox"
                      checked={picked.has(index)}
                      onChange={(event) => {
                        const next = new Set(picked)
                        if (event.target.checked) next.add(index)
                        else next.delete(index)
                        setPicked(next)
                      }}
                    />
                    <span className="import-item-text">
                      <span className="import-item-title">
                        {draft.title || '（无名称）'}
                        {draft.duplicate ? <em className="dup-flag">已存在</em> : null}
                      </span>
                      <span className="import-item-sub">
                        {[draft.account, draft.password, draft.url, draft.remark]
                          .filter(Boolean)
                          .join('　') || '（无其他信息）'}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="overlay-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-gold"
            disabled={picked.size === 0 || saving}
            onClick={() => void confirm()}
          >
            {saving ? '导入中…' : `导入所选（${picked.size}）`}
          </button>
        </div>
      </div>
    </div>
  )
}