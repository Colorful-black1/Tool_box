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
  it('强制刷新会读取 AI 刚写入的模板', async () => {
    await usePromptStore.getState().load()
    get.mockResolvedValueOnce({
      promptTemplates: [
        ...defaultPromptTemplates(),
        {
          id: 'agent-ai',
          title: 'AI 模板',
          body: '请总结 {{context}}',
          updatedAtMs: 1,
          versions: []
        }
      ]
    })
    await usePromptStore.getState().load(true)
    expect(usePromptStore.getState().templates).toHaveLength(6)
    expect(usePromptStore.getState().templates.at(-1)?.title).toBe('AI 模板')
  })
  it('保存前合并最新配置，不覆盖 AI 新增模板', async () => {
    await usePromptStore.getState().load()
    const base = usePromptStore.getState().templates
    get.mockResolvedValueOnce({
      promptTemplates: [
        ...base,
        {
          id: 'agent-ai',
          title: 'AI 模板',
          body: '请总结 {{context}}',
          updatedAtMs: 1,
          versions: []
        }
      ]
    })
    expect(await usePromptStore.getState().save({ ...base[0], body: 'changed' })).not.toBeNull()
    const templates = usePromptStore.getState().templates
    expect(templates.some((item) => item.id === 'agent-ai')).toBe(true)
    expect(templates.find((item) => item.id === base[0].id)?.body).toBe('changed')
  })
  it('保存时发现最新配置损坏则拒绝覆盖', async () => {
    await usePromptStore.getState().load()
    get.mockResolvedValueOnce({ promptTemplates: 'bad' })
    expect(
      await usePromptStore.getState().save({ ...defaultPromptTemplates()[0], body: 'changed' })
    ).toBeNull()
    expect(save).not.toHaveBeenCalled()
    expect(usePromptStore.getState().error).toContain('无效')
  })
})
