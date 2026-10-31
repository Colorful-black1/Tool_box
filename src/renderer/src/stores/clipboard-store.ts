import { create } from 'zustand'
import type { ClipboardHistorySnapshot } from '../../../shared/clipboard'

/** 历史只在内存中，页面关闭不影响采集；应用退出自然清空。 */
export const useClipboardStore = create<{
  open: boolean
  snapshot: ClipboardHistorySnapshot | null
  setOpen(open: boolean): void
  receive(snapshot: ClipboardHistorySnapshot): void
}>((set) => ({
  open: false,
  snapshot: null,
  setOpen: (open) => set({ open }),
  receive: (snapshot) =>
    set((state) =>
      state.snapshot && state.snapshot.revision > snapshot.revision ? {} : { snapshot }
    )
}))
