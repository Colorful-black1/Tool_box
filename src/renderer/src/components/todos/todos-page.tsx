import { confirmDialog } from '../../stores/dialog-store'
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { TodoFilter, TodoInput, TodoView } from '@shared/types'
import { zonedDateTimeToMs } from '@shared/timezone-tools'
import { useTodoStore } from '../../stores/todo-store'
import { Dropdown } from '../dropdown'
import { DatePicker } from '../date-picker'

const FILTERS = [
  { value: 'all', label: '未完成' },
  { value: 'today', label: '今日' },
  { value: 'upcoming', label: '待开始' },
  { value: 'overdue', label: '已逾期' },
  { value: 'completed', label: '已完成' },
  { value: 'archived', label: '已归档' }
]
const PRIORITIES = [
  { value: 'high', label: '高优先级' },
  { value: 'normal', label: '普通优先级' },
  { value: 'low', label: '低优先级' }
]

function localInput(ms: number | null): string {
  if (ms === null) return ''
  const date = new Date(ms)
  return new Date(ms - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function dateLabel(ms: number | null): string {
  return ms === null
    ? '未设置'
    : new Date(ms).toLocaleString('zh-CN', {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
}

/** 快速新增与列表相邻；草稿保存在 store，切换页面不丢输入。 */
export function TodosPage(): JSX.Element {
  const items = useTodoStore((state) => state.items)
  const total = useTodoStore((state) => state.total)
  const query = useTodoStore((state) => state.query)
  const draft = useTodoStore((state) => state.draft)
  const dirty = useTodoStore((state) => state.dirty)
  const busy = useTodoStore((state) => state.busy)
  const loading = useTodoStore((state) => state.loading)
  const error = useTodoStore((state) => state.error)
  const notificationStatus = useTodoStore((state) => state.notificationStatus)
  const focusId = useTodoStore((state) => state.focusId)
  const setDraft = useTodoStore((state) => state.setDraft)
  const load = useTodoStore((state) => state.load)
  const [notificationMessage, setNotificationMessage] = useState('')
  const [testing, setTesting] = useState(false)
  const [dateError, setDateError] = useState('')
  const [invalidDates, setInvalidDates] = useState({ start: false, due: false })
  const [dateRevision, setDateRevision] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!focusId) return
    const element = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[data-todo-id]') ?? [])
    ].find((node) => node.dataset.todoId === focusId)
    element?.scrollIntoView({ block: 'nearest' })
    element?.focus()
  }, [focusId, items])
  const edit = async (item?: TodoView): Promise<void> => {
    if (
      (dirty || invalidDates.start || invalidDates.due) &&
      !(await confirmDialog('有尚未保存的待办输入，是否放弃并继续？'))
    )
      return
    useTodoStore.getState().edit(item)
    setDateError('')
    setInvalidDates({ start: false, due: false })
    setDateRevision((revision) => revision + 1)
  }
  const date = (key: 'startAtMs' | 'dueAtMs', value: string): void => {
    try {
      const ms = value
        ? zonedDateTimeToMs(value, Intl.DateTimeFormat().resolvedOptions().timeZone)
        : null
      setDraft({ [key]: ms })
      setDateError('')
    } catch (cause) {
      setDateError(
        cause instanceof Error
          ? cause.message.replace('请选择较早或较晚时刻', '请改用非重复时间')
          : '日期时间无效'
      )
    }
  }
  return (
    <div className="todo-page view-enter">
      <div className="todo-heading">
        <p className="field-hint">开始与截止各提醒一次；应用须运行或驻留托盘，重启会合并补提醒。</p>
        <button
          type="button"
          className="btn-ghost"
          disabled={testing || !window.toolbox?.todos}
          onClick={() => {
            setTesting(true)
            setNotificationMessage('')
            void window.toolbox.todos
              .testNotification()
              .then(() =>
                setNotificationMessage(
                  '系统已确认显示测试通知；若未看到，请检查通知中心或免打扰设置'
                )
              )
              .catch(() => setNotificationMessage('测试通知未能显示，请检查 Windows 通知设置'))
              .finally(() => setTesting(false))
          }}
        >
          {testing ? '测试中…' : '测试通知'}
        </button>
      </div>
      {notificationStatus || notificationMessage ? (
        <p className="status-banner" role="status">
          {notificationStatus || notificationMessage}
        </p>
      ) : null}
      {error ? (
        <p className="status-banner" role="alert">
          {error}
          <button type="button" className="btn-ghost" onClick={() => void load()}>
            重试读取
          </button>
        </p>
      ) : null}
      {dateError ? (
        <p className="status-banner" role="alert">
          {dateError}
        </p>
      ) : null}
      <div className="todo-layout">
        <form
          className="todo-editor tool-io"
          onSubmit={(event) => {
            event.preventDefault()
            void useTodoStore.getState().save()
          }}
        >
          <h2 className="tool-io-label">{draft.id ? '编辑待办' : '新建待办'}</h2>
          <label className="field-label">
            标题
            <input
              className="field-input"
              aria-label="待办标题"
              value={draft.title}
              required
              maxLength={120}
              disabled={busy}
              onChange={(event) => setDraft({ title: event.target.value })}
              placeholder="下一件要做的事"
            />
          </label>
          <label className="field-label">
            备注
            <textarea
              className="field-input field-textarea"
              aria-label="待办备注"
              value={draft.details}
              maxLength={4000}
              disabled={busy}
              onChange={(event) => setDraft({ details: event.target.value })}
              rows={3}
            />
          </label>
          <Dropdown
            ariaLabel="待办优先级"
            value={draft.priority}
            options={PRIORITIES}
            disabled={busy}
            onChange={(priority) => setDraft({ priority: priority as TodoInput['priority'] })}
          />
          <div className="field-label">
            开始时间
            <DatePicker
              key={`start-${dateRevision}-${draft.id ?? 'new'}`}
              label="待办开始时间"
              withTime
              min="1970-01-01T00:00"
              max="9999-12-31T23:59"
              value={localInput(draft.startAtMs)}
              disabled={busy}
              onValidityChange={(valid) =>
                setInvalidDates((state) => ({ ...state, start: !valid }))
              }
              onChange={(value) => date('startAtMs', value)}
            />
          </div>
          <div className="field-label">
            截止时间
            <DatePicker
              key={`due-${dateRevision}-${draft.id ?? 'new'}`}
              label="待办截止时间"
              withTime
              min="1970-01-01T00:00"
              max="9999-12-31T23:59"
              value={localInput(draft.dueAtMs)}
              disabled={busy}
              onValidityChange={(valid) => setInvalidDates((state) => ({ ...state, due: !valid }))}
              onChange={(value) => date('dueAtMs', value)}
            />
          </div>
          <label className="tool-check">
            <input
              type="checkbox"
              checked={draft.remind}
              disabled={busy}
              onChange={(event) => setDraft({ remind: event.target.checked })}
            />
            开始／截止时通知我
          </label>
          <p className="field-hint">
            日期时间按本机时区。不设置时间则不提醒。普通本地存储，请勿填写密码。
          </p>
          <div className="tool-controls">
            <button
              type="submit"
              className="btn-gold"
              disabled={
                busy || !draft.title.trim() || !!dateError || invalidDates.start || invalidDates.due
              }
            >
              {busy ? '保存中…' : draft.id ? '保存修改' : '添加待办'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy || (!dirty && !draft.id)}
              onClick={() => edit()}
            >
              清空／新建
            </button>
          </div>
          {dirty ? (
            <p className="field-hint">尚未保存；切换页面会保留本次输入，退出应用前请保存。</p>
          ) : null}
        </form>
        <section className="todo-list-section" aria-label="待办列表" aria-busy={loading}>
          {focusId ? (
            <div className="status-banner" role="status">
              正在查看通知对应的待办
              <button
                type="button"
                className="btn-ghost"
                onClick={() => useTodoStore.getState().setQuery({})}
              >
                返回完整列表
              </button>
            </div>
          ) : null}
          <div className="tool-controls">
            <Dropdown
              ariaLabel="待办筛选"
              value={query.filter}
              options={FILTERS}
              onChange={(filter) =>
                useTodoStore.getState().setQuery({ filter: filter as TodoFilter })
              }
            />
            <input
              className="field-input todo-search"
              aria-label="搜索待办"
              placeholder="搜索标题或备注"
              value={query.search}
              maxLength={120}
              onChange={(event) => useTodoStore.getState().setQuery({ search: event.target.value })}
            />
            <button
              type="button"
              className="btn-ghost"
              disabled={loading}
              onClick={() => void load()}
            >
              刷新
            </button>
          </div>
          <div className="todo-list" ref={listRef}>
            {!items.length ? (
              <p className="field-hint">
                {loading ? '正在读取…' : '这里还没有待办，写下下一件事吧。'}
              </p>
            ) : (
              items.map((item) => (
                <article
                  className={`todo-card${focusId === item.id ? ' highlighted' : ''}${item.completedAtMs !== null ? ' completed' : ''}`}
                  data-todo-id={item.id}
                  tabIndex={-1}
                  key={item.id}
                >
                  <div className="todo-card-title">
                    <label className="tool-check">
                      <input
                        aria-label={`完成 ${item.title}`}
                        type="checkbox"
                        checked={item.completedAtMs !== null}
                        disabled={busy || item.archivedAtMs !== null}
                        onChange={(event) =>
                          void useTodoStore.getState().complete(item.id, event.target.checked)
                        }
                      />
                      <strong>{item.title}</strong>
                    </label>
                    <span className="field-hint">
                      {PRIORITIES.find((priority) => priority.value === item.priority)?.label}
                    </span>
                  </div>
                  {item.details ? <p className="todo-details">{item.details}</p> : null}
                  <p className="field-hint">
                    开始：{dateLabel(item.startAtMs)}
                    <br />
                    截止：{dateLabel(item.dueAtMs)}
                    {!item.remind ? ' · 提醒已关闭' : ''}
                  </p>
                  <div className="tool-controls">
                    <button
                      type="button"
                      className="btn-ghost btn-mini"
                      disabled={busy}
                      onClick={() => edit(item)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-mini"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          item.archivedAtMs === null &&
                          !(await confirmDialog(
                            `归档「${item.title}」？归档后停止提醒，可在已归档中恢复。`
                          ))
                        )
                          return
                        void useTodoStore.getState().archive(item.id, item.archivedAtMs === null)
                      }}
                    >
                      {item.archivedAtMs === null ? '归档' : '恢复'}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
          <div className="tool-controls">
            <span className="field-hint">
              共 {total} 项 · 第 {Math.floor(query.offset / query.limit) + 1} 页
            </span>
            <button
              type="button"
              className="btn-ghost"
              disabled={loading || query.offset === 0}
              onClick={() =>
                useTodoStore
                  .getState()
                  .setQuery({ offset: Math.max(0, query.offset - query.limit) })
              }
            >
              上一页
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={loading || query.offset + query.limit >= total}
              onClick={() =>
                useTodoStore.getState().setQuery({ offset: query.offset + query.limit })
              }
            >
              下一页
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
