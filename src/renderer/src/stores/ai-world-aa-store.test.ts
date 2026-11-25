import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiWorldAaStore } from './ai-world-aa-store'
import type { AiWorldAaResult } from '@shared/ai-world-aa'

function result(configured: boolean, checkedAt: string): AiWorldAaResult {
  return {
    snapshot: configured
      ? { generatedAt: checkedAt, intelligenceIndexVersion: 5, models: [] }
      : null,
    fetchedAtMs: configured ? Date.now() : null,
    source: configured ? 'cache' : 'none',
    stale: false,
    state: {
      configured,
      ok: configured,
      fetchedAt: configured ? checkedAt : null,
      checkedAt,
      quotaRemaining: null,
      quotaResetAt: null
    }
  }
}

beforeEach(() => {
  useAiWorldAaStore.setState({
    result: null,
    keyStatus: { configured: false },
    loading: false,
    refreshing: false,
    savingKey: false,
    error: ''
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('Artificial Analysis store', () => {
  it('桥接缺失时给出降级提示', async () => {
    vi.stubGlobal('window', {})
    await useAiWorldAaStore.getState().load()
    expect(useAiWorldAaStore.getState().error).toContain('接口未就绪')
  })

  it('优先读缓存，过期后在后台刷新', async () => {
    const stale = result(true, '2020-01-01T00:00:00.000Z')
    const fresh = result(true, new Date().toISOString())
    const get = vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh)
    vi.stubGlobal('window', {
      toolbox: {
        aiWorldAa: {
          get,
          keyStatus: vi.fn().mockResolvedValue({ configured: true }),
          saveKey: vi.fn(),
          clearKey: vi.fn()
        }
      }
    })
    await useAiWorldAaStore.getState().load()
    expect(get).toHaveBeenNthCalledWith(1, { allowStale: true })
    expect(get).toHaveBeenNthCalledWith(2, {})
    expect(useAiWorldAaStore.getState().result).toEqual(fresh)
  })

  it('未配置 Key 时只读状态，不自动刷新', async () => {
    const get = vi.fn().mockResolvedValue(result(false, new Date().toISOString()))
    vi.stubGlobal('window', {
      toolbox: {
        aiWorldAa: {
          get,
          keyStatus: vi.fn().mockResolvedValue({ configured: false }),
          saveKey: vi.fn(),
          clearKey: vi.fn()
        }
      }
    })
    await useAiWorldAaStore.getState().load()
    expect(get).toHaveBeenCalledTimes(1)
    expect(useAiWorldAaStore.getState().keyStatus.configured).toBe(false)
  })

  it('保存 Key 后强制刷新一次', async () => {
    const get = vi.fn().mockResolvedValue(result(true, new Date().toISOString()))
    const saveKey = vi.fn().mockResolvedValue({ configured: true })
    vi.stubGlobal('window', {
      toolbox: {
        aiWorldAa: {
          get,
          keyStatus: vi.fn().mockResolvedValue({ configured: false }),
          saveKey,
          clearKey: vi.fn()
        }
      }
    })
    const ok = await useAiWorldAaStore.getState().saveKey('test-key-12345678')
    expect(ok).toBe(true)
    expect(saveKey).toHaveBeenCalledWith({ apiKey: 'test-key-12345678' })
    expect(get).toHaveBeenCalledWith({ force: true })
    expect(useAiWorldAaStore.getState().keyStatus.configured).toBe(true)
  })
})
