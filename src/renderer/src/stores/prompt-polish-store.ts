import { create } from 'zustand'
import { MAX_PROMPT_BODY } from '../../../shared/prompt-tools'
import { generateUuid } from '../../../shared/dev-tools'
import type { AiOutputEvent } from '../../../shared/types'

/** 原文和结果仅保存在本次应用内存；修改输入后不采用旧请求的结果。 */
interface PromptPolishState {
  input: string
  title: string
  output: string
  preview: string
  requestId: string | null
  requestRevision: number
  stopping: boolean
  revision: number
  busy: boolean
  error: string
  setInput(input: string, title?: string): void
  run(): Promise<void>
  receive(event: AiOutputEvent): void
  stop(): Promise<void>
}

export const usePromptPolishStore = create<PromptPolishState>((set, get) => ({
  input: '',
  title: '',
  output: '',
  preview: '',
  requestId: null,
  requestRevision: 0,
  stopping: false,
  revision: 0,
  busy: false,
  error: '',
  setInput: (input, title) =>
    set((state) => ({
      input,
      title: title ?? state.title,
      output: '',
      preview: '',
      error: '',
      revision: state.revision + 1
    })),
  run: async () => {
    if (get().busy) return
    const { input, revision } = get()
    if (!input.trim() || input.length > MAX_PROMPT_BODY) {
      set({ error: '请填写 1 至 12000 字符的提示词' })
      return
    }
    if (!window.toolbox?.tools?.polishPrompt) {
      set({ error: '提示词美化接口未就绪，请使用最新桌面应用' })
      return
    }
    const requestId = generateUuid()
    set({
      busy: true,
      error: '',
      output: '',
      preview: '',
      requestId,
      requestRevision: revision,
      stopping: false
    })
    try {
      const output = await window.toolbox.tools.polishPrompt(input, requestId)
      if (get().stopping) set({ error: '已停止润色，未完成的结果未采用' })
      else if (get().revision === revision) set({ output })
      else set({ error: '输入已变化，旧结果未采用，请重新润色' })
    } catch (error) {
      if (get().revision === revision) {
        const message = error instanceof Error ? (error.message.split('Error: ').at(-1) ?? '') : ''
        set({
          error: /[\u4e00-\u9fff]/.test(message)
            ? message.slice(0, 300)
            : '提示词润色失败，请检查 AI 设置后重试'
        })
      }
    } finally {
      set({ busy: false, preview: '', requestId: null, stopping: false })
    }
  },
  receive: (event) => {
    const state = get()
    if (
      event.kind !== 'prompt-polish' ||
      event.requestId !== state.requestId ||
      state.stopping ||
      state.revision !== state.requestRevision
    )
      return
    set({ preview: (state.preview + event.delta).slice(0, MAX_PROMPT_BODY + 32) })
  },
  stop: async () => {
    const { requestId } = get()
    if (!requestId || get().stopping) return
    set({ stopping: true, preview: '' })
    try {
      await window.toolbox.tools.stopAi(requestId)
    } catch {
      if (get().requestId === requestId) set({ stopping: false, error: '停止失败，请重试' })
    }
  }
}))
