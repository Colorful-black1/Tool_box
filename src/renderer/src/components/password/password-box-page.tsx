import { useModalFocus } from '../../lib/use-modal-focus'
import { confirmDialog } from '../../stores/dialog-store'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'

import type { PasswordEntryView } from '../../../../shared/types'
import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
  passwordStrength
} from '@shared/password-generator'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'
import { useAppStore } from '../../stores/app-store'
import { PasswordImportSheet } from './password-import-sheet'

type SortMode = 'all' | 'favorite'

const ALPHABET = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '#'
]

const ITEM_EXTENT = 72

type ListRow =
  | { kind: 'header'; letter: string }
  | { kind: 'entry'; entry: PasswordEntryView }

export function PasswordBoxPage(): JSX.Element {
  const entries = useAppStore((state) => state.passwords)
  const refreshPasswords = useAppStore((state) => state.refreshPasswords)
  const savePasswordEntry = useAppStore((state) => state.savePasswordEntry)
  const deletePasswordEntry = useAppStore((state) => state.deletePasswordEntry)
  const togglePasswordFavorite = useAppStore((state) => state.togglePasswordFavorite)
  const copyText = useAppStore((state) => state.copyText)
  const searchTarget = useAppStore((state) => state.searchTarget)
  const clearSearchTarget = useAppStore((state) => state.clearSearchTarget)

  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('all')
  const [editing, setEditing] = useState<PasswordEntryView | 'new' | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [flash, setFlash] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const reload = async (): Promise<void> => {
    setLoading(true)
    setLoadError('')
    try {
      await refreshPasswords()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (loading || loadError || searchTarget?.kind !== 'password') return
    if (entries.some((entry) => entry.id === searchTarget.id)) {
      setEditing(null)
      setImportOpen(false)
      setConfirmId(null)
      setDetailId(searchTarget.id)
    } else {
      setFlash('该条目已不存在，请重新搜索')
    }
    clearSearchTarget()
  }, [loading, loadError, searchTarget, entries, clearSearchTarget])

  const filtered = useMemo(() => {
    let list = entries
    if (sortMode === 'favorite') {
      list = list.filter((entry) => entry.isFavorite)
    }
    const keyword = query.trim().toLowerCase()
    if (keyword) {
      list = list.filter(
        (entry) =>
          entry.title.toLowerCase().includes(keyword) ||
          entry.url.toLowerCase().includes(keyword) ||
          entry.account.toLowerCase().includes(keyword)
      )
    }
    return list
  }, [entries, query, sortMode])

  /** 仅「全部」+ 无搜索时启用字母分组与索引条（与旧项目一致） */
  const showIndex = sortMode === 'all' && !query.trim()

  const { rows, letterIndex } = useMemo(() => {
    if (!showIndex) {
      return { rows: null as ListRow[] | null, letterIndex: {} as Record<string, number> }
    }
    const built: ListRow[] = []
    const index: Record<string, number> = {}
    let lastLetter: string | null = null
    for (const entry of filtered) {
      const letter = entry.firstLetter || '#'
      if (letter !== lastLetter) {
        lastLetter = letter
        index[letter] = built.length
        built.push({ kind: 'header', letter })
      }
      built.push({ kind: 'entry', entry })
    }
    return { rows: built, letterIndex: index }
  }, [filtered, showIndex])

  const presentLetters = useMemo(() => new Set(Object.keys(letterIndex)), [letterIndex])
  const detail = entries.find((entry) => entry.id === detailId) ?? null

  function toast(message: string): void {
    setFlash(message)
    window.setTimeout(() => setFlash(''), 1600)
  }

  function jumpToLetter(letter: string | null): void {
    const element = scrollRef.current
    if (!element || letter === null) return
    const index = letterIndex[letter]
    if (index === undefined) return
    element.scrollTo({
      top: Math.min(index * ITEM_EXTENT, element.scrollHeight),
      behavior: 'smooth'
    })
  }

  if (loading) {
    return (
      <div className="view-enter">
        <div className="loading-skeleton" />
        <div className="loading-skeleton" />
        <div className="loading-skeleton" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="view-enter message-empty">
        <div>
          <p className="empty-text">加载失败：{loadError}</p>
          <button type="button" className="btn-ghost" onClick={() => void reload()}>
            重试
          </button>
        </div>
      </div>
    )
  }

  const emptyMessage = query.trim()
    ? `没有匹配「${query.trim()}」的条目`
    : sortMode === 'favorite'
      ? '暂无常用条目，点击列表右侧星标添加'
      : '暂无条目，点右上角 + 新增'

  function renderRow(row: ListRow, key: string): JSX.Element {
    if (row.kind === 'header') {
      return (
        <div key={key} className="letter-header">
          {row.letter}
        </div>
      )
    }
    const entry = row.entry
    return (
      <PasswordRow
        key={entry.id}
        entry={entry}
        onOpen={() => setDetailId(entry.id)}
        onToggleFavorite={() =>
          void togglePasswordFavorite(entry.id, !entry.isFavorite)
        }
        onCopyPassword={async () => {
          if (!entry.password) return
          await copyText(entry.password)
          toast('已复制密码')
        }}
        onDelete={() => setConfirmId(entry.id)}
        confirming={confirmId === entry.id}
        onCancelDelete={() => setConfirmId(null)}
        onConfirmDelete={async () => {
          setConfirmId(null)
          await deletePasswordEntry(entry.id)
          toast('已删除')
        }}
      />
    )
  }

  return (
    <div className="view-enter password-page">
      <div className="toolbar-row">
        <input
          className="field-input toolbar-search"
          type="text"
          placeholder="搜索名称、网址或账号"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="segmented compact">
          <button
            type="button"
            className={`segment${sortMode === 'all' ? ' active' : ''}`}
            onClick={() => setSortMode('all')}
          >
            全部
          </button>
          <button
            type="button"
            className={`segment${sortMode === 'favorite' ? ' active' : ''}`}
            onClick={() => setSortMode('favorite')}
          >
            常用
          </button>
        </div>
        <div className="toolbar-grow" />
        {flash ? <span className="toast-inline">{flash}</span> : null}
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setImportOpen(true)}
        >
          批量导入
        </button>
        <button type="button" className="btn-gold" onClick={() => setEditing('new')}>
          ＋ 新增条目
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="message-empty">
          <p className="empty-text">{emptyMessage}</p>
        </div>
      ) : (
        <div className="pwd-list-wrap">
          <div className="pwd-list" ref={scrollRef}>
            {rows
              ? rows.map((row, index) =>
                  renderRow(row, row.kind === 'header' ? row.letter : row.entry.id + index)
                )
              : filtered.map((entry) => renderRow({ kind: 'entry', entry }, entry.id))}
            <div style={{ height: 24 }} />
          </div>
          {showIndex ? (
            <AlphabetIndex present={presentLetters} onSelect={jumpToLetter} />
          ) : null}
        </div>
      )}

      {editing ? (
        <PasswordEditor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await savePasswordEntry(input)
            setEditing(null)
            toast('已保存')
          }}
        />
      ) : null}

      {detail ? (
        <PasswordDetailSheet
          key={detail.id}
          entry={detail}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setEditing(detail)
            setDetailId(null)
          }}
          onToggleFavorite={() =>
            void togglePasswordFavorite(detail.id, !detail.isFavorite)
          }
          onDelete={async () => {
            await deletePasswordEntry(detail.id)
            setDetailId(null)
            toast('已删除')
          }}
          onCopy={copyText}
          onToast={toast}
        />
      ) : null}

      {importOpen ? (
        <PasswordImportSheet
          onClose={() => setImportOpen(false)}
          onImported={async (count) => {
            setImportOpen(false)
            await reload()
            toast(`已导入 ${count} 条密码`)
          }}
        />
      ) : null}
    </div>
  )
}

