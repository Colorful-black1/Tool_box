import { describe, expect, it, vi } from 'vitest'

import {
  MemoryCandidateExtractor,
  parseMemoryCandidates,
  shouldExtractMemoryCandidates
} from './memory-candidate-extractor'
import type { ChatMessage } from '../../../shared/types'

function message(id: string, role: 'user' | 'assistant', content: string): ChatMessage {
  return { id, conversationId: 'c1', role, content, createdAtMs: 1 }
}

describe('自动提取门槛', () => {
  it('至少 4 轮，之后每 4 轮一次', () => {
    expect([1, 2, 3, 5, 7].map(shouldExtractMemoryCandidates)).toEqual([
      false,
      false,
      false,
      false,
      false
    ])
    expect([4, 8, 12].map(shouldExtractMemoryCandidates)).toEqual([true, true, true])
  })
})

describe('记忆候选解析', () => {
  it('解析纯 JSON / 代码块，并只保留前三条合法项', () => {
    const text = `\`\`\`json
    ${JSON.stringify([
      {
        kind: 'preference',
        title: '先给结论',
        body: '回答先给结论。',
        tags: ['风格'],
        confidence: 0.7
      },
      { kind: 'unknown', title: '丢弃', body: '类型非法' },
      { kind: 'profile', title: '使用 Windows', body: '主要使用 Windows。', confidence: 2 },
      { kind: 'constraint', title: '不要自动提交', body: '不要自动 commit。' },
      { kind: 'procedural', title: '第四条', body: '超过上限。' }
    ])}\`\`\``
    const result = parseMemoryCandidates(text)

    expect(result).toHaveLength(3)
    expect(result.map((item) => item.title)).toEqual(['先给结论', '使用 Windows', '不要自动提交'])
    expect(result[1].confidence).toBe(1)
    expect(result[0].tags).toEqual(['风格'])
  })

  it('非数组、坏 JSON、空内容都安全返回空数组', () => {
    expect(parseMemoryCandidates('')).toEqual([])
    expect(parseMemoryCandidates('{"title":"不是数组"}')).toEqual([])
    expect(parseMemoryCandidates('[{"kind":"preference",')).toEqual([])
    expect(parseMemoryCandidates('没有候选')).toEqual([])
  })

  it('缺少标题或正文的项被丢弃', () => {
    expect(
      parseMemoryCandidates(
        JSON.stringify([
          { kind: 'preference', title: '', body: '正文' },
          { kind: 'preference', title: '标题', body: '' },
          { kind: 'preference', title: '有效', body: '正文' }
        ])
      )
    ).toEqual([
      {
        kind: 'preference',
        title: '有效',
        body: '正文',
        tags: [],
        confidence: 0.5
      }
    ])
  })
})

describe('记忆候选提取器', () => {
  it('把来源 id 收窄到消息列表，非法 id 回退到最近一条用户消息', async () => {
    const complete = vi.fn(async () =>
      JSON.stringify([
        {
          kind: 'preference',
          title: '先给结论',
          body: '回答先给结论。',
          sourceMessageId: 'fake-id'
        },
        {
          kind: 'constraint',
          title: '不要自动提交',
          body: '不要自动 commit。',
          sourceMessageId: 'u1'
        }
      ])
    )
    const extractor = new MemoryCandidateExtractor('missing-prompt-dir', complete)
    const result = await extractor.extract({
      messages: [
        message('u1', 'user', '以后都先给结论'),
        message('a1', 'assistant', '好的'),
        message('u2', 'user', '不要自动提交')
      ],
      existingTitles: ['旧偏好']
    })

    expect(complete).toHaveBeenCalledOnce()
    expect(result).toHaveLength(2)
    expect(result[0].sourceMessageId).toBe('u2')
    expect(result[0].sourceExcerpt).toBe('不要自动提交')
    expect(result[1].sourceMessageId).toBe('u1')
    expect(result[1].sourceExcerpt).toBe('以后都先给结论')
  })

  it('模型调用失败向调用方抛出，由 Gateway 兜底记录', async () => {
    const extractor = new MemoryCandidateExtractor(
      'missing-prompt-dir',
      vi.fn(async () => {
        throw new Error('model down')
      })
    )
    await expect(
      extractor.extract({ messages: [message('u1', 'user', '记住先给结论')], existingTitles: [] })
    ).rejects.toThrow('model down')
  })
})
