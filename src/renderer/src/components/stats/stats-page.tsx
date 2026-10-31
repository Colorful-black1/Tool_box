import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { useAppStore } from '../../stores/app-store'

interface Props {
  onOpenBook(bookId: string): void
  onOpenShelf(): void
}

interface Summary {
  todayDurationMs: number
  totalDurationMs: number
  totalCharCount: number
  recent: Array<{ date: string; durationMs: number; charCount: number }>
}

/** 阅读统计页，对应旧项目 stats_page.dart */
export function StatsPage({ onOpenBook, onOpenShelf }: Props): JSX.Element {
  const books = useAppStore((state) => state.books)
  const refreshBooks = useAppStore((state) => state.refreshBooks)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      if (!window.toolbox) throw new Error('本地桥接未就绪')
      setSummary(await window.toolbox.stats.summary())
      await refreshBooks()
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="view-enter">
        <div className="loading-skeleton" />
        <div className="loading-skeleton" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="view-enter message-empty">
        <div>
          <p className="empty-text">加载失败：{error}</p>
          <button type="button" className="btn-ghost" onClick={() => void load()}>
            重试
          </button>
        </div>
      </div>
    )
  }

  const totalBooks = books.length
  const startedBooks = books.filter((book) => book.progress).length
  const recent = summary?.recent ?? []

  return (
    <div className="view-enter stats-page">
      <div className="toolbar-row">
        <h2 className="sec-title">阅读统计</h2>
        <div className="toolbar-grow" />
        <button type="button" className="btn-ghost" onClick={() => void load()}>
          刷新
        </button>
      </div>

      <div className="stat-grid">
        <div className="glass stat-card">
          <div className="stat-num" style={{ color: 'var(--cyan)' }}>
            {formatDuration(summary?.todayDurationMs ?? 0)}
          </div>
          <div className="stat-label">今日时长</div>
        </div>
        <div className="glass stat-card">
          <div className="stat-num" style={{ color: 'var(--success)' }}>
            {formatDuration(summary?.totalDurationMs ?? 0)}
          </div>
          <div className="stat-label">累计时长</div>
        </div>
        <div className="glass stat-card">
          <div className="stat-num" style={{ color: 'var(--gold)' }}>
            {formatCount(summary?.totalCharCount ?? 0)}
          </div>
          <div className="stat-label">累计字数</div>
        </div>
      </div>

      <div className="sec-head stats-section-head">
        <div className="sec-title">书库概况</div>
      </div>
      <div className="stat-grid">
        <div className="glass stat-card">
          <div className="stat-num">{totalBooks}</div>
          <div className="stat-label">在架藏书</div>
        </div>
        <div className="glass stat-card">
          <div className="stat-num">{startedBooks}</div>
          <div className="stat-label">已开读</div>
        </div>
      </div>

      {recent.length > 0 ? (
        <>
          <div className="sec-head stats-section-head">
            <div className="sec-title">近 {recent.length} 天</div>
          </div>
          <div className="glass stats-list">
            {recent.map((item) => (
              <div key={item.date} className="stats-row">
                <span className="stats-date">{item.date.slice(5)}</span>
                <span className="stats-duration">{formatDuration(item.durationMs)}</span>
                <span className="stats-chars">{formatCount(item.charCount)} 字</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="message-empty">
          <p className="empty-title">{books.length ? '还没有阅读记录' : '书架还是空的'}</p>
          <p className="empty-text">
            {books.length
              ? '打开一本书开始阅读，这里会自动记录时长与进度。'
              : '先导入一本 TXT 小说，阅读后这里会记录时长与进度。'}
          </p>
          <button type="button" className="btn-gold" onClick={onOpenShelf}>
            {books.length ? '去书架' : '去书架导入'}
          </button>
        </div>
      )}

      {books.some((book) => book.progress) ? (
        <>
          <div className="sec-head stats-section-head">
            <div className="sec-title">继续阅读</div>
          </div>
          <div className="glass stats-list">
            {books
              .filter((book) => book.progress)
              .slice(0, 5)
              .map((book) => (
                <button
                  key={book.id}
                  type="button"
                  className="stats-row clickable"
                  onClick={() => onOpenBook(book.id)}
                >
                  <span className="stats-book-title">{book.title}</span>
                  <span className="stats-duration">
                    第 {(book.progress?.chapterIdx ?? 0) + 1} 章
                  </span>
                  <span className="stats-chars">
                    {Math.round((book.progress?.percent ?? 0) * 100)}%
                  </span>
                </button>
              ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

/** >=1h → X小时Y分；>=1m → Y分Z秒；否则 Z秒 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    return `${hours}小时${minutes}分`
  }
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}分${seconds}秒`
  }
  return `${totalSeconds}秒`
}

/** >=10000 → X.X万 */
export function formatCount(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`
  return String(value)
}
