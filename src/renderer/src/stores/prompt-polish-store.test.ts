import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePromptPolishStore } from './prompt-polish-store'

const polish = vi.fn<(text: string) => Promise<string>>()
beforeEach(() => {
  polish.mockReset()
  vi.stubGlobal('window', { toolbox: { tools: { polishPrompt: polish } } })
  usePromptPolishStore.setState({
    input: '',
    title: '',
    output: '',
    preview: '',
    requestId: null,
    requestRevision: 0,
    stopping: false,
    revision: 0,
    busy: false,
    error: ''
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('提示词美化状态', () => {
  it('填入原文不自动发送，失败保留输入且可重试', async () => {
    usePromptPolishStore.getState().setInput('原文 {{context}}', '合成模板')
    expect(polish).not.toHaveBeenCalled()
    polish.mockRejectedValueOnce(new Error('合成请求失败'))
    await usePromptPolishStore.getState().run()
    expect(usePromptPolishStore.getState().input).toBe('原文 {{context}}')
    expect(usePromptPolishStore.getState().busy).toBe(false)
    polish.mockResolvedValueOnce('润色 {{context}}')
    await usePromptPolishStore.getState().run()
    expect(usePromptPolishStore.getState().output).toBe('润色 {{context}}')
  })

  it('拒绝重复请求，修改输入后不采用旧响应', async () => {
    let resolve!: (text: string) => void
    polish.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    usePromptPolishStore.getState().setInput('旧输入')
    const pending = usePromptPolishStore.getState().run()
    const id = usePromptPolishStore.getState().requestId!
    usePromptPolishStore.getState().receive({ kind: 'prompt-polish', requestId: id, delta: '正在' })
    expect(usePromptPolishStore.getState().preview).toBe('正在')
    expect(usePromptPolishStore.getState().output).toBe('')
    await usePromptPolishStore.getState().run()
    expect(polish).toHaveBeenCalledTimes(1)
    usePromptPolishStore.getState().setInput('新输入')
    usePromptPolishStore
      .getState()
      .receive({ kind: 'prompt-polish', requestId: id, delta: '旧分片' })
    expect(usePromptPolishStore.getState().preview).toBe('')
    resolve('旧结果')
    await pending
    expect(usePromptPolishStore.getState().input).toBe('新输入')
    expect(usePromptPolishStore.getState().output).toBe('')
    expect(usePromptPolishStore.getState().error).toContain('输入已变化')
  })
})
