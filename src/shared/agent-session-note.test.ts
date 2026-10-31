import { describe, expect, it } from 'vitest'

import { buildSessionNote } from './agent-session-note'

describe('buildSessionNote', () => {
  it('按顺序标注发言者并统计条数', () => {
    const draft = buildSessionNote({
      agentName: 'OpenCode',
      sessionTitle: '修复 ABI 构建',
      directory: 'E:/Codeing/ai-workspace/Tool_box',
      messages: [
        { role: 'user', content: '  dev 启动报 ABI 不匹配  ' },
        { role: 'assistant', content: '先重建 better-sqlite3。' }
      ]
    })
    expect(draft).toEqual({
      title: 'OpenCode · 修复 ABI 构建',
      content:
        '# 修复 ABI 构建\n\n来源：OpenCode · E:/Codeing/ai-workspace/Tool_box\n共 2 条消息\n\n## 你\n\ndev 启动报 ABI 不匹配\n\n## OpenCode\n\n先重建 better-sqlite3。',
      count: 2
    })
  })

  it('空消息剔除，全部为空时返回 null', () => {
    const draft = buildSessionNote({
      agentName: 'Codex',
      sessionTitle: '',
      directory: '',
      messages: [
        { role: 'user', content: '  ' },
        { role: 'assistant', content: '结论' }
      ]
    })
    expect(draft?.count).toBe(1)
    expect(draft?.title).toBe('Codex · 编程会话')
    expect(draft?.content).toContain('来源：Codex\n')
    expect(
      buildSessionNote({
        agentName: 'Codex',
        sessionTitle: '空会话',
        directory: '',
        messages: [{ role: 'user', content: '\n' }]
      })
    ).toBeNull()
  })

  it('超长会话截断到 2 万字并标注', () => {
    const draft = buildSessionNote({
      agentName: 'Codex',
      sessionTitle: '长会话',
      directory: '',
      messages: [{ role: 'assistant', content: 'a'.repeat(30_000) }]
    })
    expect(draft?.content).toHaveLength(20_000 + '…\n（会话较长，已截断）'.length)
    expect(draft?.content.endsWith('（会话较长，已截断）')).toBe(true)
  })

  it('标题超过 60 字时截断并加省略号', () => {
    const draft = buildSessionNote({
      agentName: 'Claude Code',
      sessionTitle: '很长的会话标题'.repeat(10),
      directory: '',
      messages: [{ role: 'assistant', content: '结论' }]
    })
    expect(draft?.title).toHaveLength(60)
    expect(draft?.title.endsWith('…')).toBe(true)
  })
})
