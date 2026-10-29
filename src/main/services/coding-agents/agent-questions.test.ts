import { describe, expect, it, vi } from 'vitest'
import { AgentQuestions, nativeQuestions } from './agent-questions'
import type { NativeCodingSession } from './adapter'

function fixture() {
  const session: NativeCodingSession = {
    id: 'a',
    title: '',
    directory: '/fixture',
    status: 'running',
    messages: [],
    tools: [],
    approvals: [],
    options: [],
    error: ''
  }
  const publish = vi.fn()
  const manager = new AgentQuestions(publish)
  const parsed = nativeQuestions(
    [
      {
        id: 'native',
        header: '方案',
        question: '选择方案',
        options: [{ label: 'A', description: '说明' }, { label: 'B' }]
      }
    ],
    'codex'
  )
  return { session, manager, publish, parsed }
}

describe('受限原生问答', () => {
  it('必须回答原会话与原选项，拒绝伪造答案后仍可正确提交', async () => {
    const { session, manager, parsed } = fixture()
    const pending = manager.ask(session, {
      kind: 'questions',
      title: '选择',
      questions: parsed.questions
    })
    const id = session.questions![0].id
    const answer = {
      requestId: id,
      cancelled: false,
      answers: [{ questionId: 'q0', values: ['A'] }]
    }
    expect(() => manager.answer('other', answer)).toThrow('不属于')
    expect(() =>
      manager.answer('a', { ...answer, answers: [{ questionId: 'q0', values: ['伪造'] }] })
    ).toThrow('不符合')
    manager.answer('a', answer)
    expect(await pending).toEqual(answer)
    expect(session.questions).toEqual([])
    expect(() => manager.answer('a', answer)).toThrow('失效')
  })
  it('停止、原生请求解决、取消信号与超时都释放等待', async () => {
    const { session, manager, parsed } = fixture()
    const ask = (signal?: AbortSignal) =>
      manager.ask(session, { kind: 'questions', title: '', questions: parsed.questions }, signal)
    const stopping = ask()
    manager.cancel('a')
    expect((await stopping).cancelled).toBe(true)
    const resolved = ask()
    manager.cancelRequest(session.questions![0].id)
    expect((await resolved).cancelled).toBe(true)
    const controller = new AbortController()
    const aborted = ask(controller.signal)
    controller.abort()
    expect((await aborted).cancelled).toBe(true)
    vi.useFakeTimers()
    try {
      const timeout = ask()
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect((await timeout).cancelled).toBe(true)
      expect(session.questions).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
  it('拒绝秘密问题、损坏数据与重复原生题目，保留 Claude 多选语义', () => {
    expect(() =>
      nativeQuestions([{ id: 'key', question: '秘密', isSecret: true }], 'codex')
    ).toThrow('秘密')
    expect(() => nativeQuestions([], 'claude')).toThrow('格式')
    expect(() => nativeQuestions([{ question: '一样' }, { question: '一样' }], 'claude')).toThrow(
      '重复'
    )
    expect(
      nativeQuestions(
        [{ question: '选择', multiSelect: true, options: [{ label: 'A' }] }],
        'claude'
      ).questions[0]
    ).toMatchObject({ multiple: true, allowText: true })
  })
})