function PasswordRow(props: {
  entry: PasswordEntryView
  onOpen(): void
  onToggleFavorite(): void
  onCopyPassword(): void
  onDelete(): void
  confirming: boolean
  onCancelDelete(): void
  onConfirmDelete(): void
}): JSX.Element {
  const { entry } = props
  return (
    <div className={`pwd-row${props.confirming ? ' confirming' : ''}`}>
      <button type="button" className="pwd-main" onClick={props.onOpen}>
        <span className="pwd-avatar">{entry.firstLetter || '#'}</span>
        <span className="pwd-text">
          <span className="pwd-title">{entry.title}</span>
          <span className="pwd-sub">{entry.url || '软件（无网址）'}</span>
        </span>
      </button>
      <div className="pwd-actions">
        <button
          type="button"
          className={`icon-btn${entry.isFavorite ? ' fav' : ''}`}
          aria-label={entry.isFavorite ? '取消常用' : '设为常用'}
          title={entry.isFavorite ? '取消常用' : '设为常用'}
          onClick={props.onToggleFavorite}
        >
          {entry.isFavorite ? '★' : '☆'}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="复制密码"
          title="复制密码"
          onClick={props.onCopyPassword}
        >
          ⧉
        </button>
        <button
          type="button"
          className="icon-btn danger"
          aria-label="删除"
          title="删除"
          onClick={props.onDelete}
        >
          ✕
        </button>
      </div>
      {props.confirming ? (
        <div className="pwd-confirm-row">
          确定删除「{entry.title}」吗？
          <button
            type="button"
            className="btn-ghost btn-danger"
            onClick={props.onConfirmDelete}
          >
            删除
          </button>
          <button type="button" className="btn-ghost" onClick={props.onCancelDelete}>
            取消
          </button>
        </div>
      ) : null}
    </div>
  )
}

