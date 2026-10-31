import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { useDialogStore } from '../stores/dialog-store'
import { useModalFocus } from '../lib/use-modal-focus'
import { useOverlayEscape } from '../lib/use-overlay-dismiss'

function DialogContent(): JSX.Element | null {
  const request = useDialogStore((state) => state.request)
  const answer = useDialogStore((state) => state.answer)
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState('')
  // 弹层挂载时焦点还在触发它的控件上；关闭后还回去，键盘用户不必从头 Tab。
  // （触发控件可能随操作一起消失，例如删除某一行，此时焦点保持默认行为。）
  const [restoreTo] = useState<HTMLElement | null>(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  )
  useModalFocus(ref, true, true)
  useOverlayEscape(() => answer(null))
  useEffect(() => {
    return () => {
      if (restoreTo?.isConnected) restoreTo.focus()
    }
  }, [restoreTo])
  if (!request) return null
  return createPortal(
    <div
      className="app-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) answer(null)
      }}
    >
      <div
        className="app-dialog"
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        aria-describedby="app-dialog-message"
        data-app-dialog
      >
        <h2>{request.title}</h2>
        <p id="app-dialog-message">{request.message}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!request.maxLength || value.trim()) answer(request.maxLength ? value.trim() : '')
          }}
        >
          {request.maxLength ? (
            <input
              className="field-input"
              aria-label="输入内容"
              maxLength={request.maxLength}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              data-autofocus
            />
          ) : null}
          <div className="overlay-actions">
            <button type="button" className="btn-ghost" onClick={() => answer(null)}>
              取消
            </button>
            <button
              type="submit"
              className={request.danger ? 'btn-ghost btn-danger' : 'btn-gold'}
              disabled={!!request.maxLength && !value.trim()}
            >
              确认
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

/** App 中唯一挂载点，窗口卸载会取消未完成的业务确认。 */
export function AppDialog(): JSX.Element | null {
  const request = useDialogStore((state) => state.request)
  useEffect(() => () => useDialogStore.getState().answer(null), [])
  return request ? <DialogContent /> : null
}
