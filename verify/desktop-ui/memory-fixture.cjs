/** 长期记忆的隔离验收桩：只在渲染进程内存里增删改，不触碰真实数据库。 */
module.exports = function createMemoryFixture() {
  const clone = (value) => JSON.parse(JSON.stringify(value))
  const now = Date.now()
  let sequence = 0
  let items = [
    {
      id: 'memory-fixture-1',
      kind: 'constraint',
      title: '不要自动提交',
      body: '没有明确指令时不要执行 git commit 或 git push。',
      tags: ['git', '协作'],
      scope: 'global',
      confidence: 0.9,
      status: 'active',
      pinned: true,
      sourceConversationId: null,
      sourceMessageId: null,
      sourceExcerpt: null,
      createdAtMs: now - 86_400_000,
      updatedAtMs: now - 86_400_000,
      lastUsedAtMs: null,
      expiresAtMs: null
    },
    {
      id: 'memory-fixture-2',
      kind: 'preference',
      title: '回答先给结论',
      body: '默认先给结论，再补必要细节；不要用大段铺垫。',
      tags: ['回答风格'],
      scope: 'global',
      confidence: 0.9,
      status: 'active',
      pinned: false,
      sourceConversationId: null,
      sourceMessageId: null,
      sourceExcerpt: null,
      createdAtMs: now - 3_600_000,
      updatedAtMs: now - 3_600_000,
      lastUsedAtMs: null,
      expiresAtMs: null
    },
    {
      id: 'memory-fixture-3',
      kind: 'preference',
      title: '每周整理待办',
      body: '每周五整理一次未完成待办。',
      tags: ['待办'],
      scope: 'global',
      confidence: 0.7,
      status: 'pending',
      pinned: false,
      sourceConversationId: 'fixture-conversation',
      sourceMessageId: 'fixture-message',
      sourceExcerpt: '以后每周五都帮我整理一下待办',
      createdAtMs: now - 600_000,
      updatedAtMs: now - 600_000,
      lastUsedAtMs: null,
      expiresAtMs: null
    }
  ]

  const matches = (item, query) => {
    const keyword = String(query.query ?? '')
      .trim()
      .toLowerCase()
    if (query.kind && query.kind !== 'all' && item.kind !== query.kind) return false
    if (query.status && query.status !== 'all' && item.status !== query.status) return false
    if (!keyword) return true
    return `${item.title}\n${item.body}`.toLowerCase().includes(keyword)
  }

  const bridge = {
    list: async (query = {}) => {
      const filtered = items
        .filter((item) => matches(item, query))
        .sort(
          (left, right) =>
            Number(right.pinned) - Number(left.pinned) || right.updatedAtMs - left.updatedAtMs
        )
      const offset = query.offset ?? 0
      const limit = query.limit ?? 20
      return {
        items: clone(filtered.slice(offset, offset + limit)),
        total: filtered.length,
        pinnedCount: items.filter((item) => item.status === 'active' && item.pinned).length,
        pendingCount: items.filter((item) => item.status === 'pending').length
      }
    },
    save: async (input) => {
      if (input.id) {
        const index = items.findIndex((item) => item.id === input.id)
        if (index < 0) throw new Error('记忆不存在，请刷新列表')
        items[index] = {
          ...items[index],
          kind: input.kind,
          title: input.title.trim(),
          body: input.body.trim(),
          tags: input.tags ?? [],
          pinned: input.pinned === true,
          updatedAtMs: Date.now()
        }
        return clone(items[index])
      }
      sequence += 1
      const item = {
        id: `memory-fixture-new-${sequence}`,
        kind: input.kind,
        title: input.title.trim(),
        body: input.body.trim(),
        tags: input.tags ?? [],
        scope: 'global',
        confidence: 0.9,
        status: 'active',
        pinned: input.pinned === true,
        sourceConversationId: null,
        sourceMessageId: null,
        sourceExcerpt: null,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        lastUsedAtMs: null,
        expiresAtMs: null
      }
      items = [item, ...items]
      return clone(item)
    },
    remove: async (id) => {
      items = items.filter((item) => item.id !== id)
    },
    setState: async (input) => {
      const item = items.find((entry) => entry.id === input.id)
      if (!item) throw new Error('记忆不存在，请刷新列表')
      if (input.status !== undefined) item.status = input.status
      if (input.pinned !== undefined) item.pinned = input.pinned
      item.updatedAtMs = Date.now()
      return clone(item)
    },
    export: async (format) => `fixture-memory.${format === 'json' ? 'json' : 'md'}`,
    import: async () => ({ total: 0, imported: 0, updated: 0, skipped: 0 })
  }

  return {
    bridge,
    controls: {
      memoryItems: () => clone(items),
      resetMemory: () => {
        items = []
      }
    }
  }
}
