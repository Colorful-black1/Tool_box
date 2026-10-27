/**
 * 会随内容自动长高的文本域。
 *
 * 工具箱里的输入输出经常是长 JSON、长日志 —— 固定高度根本看不全，
 * 还得在框里拖着滚动条看。这里让文本域跟着内容长高：
 * 短内容不浪费空间，长内容自动撑开，超过上限后才改为内部滚动。
 */
import { useLayoutEffect, useRef } from 'react'
import type { JSX, KeyboardEvent } from 'react'

/** 超过这个长度就不自动算高度了，避免超大文本每次输入都触发重排 */
const MAX_AUTO_HEIGHT_CHARS = 200_000

/** 输入框底边至少留出的窗口空间，避免文本域长到窗口外面去。 */
const VIEWPORT_MARGIN = 24

export interface AutoTextareaProps {
  value: string
  onChange?: (value: string) => void
  className?: string
  placeholder?: string
  readOnly?: boolean
  /** 内容为空时的最小高度（像素） */
  minHeight?: number
  /** 最大高度（像素），超过后文本域内部滚动；留空按视口高度算 */
  maxHeight?: number
  spellCheck?: boolean
  ariaLabel?: string
  /** 长文本自动换行（关掉时保持原始换行，长行横向滚动） */
  wrap?: boolean
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

/**
 * 量一段文本在给定宽度下需要多高（像素）。
 *
 * 不能直接读 textarea 的 `scrollHeight`：它会被 textarea 自身的
 * min-height / 固定高度夹住，量出来的是**盒子高度**而不是内容高度
 * （短文本会被撑到 min-height，看起来"怎么量都是那么高"）。
 * 这里用一个同样宽度与字体的隐藏 div 复制文本，量它的真实高度。
 */
function measureContent(element: HTMLTextAreaElement, value: string, wrap: boolean): number {
  if (!value) return 0
  const style = getComputedStyle(element)
  const mirror = document.createElement('div')
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.top = '0'
  mirror.style.left = '-9999px'
  mirror.style.width = `${element.clientWidth}px`
  mirror.style.fontFamily = style.fontFamily
  mirror.style.fontSize = style.fontSize
  mirror.style.fontWeight = style.fontWeight
  mirror.style.lineHeight = style.lineHeight
  mirror.style.letterSpacing = style.letterSpacing
  mirror.style.padding = style.padding
  mirror.style.borderWidth = style.borderWidth
  mirror.style.borderStyle = style.borderStyle
  mirror.style.boxSizing = 'border-box'
  mirror.style.whiteSpace = wrap ? 'pre-wrap' : 'pre'
  mirror.style.overflowWrap = wrap ? 'anywhere' : 'normal'
  mirror.textContent = value
  document.body.appendChild(mirror)
  const height = mirror.scrollHeight
  mirror.remove()
  return height
}

/**
 * 文本域最多长到「当前视口还能看见」的高度；超过后交给内部滚动。
 * 窄屏下输出区可能位于首屏之外，可用高度不足时保留原上限。
 */
function heightLimit(element: HTMLTextAreaElement, preferred: number, minHeight: number): number {
  const top = element.getBoundingClientRect().top
  if (top < 0) return preferred
  const available = Math.round(window.innerHeight - top - VIEWPORT_MARGIN)
  if (available < minHeight * 2) return preferred
  return Math.max(minHeight, Math.min(preferred, available))
}

export function AutoTextarea({
  value,
  onChange,
  className = '',
  placeholder,
  readOnly = false,
  minHeight = 140,
  maxHeight,
  spellCheck = false,
  ariaLabel,
  wrap = true,
  onKeyDown
}: AutoTextareaProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const preferred = maxHeight ?? Math.round(window.innerHeight * 0.7)
    const limit = heightLimit(element, preferred, minHeight)
    if (value.length > MAX_AUTO_HEIGHT_CHARS) {
      // 超大文本：交给内部滚动，别再每输入一个字就重排一次
      element.style.minHeight = `${minHeight}px`
      element.style.height = `${limit}px`
      element.style.overflowY = 'auto'
      return
    }
    const content = measureContent(element, value, wrap)
    const next = Math.min(Math.max(content, minHeight), limit)
    element.style.minHeight = `${minHeight}px`
    element.style.height = `${next}px`
    // 交给浏览器判断是否需要滚动条；测量与实际折行就算有 1px 误差也不会裁掉内容。
    element.style.overflowY = 'auto'
  }, [value, minHeight, maxHeight, wrap])

  return (
    <textarea
      ref={ref}
      className={`${className}${wrap ? ' tool-wrap' : ''}`.trim()}
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      spellCheck={spellCheck}
      aria-label={ariaLabel}
      wrap={wrap ? 'soft' : 'off'}
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={onKeyDown}
    />
  )
}
