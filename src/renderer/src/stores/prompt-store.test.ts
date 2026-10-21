import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultPromptTemplates } from '../../../shared/prompt-tools'
import { usePromptStore } from './prompt-store'

describe('模板库持久化', () => {
  const get = vi.fn()
  const save = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    get.mockResolvedValue(null)
    save.mockResolvedValue(null)
    vi.stubGlobal('window', { toolbox: { config: { get, set: save } } })
    usePromptStore.setState({
      templates: defaultPromptTemplates(),
      loaded: false,
      loading: false,
      saving: false,
      error: ''
    })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('旧配置只加载内置模板，不自动写回', async () => {
    await usePromptStore.getState().load()
    expect(usePromptStore.getState().templates).toHaveLength(5)
    expect(save).not.toHaveBeenCalled()
  })
  it('损坏的库禁止被默认模板覆盖，可重试读取', async () => {
    get.mockResolvedValueOnce({ promptTemplates: 'bad' })
    await usePromptStore.getState().load()
    expect(usePromptStore.getState().loaded).toBe(false)
    expect(await usePromptStore.getState().save(defaultPromptTemplates()[0])).toBeNull()
    expect(save).not.toHaveBeenCalled()
    await usePromptStore.getState().load()
    expect(usePromptStore.getState().loaded).toBe(true)
  })
  it('保存仅提交模板字段，失败保留上次数据', async () => {
    await usePromptStore.getState().load()
    const before = usePromptStore.getState().templates
    save.mockRejectedValueOnce(new Error('fixture failure'))
    expect(await usePromptStore.getState().save({ ...before[0], body: 'changed' })).toBeNull()
    expect(usePromptStore.getState().templates).toBe(before)
    expect(usePromptStore.getState().error).toContain('保留')
    await usePromptStore.getState().save({ ...before[0], body: 'changed' })
    expect(Object.keys(save.mock.calls.at(-1)?.[0])).toEqual(['promptTemplates'])
    expect(usePromptStore.getState().templates[0].versions[0].body).toBe(before[0].body)
  })
  it('主进程错误不透传内部细节', async () => {
    await usePromptStore.getState().load()
    save.mockRejectedValueOnce(new Error('模板内部 SQL fixture-sensitive-detail'))
    await usePromptStore.getState().save({ ...defaultPromptTemplates()[0], body: 'changed' })
    expect(usePromptStore.getState().error).not.toContain('fixture-sensitive-detail')
  })
  it('桥接未就绪时仍有内置模板可用', async () => {
    vi.stubGlobal('window', {})
    await usePromptStore.getState().load()
    expect(usePromptStore.getState().templates.length).toBe(5)
    expect(usePromptStore.getState().error).toContain('桥接')
  })
})
