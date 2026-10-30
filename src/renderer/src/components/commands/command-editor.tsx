import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import type { DeveloperCommand, DeveloperCommandInput } from '@shared/developer-commands'
import {
  COMMAND_RISKS,
  COMMAND_RISK_LABELS,
  COMMAND_SHELLS,
  COMMAND_SHELL_LABELS
} from '@shared/developer-commands'
import { useDeveloperCommandStore } from '../../stores/developer-command-store'
import { useAppStore } from '../../stores/app-store'
import { confirmDialog } from '../../stores/dialog-store'
import { useModalFocus } from '../../lib/use-modal-focus'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'
import { Dropdown } from '../dropdown'
import { CloseIcon } from '../icons'

/** 编辑器保留原 revision，刷新快照不能偷偷解除冲突保护。 */
export function CommandEditor({
  entry,
  categories,
  onClose
}: {
  entry?: DeveloperCommand
  categories: string[]
  onClose(): void
}): JSX.Element {
  const snapshot = useDeveloperCommandStore((state) => state.snapshot)
  const ready = useDeveloperCommandStore((state) => state.ready)
  const loading = useDeveloperCommandStore((state) => state.loading)
  const saving = useDeveloperCommandStore((state) => state.saving)
  const error = useDeveloperCommandStore((state) => state.error)
  const save = useDeveloperCommandStore((state) => state.save)
  const load = useDeveloperCommandStore((state) => state.load)
  const setUnsaved = useAppStore((state) => state.setUnsavedChanges)
  const panel = useRef<HTMLDivElement>(null)
  const [initial] = useState<DeveloperCommandInput>(() => ({
    title: entry?.title ?? '',
    command: entry?.command ?? '',
    category: entry?.category ?? '其他',
    description: entry?.description ?? '',
    tags: entry?.tags ?? [],
    shell: entry?.shell ?? 'unspecified',
    risk: entry?.risk ?? 'read',
    expectedRevision: snapshot.revision,
    ...(entry?.id.startsWith('user:') ? { id: entry.id } : {})
  }))
  const [draft, setDraft] = useState(initial)
  const [tags, setTags] = useState(initial.tags.join('，'))
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initial) || tags !== initial.tags.join('，')
  const conflict = draft.expectedRevision !== snapshot.revision
  const current = snapshot.entries.find((item) => item.id === draft.id)
  useEffect(() => {
    setUnsaved(dirty)
    return () => setUnsaved(false)
  }, [dirty, setUnsaved])
  const close = async (): Promise<void> => {
    if (saving) return
    if (!dirty || (await confirmDialog('有未保存的命令，是否放弃本次编辑？'))) onClose()
  }
  useModalFocus(panel)
  useOverlayEscape(() => void close())
  const change = (patch: Partial<DeveloperCommandInput>): void =>
    setDraft((old) => ({ ...old, ...patch }))
  return createPortal(
    <div
      className="usage-sheet-backdrop command-editor-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void close()
      }}
    >
      <div
        className="glass command-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-editor-title"
        ref={panel}
      >
        <div className="command-editor-head">
          <h2 id="command-editor-title">{initial.id ? '编辑命令' : '新增命令'}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭命令编辑"
            disabled={saving}
            onClick={() => void close()}
          >
            <CloseIcon />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save({
              ...draft,
              tags: tags
                .split(/[,，]/)
                .map((item) => item.trim())
                .filter(Boolean)
            }).then((ok) => {
              if (ok) onClose()
            })
          }}
        >
          <fieldset disabled={saving} className="command-editor-fields">
            <label className="field-label">
              标题
              <input
                className="field-input"
                data-autofocus
                required
                maxLength={80}
                value={draft.title}
                onChange={(event) => change({ title: event.target.value })}
              />
            </label>
            <label className="field-label">
              命令
              <textarea
                aria-label="命令"
                className="field-input command-body-input"
                required
                maxLength={8000}
                value={draft.command}
                onChange={(event) => change({ command: event.target.value })}
                spellCheck={false}
              />
            </label>
            <div className="command-editor-row">
              <label className="field-label">
                分类
                <input
                  className="field-input"
                  maxLength={32}
                  required
                  value={draft.category}
                  onChange={(event) => change({ category: event.target.value })}
                />
              </label>
              <Dropdown
                ariaLabel="选择已有分类"
                value={draft.category}
                options={categories.map((name) => ({ value: name, label: name }))}
                placeholder="已有分类"
                onChange={(category) => change({ category })}
              />
            </div>
            <label className="field-label">
              用途说明
              <textarea
                aria-label="用途说明"
                className="field-input"
                maxLength={2000}
                value={draft.description}
                onChange={(event) => change({ description: event.target.value })}
              />
            </label>
            <label className="field-label">
              标签
              <input
                className="field-input"
                placeholder="用逗号分隔，最多 8 个"
                maxLength={220}
                value={tags}
                onChange={(event) => setTags(event.target.value)}
              />
            </label>
            <div className="command-editor-row">
              <div>
                <span className="field-label">适用 Shell</span>
                <Dropdown
                  ariaLabel="适用 Shell"
                  value={draft.shell}
                  options={COMMAND_SHELLS.map((value) => ({
                    value,
                    label: COMMAND_SHELL_LABELS[value]
                  }))}
                  onChange={(shell) => change({ shell: shell as DeveloperCommandInput['shell'] })}
                />
              </div>
              <div>
                <span className="field-label">注意事项</span>
                <Dropdown
                  ariaLabel="注意事项"
                  value={draft.risk}
                  options={COMMAND_RISKS.map((value) => ({
                    value,
                    label: COMMAND_RISK_LABELS[value]
                  }))}
                  onChange={(risk) => change({ risk: risk as DeveloperCommandInput['risk'] })}
                />
              </div>
            </div>
          </fieldset>
          {error ? (
            <p className="status-banner" role="alert">
              {error}
            </p>
          ) : null}
          {conflict ? (
            <div className="status-banner command-conflict">
              <p>命令库已更新，请核对最新记录。当前输入尚未覆盖。</p>
              <pre>
                {draft.id
                  ? current
                    ? JSON.stringify(current, null, 2)
                    : '原记录已不存在'
                  : '这是一条新增命令，可保留当前输入继续保存。'}
              </pre>
              <button
                type="button"
                className="btn-ghost"
                disabled={saving || Boolean(draft.id && !current)}
                onClick={() => change({ expectedRevision: snapshot.revision })}
              >
                已核对，保留我的修改
              </button>
            </div>
          ) : null}
          <div className="command-editor-actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={saving || loading}
              onClick={() => void load()}
            >
              刷新核对
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={saving}
              onClick={() => void close()}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn-gold"
              disabled={saving || loading || !ready || conflict}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