function AlphabetIndex(props: {
  present: Set<string>
  onSelect(letter: string | null): void
}): JSX.Element {
  return (
    <div className="alphabet-index" role="navigation" aria-label="首字母索引">
      {ALPHABET.map((letter) => {
        const enabled = props.present.has(letter)
        return (
          <button
            key={letter}
            type="button"
            className={`alphabet-item${enabled ? '' : ' disabled'}`}
            disabled={!enabled}
            onClick={() => props.onSelect(enabled ? letter : null)}
          >
            {letter}
          </button>
        )
      })}
    </div>
  )
}

interface EditorInput {
  title: string
  url: string
  account: string
  password: string
  remark: string
}

/** 密码强度条：颜色随强度变化，并给出最要紧的一条改进建议 */
function StrengthBar({ password }: { password: string }): JSX.Element {
  const strength = passwordStrength(password)
  return (
    <div className="pwd-strength">
      <span className="pwd-strength-label">强度</span>
      <span className="pwd-strength-track" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={`pwd-strength-seg s${strength.score}${index < strength.score ? ' on' : ''}`}
          />
        ))}
      </span>
      <span className="pwd-strength-text">{strength.label}</span>
      {strength.hints.length > 0 ? (
        <span className="pwd-strength-hint">{strength.hints[0]}</span>
      ) : null}
    </div>
  )
}

