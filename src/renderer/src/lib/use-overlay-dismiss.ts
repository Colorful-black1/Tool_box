import { useEffect, useRef } from 'react'
import { pushOverlay } from './overlay-stack'

/**
 * 弹层 Esc 关闭 hook：挂载即监听，卸载自动清理。
 * 用于条件渲染的弹层组件（条件成立时组件挂载 → 监听生效）。
 *
 * 注意：弹层内有输入框时 Esc 关闭会丢失未保存草稿，
 * 属于桌面应用惯例（快速退出），调用方需自行权衡。
 */
export function useOverlayEscape(onClose: () => void, enabled = true): void {
  const callback = useRef(onClose)
  useEffect(() => {
    callback.current = onClose
  }, [onClose])
  useEffect(() => {
    if (!enabled) return
    const layer = pushOverlay()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && layer.top() && !event.defaultPrevented) {
        event.preventDefault()
        event.stopPropagation()
        callback.current()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      layer.dispose()
      document.removeEventListener('keydown', onKey, true)
    }
  }, [enabled])
}
