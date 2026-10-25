import { useLayoutEffect, useRef, useState } from 'react'
import type { JSX, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayEscape } from '../lib/use-overlay-dismiss'
import { MODAL_OPEN_EVENT } from '../lib/use-modal-focus'

/** 浮层与触发点的定位及生命周期约定。 */
interface PopoverProps {
  anchor: RefObject<HTMLElement | null>
  children: ReactNode
  onClose(): void
  onReady?(): void
  align?: 'left' | 'right'
  className?: string
  maxPanelHeight?: number
}

/** Portal 浮层统一处理滚动、窗口边界和外部点击，不被父容器裁切。 */
export function Popover({
  anchor,
  children,
  onClose,
  onReady,
  align = 'left',
  className = '',
  maxPanelHeight = 400
}: PopoverProps): JSX.Element {
  const panel = useRef<HTMLDivElement>(null)
  const initialFocus = useRef(onReady)
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    maxHeight: 320,
    minWidth: 0,
    ready: false
  })
  useOverlayEscape(() => {
    onClose()
    anchor.current?.focus()
  })
  useLayoutEffect(() => {
    if (position.ready) initialFocus.current?.()
  }, [position.ready])
  useLayoutEffect(() => {
    const update = (): void => {
      const trigger = anchor.current,
        element = panel.current
      if (!trigger || !element) return
      const rect = trigger.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      const below = innerHeight - rect.bottom - 14,
        above = rect.top - 14
      const flip = below < box.height && above > below
      const maxHeight = Math.max(80, Math.min(maxPanelHeight, flip ? above : below))
      const left = Math.max(
        8,
        Math.min(align === 'right' ? rect.right - box.width : rect.left, innerWidth - box.width - 8)
      )
      const top = flip
        ? Math.max(8, rect.top - Math.min(box.height, maxHeight) - 6)
        : rect.bottom + 6
      setPosition({
        top,
        left,
        maxHeight,
        minWidth: Math.min(rect.width, innerWidth - 16),
        ready: true
      })
    }
    const outside = (event: PointerEvent): void => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !anchor.current?.contains(event.target as Node)
      )
        onClose()
    }
    const modalOpened = (event: Event): void => {
      if (
        event instanceof CustomEvent &&
        event.detail instanceof HTMLElement &&
        !event.detail.contains(anchor.current)
      )
        onClose()
    }
    update()
    const observer = new ResizeObserver(update)
    if (panel.current) observer.observe(panel.current)
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener(MODAL_OPEN_EVENT, modalOpened)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener(MODAL_OPEN_EVENT, modalOpened)
    }
  }, [anchor, align, onClose, maxPanelHeight])
  const owner = anchor.current?.closest('[data-modal-owner]')?.getAttribute('data-modal-owner')
  return createPortal(
    <div
      ref={panel}
      className={`ui-popover ${className}`}
      data-overlay-owner={owner ?? undefined}
      style={{
        top: position.top,
        left: position.left,
        maxHeight: position.maxHeight,
        minWidth: position.minWidth,
        visibility: position.ready ? 'visible' : 'hidden'
      }}
    >
      {children}
    </div>,
    document.body
  )
}
