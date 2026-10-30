import { describe, expect, it, vi } from 'vitest'
import { codexRevertPreview, readCodexHistory } from './codex-history'
import type { NativeCodingSession } from './adapter'

const session: NativeCodingSession = {
  id: 's',
  directory: '/fixture',
  title: '',
  status: 'ready',
  messages: [],
  tools: [],
  approvals: [],
  options: [],
  error: ''
}
const turn = (id: string) => ({
  id,
  status: 'completed',
  itemsView: 'full',
  items: [{ id: `${id}-user`, type: 'userMessage', content: [{ type: 'text', text: id }] }]
})
function peer(data: unknown, nextCursor: unknown = null, historyMode = 'paginated') {
  return {
    request: vi.fn(async (method: string) =>
      method === 'thread/read'
        ? { thread: { id: 's', status: { type: 'idle' }, historyMode } }
        : { data, nextCursor }
    ),
    notify: vi.fn(),
    close: vi.fn()
  }
}

describe('Codex 历史安全边界', () => {
  it('拒绝旧格式、重复轮次／消息、未完成或部分加载轮次和重复游标', async () => {
    for (const transport of [
      peer([], null, 'legacy'),
      peer([turn('a'), turn('a')]),
      peer([{ ...turn('a'), status: 'inProgress' }]),
      peer([{ ...turn('a'), itemsView: 'summary' }]),
      peer([turn('a'), { ...turn('b'), items: turn('a').items }]),
      peer([turn('a')], 'same'),
      peer([], 'no-progress'),
      peer([turn('a')], 4)
    ])
      await expect(readCodexHistory(transport, session, () => true)).rejects.toThrow()
  })
  it('同轮多条用户输入拒绝单消息回退；显示分页不会误读成完整历史', async () => {
    const history = await readCodexHistory(
      peer([{ ...turn('a'), items: [...turn('a').items, ...turn('b').items] }]),
      session,
      () => true
    )
    expect(() => codexRevertPreview(history, 'a-user')).toThrow('多条用户输入')
    const transport = peer([turn('b'), turn('a')], 'older')
    const recent = await readCodexHistory(transport, session, () => true, true)
    expect(recent.session.messages.map((message) => message.content)).toEqual(['a', 'b'])
    expect(recent.session.error).toContain('最近 50 轮')
    expect(transport.request).toHaveBeenCalledTimes(2)
  })
})
