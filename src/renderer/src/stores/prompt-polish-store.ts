import { create } from 'zustand'
import { MAX_PROMPT_BODY } from '../../../shared/prompt-tools'

/** 原文和结果仅保存在本次应用内存；修改输入后不采用旧请求的结果。 */
interface PromptPolishState {
  input: string
  title: string
  output: string
  revision: number
  busy: boolean
  error: string
  setInput(input: string, title?: string): void
  run(): Promise<void>
}

export const usePromptPolishStore = create<PromptPolishState>((set, get) => ({
  input: '',
  title: '',
  output: '',
  revision: 0,
  busy: false,
  error: '',
  setInput: (input, title) =>
    set((state) => ({
      input,
      title: title ?? state.title,
      output: '',
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
    set({ busy: true, error: '', output: '' })
    try {
      const output = await window.toolbox.tools.polishPrompt(input)
      if (get().revision === revision) set({ output })
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
      set({ busy: false })
    }
  }
}))