function PasswordEditor(props: {
  initial: PasswordEntryView | null
  onClose(): void
  onSave(input: EditorInput & { id?: string }): Promise<void>
}): JSX.Element {
  const setUnsavedChanges = useAppStore((state) => state.setUnsavedChanges)
  const [form, setForm] = useState<EditorInput>(() => ({
    title: props.initial?.title ?? '',
    url: props.initial?.url ?? '',
    account: props.initial?.account ?? '',
    password: props.initial?.password ?? '',
    remark: props.initial?.remark ?? ''
  }))
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /** 生成密码的长度（12 ~ 32） */
  const [genLength, setGenLength] = useState(DEFAULT_PASSWORD_OPTIONS.length)
  const dirty = (Object.keys(form) as Array<keyof EditorInput>).some(
    (key) => form[key] !== (props.initial?.[key] ?? '')
  )

  useEffect(() => {
    setUnsavedChanges(dirty)
    return () => setUnsavedChanges(false)
  }, [dirty, setUnsavedChanges])

  const modalRef = useRef<HTMLDivElement>(null)
  useModalFocus(modalRef)
  useOverlayEscape(props.onClose)

  /** 生成一个随机密码填进输入框 */
  function generate(): void {
    try {
      const password = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: genLength })
      setForm({ ...form, password })
      setShowPassword(true)
      setError('')
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : '生成失败')
    }
  }

  async function submit(): Promise<void> {
    if (!form.title.trim()) {
      setError('名称不能为空')
      return
    }
    setSaving(true)
    setError('')
    try {
      await props.onSave({ ...form, id: props.initial?.id })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="overlay"
      ref={modalRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="密码编辑"
      onClick={props.onClose}
    >
      <div className="glass overlay-card" onClick={(event) => event.stopPropagation()}>
        <div className="overlay-head-row">
          <h3 className="panel-title">{props.initial ? '编辑条目' : '新增条目'}</h3>
        </div>

        {error ? (
          <div className="status-banner" role="alert">
            {error}
          </div>
        ) : null}

        {props.initial ? (
          <p className="field-hint">
            最近更新：
            {new Date(props.initial.updatedAtMs).toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </p>
        ) : null}

        <form
          className="settings-grid"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div>
            <label className="field-label" htmlFor="pwd-title">
              名称 *
            </label>
            <input
              id="pwd-title"
              className="field-input"
              value={form.title}
              data-autofocus
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="pwd-url">
              网址（软件类可留空）
            </label>
            <input
              id="pwd-url"
              className="field-input"
              type="url"
              value={form.url}
              onChange={(event) => setForm({ ...form, url: event.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="pwd-account">
              账号
            </label>
            <input
              id="pwd-account"
              className="field-input"
              value={form.account}
              onChange={(event) => setForm({ ...form, account: event.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="pwd-password">
              密码
            </label>
            <div className="input-with-action">
              <input
                id="pwd-password"
                className="field-input"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                autoComplete="new-password"
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
              <button
                type="button"
                className="btn-ghost"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? '隐藏' : '显示'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                aria-label="生成随机密码"
                onClick={generate}
              >
                生成
              </button>
            </div>

            <div className="pwd-gen-row">
              <label className="field-hint" htmlFor="pwd-gen-length">
                长度 {genLength}
              </label>
              <input
                id="pwd-gen-length"
                className="pwd-gen-slider"
                type="range"
                min={12}
                max={32}
                step={1}
                value={genLength}
                aria-label="生成密码的长度"
                onChange={(event) => setGenLength(Number(event.target.value))}
              />
            </div>

            {form.password ? <StrengthBar password={form.password} /> : null}
          </div>
          <div>
            <label className="field-label" htmlFor="pwd-remark">
              备注
            </label>
            <textarea
              id="pwd-remark"
              className="field-input field-textarea"
              rows={3}
              value={form.remark}
              onChange={(event) => setForm({ ...form, remark: event.target.value })}
            />
          </div>
          <div className="overlay-actions">
            <button type="button" className="btn-ghost" onClick={props.onClose}>
              取消
            </button>
            <button type="submit" className="btn-gold" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function PasswordDetailSheet(props: {
  entry: PasswordEntryView
  onClose(): void
  onEdit(): void
  onToggleFavorite(): void
  onDelete(): void
  onCopy(text: string): Promise<void>
  onToast(message: string): void
}): JSX.Element {
  const { entry } = props
  const [showPassword, setShowPassword] = useState(false)

  const modalRef = useRef<HTMLDivElement>(null)
  useModalFocus(modalRef)
  useOverlayEscape(props.onClose)

  async function copy(label: string, value: string): Promise<void> {
    if (!value) return
    await props.onCopy(value)
    props.onToast(`已复制${label}`)
  }

  return (
    <div
      className="overlay"
      ref={modalRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="条目详情"
      onClick={props.onClose}
    >
      <div className="glass overlay-card" onClick={(event) => event.stopPropagation()}>
        <div className="overlay-head-row">
          <h3 className="panel-title">{entry.title}</h3>
          <button
            type="button"
            className={`icon-btn${entry.isFavorite ? ' fav' : ''}`}
            aria-label={entry.isFavorite ? '取消常用' : '设为常用'}
            onClick={props.onToggleFavorite}
          >
            {entry.isFavorite ? '★' : '☆'}
          </button>
        </div>

        {!entry.isDecryptable ? (
          <div className="status-banner" role="alert">
            该条目解密失败：密钥不可用或数据损坏（主密钥绑定本机）
          </div>
        ) : null}

        <DetailField label="名称" value={entry.title} />
        {entry.url ? (
          <DetailField
            label="URL"
            value={entry.url}
            onCopy={() => void copy('URL', entry.url)}
          />
        ) : null}
        <DetailField
          label="账号"
          value={entry.account}
          onCopy={() => void copy('账号', entry.account)}
        />

        <div className="field-block">
          <div className="field-row-head">
            <span className="field-label" style={{ marginBottom: 0 }}>
              密码
            </span>
            <div className="toolbar-row" style={{ gap: 6 }}>
              {entry.password ? (
                <>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? '隐藏' : '显示'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void copy('密码', entry.password)}
                  >
                    复制
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="field-value mono">
            {entry.password
              ? showPassword
                ? entry.password
                : '•'.repeat(entry.password.length)
              : '（空）'}
          </div>
        </div>

        <DetailField label="备注" value={entry.remark} />

        <div className="overlay-actions">
          <button
            type="button"
            className="btn-ghost btn-danger"
            onClick={async () => {
              if (await confirmDialog(`确定删除「${entry.title}」吗？该操作不可恢复。`)) {
                void props.onDelete()
              }
            }}
          >
            删除
          </button>
          <div className="toolbar-grow" />
          <button type="button" className="btn-ghost" onClick={props.onClose}>
            关闭
          </button>
          <button type="button" className="btn-gold" onClick={props.onEdit}>
            编辑
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailField(props: {
  label: string
  value: string
  onCopy?: () => void
}): JSX.Element {
  return (
    <div className="field-block">
      <div className="field-row-head">
        <span className="field-label" style={{ marginBottom: 0 }}>
          {props.label}
        </span>
        {props.value && props.onCopy ? (
          <button type="button" className="btn-ghost" onClick={props.onCopy}>
            复制
          </button>
        ) : null}
      </div>
      <div className="field-value">{props.value || '（空）'}</div>
    </div>
  )
}
