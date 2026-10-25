import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
const modals: HTMLElement[] = []
export const MODAL_OPEN_EVENT = 'toolbox-modal-open'

/** 模态焦点范围包含标明归属的 portal，下拉关闭后回到原控件。 */
export function useModalFocus(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
  inertBackground = false
): void {
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || !enabled) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const inactive = inertBackground
      ? [...document.body.children].filter(
          (node): node is HTMLElement => node instanceof HTMLElement && !node.contains(root)
        )
      : []
    const wasInert = inactive.map((node) => node.inert)
    inactive.forEach((node) => {
      node.inert = true
    })
    const owner = root.dataset.modalOwner ?? `modal-${crypto.randomUUID()}`
    root.dataset.modalOwner = owner
    modals.push(root)
    document.dispatchEvent(new CustomEvent(MODAL_OPEN_EVENT, { detail: root }))
    const top = (): boolean => modals[modals.length - 1] === root
    const inside = (node: Node | null): boolean =>
      root.contains(node) ||
      (node instanceof Element &&
        node.closest('[data-overlay-owner]')?.getAttribute('data-overlay-owner') === owner)
    const elements = (): HTMLElement[] =>
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.getClientRects().length > 0 && !element.closest('[inert]')
      )
    if (!inside(document.activeElement))
      (root.querySelector<HTMLElement>('[data-autofocus]') ?? elements()[0] ?? root).focus()
    const onFocus = (event: FocusEvent): void => {
      if (!top()) return
      if (!inside(event.target as Node)) (elements()[0] ?? root).focus()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (
        !top() ||
        event.key !== 'Tab' ||
        document.querySelector(`[data-overlay-owner="${owner}"]`)
      )
        return
      const items = elements()
      const first = items[0],
        last = items[items.length - 1]
      if (!first) {
        event.preventDefault()
        root.focus()
      } else if (
        event.shiftKey &&
        (document.activeElement === first || !inside(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('focusin', onFocus)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('keydown', onKey)
      modals.splice(modals.indexOf(root), 1)
      inactive.forEach((node, index) => {
        node.inert = wasInert[index]
      })
      if (previous?.isConnected) previous.focus()
    }
  }, [ref, enabled, inertBackground])
}
