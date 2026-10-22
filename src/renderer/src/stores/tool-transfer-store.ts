import { create } from 'zustand'
import { useAppStore } from './app-store'

export type TransferToolId =
  'json' | 'diff' | 'redact' | 'java-log' | 'prompt' | 'prompt-polish' | 'prompt-template'

/** 一次性的渲染层数据交接；不落盘、不触发 AI 请求。 */
interface ToolTransfer {
  sequence: number
  target: TransferToolId
  text: string
  other?: string
  mode?: 'text' | 'json'
}

/** 只保留一条待消费请求，旧组件不能清除后来抵达的新请求。 */
interface ToolTransferState {
  sequence: number
  pending: ToolTransfer | null
  send(target: TransferToolId, text: string, other?: string, mode?: 'text' | 'json'): void
  consume(sequence: number): void
}

export const useToolTransferStore = create<ToolTransferState>((set, get) => ({
  sequence: 0,
  pending: null,
  send: (target, text, other, mode) => {
    const sequence = get().sequence + 1
    set({ sequence, pending: { sequence, target, text, other, mode } })
    useAppStore.getState().setToolsActive(target === 'prompt-template' ? 'prompt' : target)
    useAppStore.getState().setView('tools')
  },
  consume: (sequence) => {
    if (get().pending?.sequence === sequence) set({ pending: null })
  }
}))
