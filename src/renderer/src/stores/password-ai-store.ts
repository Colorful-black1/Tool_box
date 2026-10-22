import { create } from 'zustand'
import { generateUuid } from '../../../shared/dev-tools'
import type { AiOutputEvent, PasswordAiPreview, PasswordDraft } from '../../../shared/types'

/** 只保存本次识别的临时状态；完整校验成功前不产生可导入草稿。 */
interface PasswordAiState {
  requestId: string | null
  busy: boolean
  stopping: boolean
  entries: PasswordAiPreview[]
  receivedChars: number
  drafts: PasswordDraft[] | null
  error: string
  start(): Promise<void>
  stop(): Promise<void>
  clear(): void
  receive(event: AiOutputEvent): void
}

const empty = {
  requestId: null,
  busy: false,
  stopping: false,
  entries: [],
  receivedChars: 0,
  drafts: null,
  error: ''
}
export const usePasswordAiStore = create<PasswordAiState>((set, get) => ({
  ...empty,
  clear: () => {
    const id = get().requestId
    set(empty)
    if (id)
      void window.toolbox?.tools?.stopAi(id).catch(() => {
        // 页面已关闭，状态已清除；主进程仍会在超时或窗口销毁时回收请求。
      })
  },
  start: async () => {
    if (get().busy) return
    if (!window.toolbox?.passwords?.importAi || !window.toolbox?.tools?.onAiOutput) {
      set({ error: 'AI 识别接口未就绪，请使用最新桌面应用' })
      return
    }
    const requestId = generateUuid()
    set({ ...empty, requestId, busy: true })
    try {
      const drafts = await window.toolbox.passwords.importAi(requestId)
      if (get().requestId === requestId && !get().stopping) set({ drafts })
    } catch {
      if (get().requestId === requestId)
        set({
          error: get().stopping
            ? '已停止识别，未完成的结果未采用'
            : 'AI 识别失败，请检查配置、文件内容后重试'
        })
    } finally {
      if (get().requestId === requestId)
        set({ busy: false, stopping: false, requestId: null, entries: [], receivedChars: 0 })
    }
  },
  stop: async () => {
    const id = get().requestId
    if (!id || get().stopping) return
    set({ stopping: true, entries: [] })
    try {
      await window.toolbox.tools.stopAi(id)
    } catch {
      if (get().requestId === id) set({ stopping: false, error: '停止失败，请重试' })
    }
  },
  receive: (event) => {
    const state = get()
    if (event.kind !== 'password-import' || event.requestId !== state.requestId || state.stopping)
      return
    set({
      receivedChars: event.receivedChars,
      entries: [...state.entries, ...event.entries].slice(0, 200)
    })
  }
}))
