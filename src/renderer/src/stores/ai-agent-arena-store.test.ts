import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiAgentArenaStore } from './ai-agent-arena-store'
import type { AiAgentArenaResult } from '@shared/ai-agent-arena'

function result(checkedAt: string): AiAgentArenaResult {
  return {
    snapshot: {
      generatedAt: checkedAt,
      boards: [],
      sources: {
        codeagentbench: { ok: true, fetchedAt: checkedAt, checkedAt },
        'terminal-bench': { ok: true, fetchedAt: checkedAt, checkedAt },
        frontierharness: { ok: true, fetchedAt: checkedAt, checkedAt }
      }
    },
    fetchedAtMs: Date.now(),
    source: 'cache',
    stale: false,
    warning: null
  }
}

afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  useAiAgentArenaStore.setState({
    result: null,
    loading: false,
    refreshing: false,
    error: ''
  })
})

describe('Agent 排行 store', () => {
  it('桥接缺失时给出降级提示', async () => {
    vi.stubGlobal('window', {})
    await useAiAgentArenaStore.getState().load()
    expect(useAiAgentArenaStore.getState().error).toContain('接口未就绪')
  })

  it('优先读取缓存，过期后在后台刷新', async () => {
    const stale = result('2020-01-01T00:00:00.000Z')
    const fresh = result(new Date().toISOString())
    const get = vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh)
    vi.stubGlobal('window', { toolbox: { aiAgentArena: { get } } })
    await useAiAgentArenaStore.getState().load()
    expect(get).toHaveBeenNthCalledWith(1, { allowStale: true })
    expect(get).toHaveBeenNthCalledWith(2, {})
    expect(useAiAgentArenaStore.getState().result).toEqual(fresh)
  })

  it('手动刷新跳过 TTL', async () => {
    const get = vi.fn().mockResolvedValue(result(new Date().toISOString()))
    vi.stubGlobal('window', { toolbox: { aiAgentArena: { get } } })
    await useAiAgentArenaStore.getState().refresh(true)
    expect(get).toHaveBeenCalledWith({ force: true })
  })
})
