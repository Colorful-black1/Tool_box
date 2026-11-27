import Database from 'better-sqlite3'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { estimateTextTokens } from '../../../shared/context-tokens'
import {
  MemoryService,
  PINNED_MEMORY_BUDGET_TOKENS,
  RELEVANT_MEMORY_BUDGET_TOKENS
} from './memory-service'
import { ToolboxStore } from '../chat-store/chat-store'
import type { SecretBox } from '../crypto/secret-box'

const box: SecretBox = {
  encrypt: (value) => JSON.stringify(value),
  decrypt: (value) => JSON.parse(value)
}

let root = ''
let dbPath = ''
let store: ToolboxStore
let memory: MemoryService

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'toolbox-memory-'))
  dbPath = join(root, 'toolbox.db')
  store = new ToolboxStore(dbPath, box)
  memory = new MemoryService(store)
})

afterEach(async () => {
  store.close()
  await rm(root, { recursive: true, force: true })
})

describe('助手长期记忆', () => {
  it('schema 升到 v9 并保留记忆表', () => {
    const database = new Database(dbPath, { readonly: true })
    try {
      expect(database.pragma('user_version', { simple: true })).toBe(9)
      expect(
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_items'")
          .get()
      ).toBeTruthy()
    } finally {
      database.close()
    }
  })

  it('v7 数据库升级到当前版本，重复打开保持幂等', async () => {
    const legacyPath = join(root, 'legacy.db')
    const legacy = new Database(legacyPath)
    try {
      legacy.pragma('user_version = 7')
    } finally {
      legacy.close()
    }

    const upgraded = new ToolboxStore(legacyPath, box)
    upgraded.close()
    const backups = await readdir(join(root, 'backups'))
    expect(backups.some((name) => name.startsWith('toolbox-before-v9-'))).toBe(true)
    const inspected = new Database(legacyPath, { readonly: true })
    try {
      expect(
        inspected.prepare("SELECT name FROM sqlite_master WHERE name = 'memory_items'").get()
      ).toBeTruthy()
      expect(inspected.pragma('user_version', { simple: true })).toBe(9)
    } finally {
      inspected.close()
    }

    const reopened = new ToolboxStore(legacyPath, box)
    try {
      expect(
        reopened.listMemoryItems({ query: '', kind: 'all', status: 'all', offset: 0, limit: 10 })
      ).toMatchObject({ total: 0, pinnedCount: 0 })
    } finally {
      reopened.close()
    }
  })

  it('早期 v8 库缺少 FTS 表时启动自动创建并回填', () => {
    const path = join(root, 'legacy-v8.db')
    const first = new ToolboxStore(path, box)
    first.insertMemoryItem({
      kind: 'procedural',
      title: '部署流程',
      body: '部署前先构建。',
      tags: [],
      pinned: false,
      status: 'active',
      confidence: 0.9
    })
    first.close()

    const raw = new Database(path)
    raw.exec('DROP TABLE memory_items_fts')
    raw.close()

    const reopened = new ToolboxStore(path, box)
    try {
      expect(
        reopened.searchMemoryItems({ query: '构建', limit: 5 }).map((item) => item.title)
      ).toEqual(['部署流程'])
    } finally {
      reopened.close()
    }
  })

  it('显式保存即生效，来源与置信度由主进程维护', () => {
    const item = memory.save(
      {
        kind: 'constraint',
        title: '不要自动提交',
        body: '没有明确指令时不要执行 git commit 或 git push。',
        tags: ['git', '协作'],
        pinned: true
      },
      {
        conversationId: 'conversation-1',
        messageId: 'message-1',
        excerpt: '以后都不要自动提交'
      }
    )

    expect(item).toMatchObject({
      kind: 'constraint',
      title: '不要自动提交',
      status: 'active',
      confidence: 0.9,
      pinned: true,
      sourceConversationId: 'conversation-1',
      sourceMessageId: 'message-1',
      sourceExcerpt: '以后都不要自动提交'
    })
    expect(memory.list({ query: 'git' })).toMatchObject({ total: 1, pinnedCount: 1 })
  })

  it('编辑保留状态与来源，归档后不再常驻注入', () => {
    const first = memory.save({
      kind: 'preference',
      title: '先给结论',
      body: '回答先给结论，再展开。',
      tags: [],
      pinned: true
    })
    memory.setState({ id: first.id, status: 'archived' })
    const edited = memory.save({
      id: first.id,
      kind: 'preference',
      title: '先给结论，再补细节',
      body: '回答先给结论，再补必要细节。',
      tags: [],
      pinned: true
    })

    expect(edited.status).toBe('archived')
    expect(edited.confidence).toBe(0.9)
    expect(memory.pinnedPrompt()).toBe('')
  })

  it('常驻块只包含置顶偏好 / 约束且不超过预算', () => {
    memory.save({
      kind: 'profile',
      title: 'Windows',
      body: '主要使用 Windows。',
      tags: [],
      pinned: true
    })
    memory.save({
      kind: 'constraint',
      title: '不要自动提交',
      body: '不要自动执行 git commit。',
      tags: [],
      pinned: true
    })
    memory.save({
      kind: 'preference',
      title: '短回答',
      body: '回答尽量短。',
      tags: [],
      pinned: true
    })
    memory.save({
      kind: 'preference',
      title: '未置顶',
      body: '这条不应常驻。',
      tags: [],
      pinned: false
    })

    const prompt = memory.pinnedPrompt()
    expect(prompt).toContain('<system-reminder>')
    expect(prompt).toContain('[约束] 不要自动提交')
    expect(prompt).toContain('[偏好] 短回答')
    expect(prompt).not.toContain('Windows')
    expect(prompt).not.toContain('未置顶')
    expect(estimateTextTokens(prompt)).toBeLessThanOrEqual(PINNED_MEMORY_BUDGET_TOKENS)
  })

  it('预算用尽时按顺序截断，不生成空提示', () => {
    for (let index = 0; index < 10; index += 1) {
      memory.save({
        kind: 'preference',
        title: `偏好 ${index}`,
        body: '很长的偏好说明。'.repeat(20),
        tags: [],
        pinned: true
      })
    }

    const prompt = memory.pinnedPrompt()
    expect(estimateTextTokens(prompt)).toBeLessThanOrEqual(PINNED_MEMORY_BUDGET_TOKENS)
    expect(prompt.split('\n').filter((line) => line.startsWith('- ')).length).toBeGreaterThan(0)
  })

  it('自动学习开关独立于总开关，任一关闭都停止提取', () => {
    store.configSet({ memoryAutoLearn: false })
    expect(memory.isAutoLearnEnabled()).toBe(false)
    expect(
      memory.saveCandidates('c1', [
        { kind: 'preference', title: '先给结论', body: '回答先给结论。', tags: [], confidence: 0.7 }
      ])
    ).toEqual([])

    store.configSet({ memoryAutoLearn: true })
    expect(memory.isAutoLearnEnabled()).toBe(true)

    store.configSet({ memoryEnabled: false })
    expect(memory.isAutoLearnEnabled()).toBe(false)
  })

  it('关闭总开关后不注入，但已有记忆仍可读取', () => {
    memory.save({
      kind: 'preference',
      title: '先给结论',
      body: '回答先给结论。',
      tags: [],
      pinned: true
    })
    store.configSet({ memoryEnabled: false })

    expect(memory.isEnabled()).toBe(false)
    expect(memory.pinnedPrompt()).toBe('')
    expect(memory.list().total).toBe(1)
  })

  it('拒绝密码、API Key 与令牌类正文', () => {
    expect(() =>
      memory.save({
        kind: 'profile',
        title: '密钥',
        body: 'sk-abcdefghijklmnopqrstuvwxyz123456',
        tags: [],
        pinned: false
      })
    ).toThrow('记忆不能保存密码、API Key 或访问令牌')
    expect(() =>
      memory.save({
        kind: 'profile',
        title: '密码',
        body: '密码是 hunter2',
        tags: [],
        pinned: false
      })
    ).toThrow('记忆不能保存密码、API Key 或访问令牌')
    expect(() =>
      memory.save({
        kind: 'constraint',
        title: '密码策略',
        body: '不要自动填充密码。',
        tags: [],
        pinned: false
      })
    ).not.toThrow()
  })

  it('FTS 检索命中中文与标签，编辑后旧词失效、新词生效', () => {
    const item = memory.save({
      kind: 'procedural',
      title: '发布流程',
      body: '发布前先执行构建和类型检查。',
      tags: ['发布'],
      pinned: false
    })

    expect(memory.search({ query: '构建' }).map((hit) => hit.id)).toContain(item.id)
    expect(memory.search({ query: '发布', tags: '发布' }).map((hit) => hit.id)).toContain(item.id)

    memory.save({
      id: item.id,
      kind: 'procedural',
      title: '回滚流程',
      body: '回滚前先确认备份。',
      tags: ['回滚'],
      pinned: false
    })
    expect(memory.search({ query: '构建' })).toEqual([])
    expect(memory.search({ query: '备份' }).map((hit) => hit.id)).toContain(item.id)
  })

  it('单个汉字走 LIKE 兜底，归档后不再被检索', () => {
    const item = memory.save({
      kind: 'preference',
      title: '回答格式',
      body: '先给结论。',
      tags: [],
      pinned: false
    })
    expect(memory.search({ query: '结' }).map((hit) => hit.id)).toContain(item.id)

    memory.setState({ id: item.id, status: 'archived' })
    expect(memory.search({ query: '结' })).toEqual([])
  })

  it('相关注入排除置顶项，正文超预算时截断并保留常驻预算', () => {
    memory.save({
      kind: 'constraint',
      title: '不要自动提交',
      body: '不要自动执行 git commit。',
      tags: [],
      pinned: true
    })
    for (let index = 0; index < 10; index += 1) {
      memory.save({
        kind: 'procedural',
        title: `发布检查 ${index}`,
        body: `发布前执行构建检查。${'补充说明。'.repeat(40)}`,
        tags: ['发布'],
        pinned: false
      })
    }

    const prompt = memory.prompt('发布前要做哪些检查')
    expect(prompt).toContain('【常驻】')
    expect(prompt).toContain('【相关】')
    expect(prompt).toContain('[约束] 不要自动提交')
    const relevant = prompt.slice(prompt.indexOf('【相关】'))
    expect(relevant).not.toContain('不要自动提交')
    expect(estimateTextTokens(relevant)).toBeLessThanOrEqual(RELEVANT_MEMORY_BUDGET_TOKENS)
    expect(estimateTextTokens(prompt)).toBeLessThanOrEqual(
      PINNED_MEMORY_BUDGET_TOKENS + RELEVANT_MEMORY_BUDGET_TOKENS
    )
  })

  it('显式保存同标题新内容时归档旧版本，完全一致则复用', () => {
    const old = memory.save({
      kind: 'preference',
      title: '回答长度',
      body: '回答尽量简短。',
      tags: [],
      pinned: false
    })
    const updated = memory.save({
      kind: 'preference',
      title: '回答长度',
      body: '回答限制在三段以内。',
      tags: [],
      pinned: false
    })
    expect(memory.get(old.id).status).toBe('archived')
    expect(updated.status).toBe('active')

    const same = memory.save({
      kind: 'preference',
      title: '回答长度',
      body: '回答限制在三段以内。',
      tags: [],
      pinned: false
    })
    expect(same.id).toBe(updated.id)
  })

  it('自动候选只写 pending，重复提取不新增，批准时才归档旧版本', () => {
    const old = memory.save({
      kind: 'preference',
      title: '回答长度',
      body: '回答尽量简短。',
      tags: [],
      pinned: false
    })
    const candidate = {
      kind: 'preference' as const,
      title: '回答长度',
      body: '回答限制在三段以内。',
      tags: ['风格'],
      confidence: 0.7,
      sourceMessageId: 'm1'
    }

    const first = memory.saveCandidates('c1', [candidate])
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ status: 'pending', sourceConversationId: 'c1' })
    expect(memory.list().pendingCount).toBe(1)
    expect(memory.prompt()).not.toContain('三段以内')

    const second = memory.saveCandidates('c1', [candidate])
    expect(second).toEqual([])
    expect(memory.list().pendingCount).toBe(1)

    memory.setState({ id: first[0].id, status: 'active' })
    expect(memory.get(old.id).status).toBe('archived')
    expect(memory.get(first[0].id).status).toBe('active')
  })

  it('候选来源摘录含密钥时退回已校验的正文', () => {
    const [item] = memory.saveCandidates('c1', [
      {
        kind: 'preference',
        title: '先给结论',
        body: '回答先给结论。',
        tags: [],
        confidence: 0.6,
        sourceMessageId: 'm1',
        sourceExcerpt: '我的 key 是 sk-abcdefghijklmnopqrstuvwxyz123456'
      }
    ])
    expect(item.sourceExcerpt).toBe('回答先给结论。')
  })

  it('拒绝过的标题不再重复提议，不同标题仍可进入待确认', () => {
    const candidate = {
      kind: 'preference' as const,
      title: '回答先给结论',
      body: '回答先给结论。',
      tags: [],
      confidence: 0.6
    }
    const first = memory.saveCandidates('c1', [candidate])[0]
    memory.setState({ id: first.id, status: 'rejected' })
    expect(memory.saveCandidates('c1', [candidate])).toEqual([])

    const other = memory.saveCandidates('c1', [{ ...candidate, title: '少用表格' }])
    expect(other).toHaveLength(1)
    expect(other[0].status).toBe('pending')
  })

  it('episodic 默认 90 天到期，读取前自动归档', () => {
    const item = memory.save({
      kind: 'episodic',
      title: '项目切换数据库',
      body: '这个项目下周切换数据库。',
      tags: [],
      pinned: false
    })
    expect(item.expiresAtMs).not.toBeNull()
    expect(item.expiresAtMs! > Date.now()).toBe(true)

    store.updateMemoryItem(item.id, {
      kind: item.kind,
      title: item.title,
      body: item.body,
      tags: item.tags,
      pinned: item.pinned,
      status: item.status,
      confidence: item.confidence,
      expiresAtMs: Date.now() - 1
    })
    expect(memory.list().items.find((entry) => entry.id === item.id)?.status).toBe('archived')
  })

  it('JSON 导出后可恢复全部状态，并合并同标题条目', () => {
    memory.save({
      kind: 'preference',
      title: '先给结论',
      body: '回答先给结论。',
      tags: ['风格'],
      pinned: true
    })
    memory.saveCandidates('c1', [
      {
        kind: 'procedural',
        title: '发布检查',
        body: '发布前执行构建。',
        tags: ['发布'],
        confidence: 0.7
      }
    ])
    const archived = memory.save({
      kind: 'profile',
      title: '旧系统',
      body: '以前使用 macOS。',
      tags: [],
      pinned: false
    })
    memory.setState({ id: archived.id, status: 'archived' })

    const text = memory.export('json')
    for (const entry of memory.list({ status: 'all' }).items) memory.remove(entry.id)
    expect(memory.list().total).toBe(0)

    const result = memory.import(text)
    expect(result).toEqual({ total: 3, imported: 3, updated: 0, skipped: 0 })
    const restored = memory.list({ status: 'all' }).items
    expect(restored.find((entry) => entry.title === '先给结论')).toMatchObject({
      status: 'active',
      pinned: true
    })
    expect(restored.find((entry) => entry.title === '发布检查')).toMatchObject({
      status: 'pending',
      confidence: 0.7
    })
    expect(restored.find((entry) => entry.title === '旧系统')?.status).toBe('archived')
  })

  it('导入同标题时合并而不是重复，非法项跳过', () => {
    memory.save({
      kind: 'preference',
      title: '回答长度',
      body: '回答尽量简短。',
      tags: [],
      pinned: false
    })
    const result = memory.import(
      JSON.stringify({
        version: 1,
        items: [
          {
            kind: 'preference',
            title: '回答长度',
            body: '回答限制在三段以内。',
            tags: [],
            status: 'active',
            confidence: 0.8,
            pinned: true
          },
          { kind: 'preference', title: '', body: '坏数据', status: 'active' }
        ]
      })
    )

    expect(result).toMatchObject({ total: 1, imported: 0, updated: 1, skipped: 0 })
    const items = memory.list({ status: 'all' }).items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: '回答长度',
      body: '回答限制在三段以内。',
      pinned: true
    })
  })

  it('无关问题不注入相关记忆', () => {
    memory.save({
      kind: 'procedural',
      title: '发布流程',
      body: '发布前先执行构建。',
      tags: ['发布'],
      pinned: false
    })
    expect(memory.prompt('今天天气怎么样')).toBe('')
  })

  it('删除后列表与注入都不再出现', () => {
    const item = memory.save({
      kind: 'preference',
      title: '先给结论',
      body: '回答先给结论。',
      tags: [],
      pinned: true
    })
    memory.remove(item.id)

    expect(memory.list().total).toBe(0)
    expect(memory.pinnedPrompt()).toBe('')
  })
})
