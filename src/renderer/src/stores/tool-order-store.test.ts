import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToolOrderStore } from './tool-order-store'

const api = { get: vi.fn(), set: vi.fn() }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('window', { toolbox: { config: api } })
  api.get.mockResolvedValue({ toolOrder: ['uuid', 'json'], fontSize: 23 })
  api.set.mockResolvedValue({})
  useToolOrderStore.setState({
    order: [],
    loaded: false,
    loading: false,
    saving: false,
    error: '',
    message: ''
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('工具顺序保存', () => {
  it('读取、保存只发送顺序补丁，不覆盖其他配置', async () => {
    await useToolOrderStore.getState().load()
    expect(useToolOrderStore.getState().order).toEqual(['uuid', 'json'])
    await useToolOrderStore.getState().save(['json', 'uuid'])
    expect(api.set).toHaveBeenCalledWith({ toolOrder: ['json', 'uuid'] })
    expect(useToolOrderStore.getState().message).toBe('工具顺序已保存')
  })
  it('保存失败回退且释放状态，允许重试', async () => {
    await useToolOrderStore.getState().load()
    api.set.mockRejectedValueOnce(new Error('private-detail'))
    await useToolOrderStore.getState().save(['json', 'uuid'])
    expect(useToolOrderStore.getState().order).toEqual(['uuid', 'json'])
    expect(useToolOrderStore.getState().error).toContain('已恢复')
    expect(useToolOrderStore.getState().error).not.toContain('private')
    expect(useToolOrderStore.getState().saving).toBe(false)
    await useToolOrderStore.getState().save(['json', 'uuid'])
    expect(useToolOrderStore.getState().order).toEqual(['json', 'uuid'])
  })
  it('保存中拒绝后续修改，防止请求结果乱序', async () => {
    await useToolOrderStore.getState().load()
    let finish = (): void => {}
    api.set.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({})
        })
    )
    const pending = useToolOrderStore.getState().save(['json', 'uuid'])
    await useToolOrderStore.getState().save(['uuid'])
    expect(api.set).toHaveBeenCalledTimes(1)
    finish()
    await pending
    expect(useToolOrderStore.getState().order).toEqual(['json', 'uuid'])
  })
  it('读取失败保持默认，不允许覆盖未知原顺序；重试成功后恢复', async () => {
    api.get.mockRejectedValueOnce(new Error('private-detail'))
    await useToolOrderStore.getState().load()
    await useToolOrderStore.getState().save(['json'])
    expect(api.set).not.toHaveBeenCalled()
    expect(useToolOrderStore.getState().loaded).toBe(false)
    await useToolOrderStore.getState().load()
    expect(useToolOrderStore.getState().loaded).toBe(true)
  })
  it('无桥接时给出降级提示；空配置兼容默认顺序', async () => {
    vi.stubGlobal('window', {})
    await useToolOrderStore.getState().load()
    expect(useToolOrderStore.getState().error).toContain('桥接尚未就绪')
    vi.stubGlobal('window', { toolbox: { config: api } })
    api.get.mockResolvedValueOnce(null)
    await useToolOrderStore.getState().load()
    expect(useToolOrderStore.getState().order).toEqual([])
  })
})
