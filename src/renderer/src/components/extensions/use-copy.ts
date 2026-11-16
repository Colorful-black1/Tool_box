import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 复制到剪贴板并短暂回显「已复制」。
 *
 * key 用来区分同一页面上的多个复制按钮；`window.toolbox` 未就绪时静默失败，
 * 由调用方决定是否提示。
 */
export function useCopy(): {
  copied: string
  copy: (key: string, text: string) => void
} {
  const [copied, setCopied] = useState('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current)
    },
    []
  )

  const copy = useCallback((key: string, text: string) => {
    const bridge = window.toolbox?.system
    if (!bridge?.copyText) return
    void bridge
      .copyText(text)
      .then(() => {
        setCopied(key)
        if (timer.current !== undefined) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(''), 1600)
      })
      .catch(() => setCopied(''))
  }, [])

  return { copied, copy }
}
