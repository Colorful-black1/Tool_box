import { useState } from 'react'
import type { CSSProperties, JSX } from 'react'

import type { ReaderTheme } from '../../../../shared/types'

/**
 * 主题色 → 半透明遮罩：菜单浮层保留主题色调但透出正文，
 * 保证浅色主题（纸白/米黄等）下按钮对比度的同时不形成生硬色块。
 */
function themeScrim(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return `rgba(26, 26, 26, ${alpha})`
  const value = Number.parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface ReaderMenuProps {
  visible: boolean
  title: string
  theme: ReaderTheme
  chapterTitle: string
  chapterIdx: number
  chapterCount: number
  pageIdx: number
  pageCount: number
  percent: number
  bookmarked: boolean
  onBack(): void
  onOpenToc(): void
  onOpenSearch(): void
  onOpenSettings(): void
  onToggleBookmark(): void
  onPrevChapter(): void
  onNextChapter(): void
  onSeek(ratio: number): void
}

/** 阅读器悬浮菜单浮层，对应旧项目 reader_menu.dart */
export function ReaderMenu(props: ReaderMenuProps): JSX.Element {
  const { visible, theme } = props
  const [seeking, setSeeking] = useState(false)
  const [dragValue, setDragValue] = useState(props.percent)

  const chapterLabel =
    props.pageCount > 1
      ? `第 ${props.chapterIdx + 1}/${props.chapterCount} 章 · 第 ${props.pageIdx + 1}/${props.pageCount} 页`
      : `第 ${props.chapterIdx + 1}/${props.chapterCount} 章`

  const ratioLabel = seeking
    ? `第${props.chapterIdx + 1}章 ${props.chapterTitle} · ${(dragValue * 100).toFixed(1)}%`
    : `全书 ${(props.percent * 100).toFixed(1)}%`

  const commit = (): void => {
    props.onSeek(dragValue)
    setSeeking(false)
  }

  const layerStyle = {
    background: themeScrim(theme.background, 0.86),
    color: theme.foreground
  } satisfies CSSProperties

  return (
    <div className={`reader-menu-layer${visible ? ' show' : ''}`} style={layerStyle}>
      <div className="reader-topbar">
        <button
          type="button"
          className="reader-icon-btn"
          aria-label="返回书架"
          onClick={props.onBack}
        >
          ←
        </button>
        <span className="reader-book-title">{props.title}</span>
        <div className="reader-topbar-actions">
          <button
            type="button"
            className="reader-icon-btn"
            aria-label="书内搜索"
            onClick={props.onOpenSearch}
          >
            🔍
          </button>
          <button
            type="button"
            className="reader-icon-btn"
            aria-label="目录"
            onClick={props.onOpenToc}
          >
            ☰
          </button>
          <button
            type="button"
            className="reader-icon-btn"
            aria-label="阅读设置"
            onClick={props.onOpenSettings}
          >
            Aa
          </button>
        </div>
      </div>

      <div className="reader-menu-body">
        <div className="reader-chapter-header">{props.chapterTitle}</div>

        <div className="reader-meta-row">
          <span className="reader-page-label">{chapterLabel}</span>
          <span className="reader-menu-hint">M 收起 / 唤出菜单</span>
          <button type="button" className="reader-link-btn" onClick={props.onOpenSettings}>
            阅读设置
          </button>
        </div>

        <div className="reader-seek">
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(dragValue * 1000)}
            aria-label="全书进度"
            onChange={(event) => {
              setSeeking(true)
              setDragValue(Number(event.target.value) / 1000)
            }}
            onMouseUp={commit}
            onTouchEnd={commit}
            onKeyUp={(event) => {
              if (
                event.key === 'Enter' ||
                event.key === 'ArrowLeft' ||
                event.key === 'ArrowRight'
              ) {
                commit()
              }
            }}
          />
          <span className="reader-ratio-label">{ratioLabel}</span>
        </div>

        <div className="reader-actions">
          <button
            type="button"
            className={`reader-action-btn${props.bookmarked ? ' active' : ''}`}
            onClick={props.onToggleBookmark}
          >
            {props.bookmarked ? '★ 已收藏' : '☆ 书签'}
          </button>
          <div className="reader-grow" />
          <button
            type="button"
            className="reader-action-btn"
            disabled={props.chapterIdx <= 0}
            onClick={props.onPrevChapter}
          >
            上一章
          </button>
          <button
            type="button"
            className="reader-action-btn"
            disabled={props.chapterIdx >= props.chapterCount - 1}
            onClick={props.onNextChapter}
          >
            下一章
          </button>
        </div>
      </div>
    </div>
  )
}