import { describe, expect, it } from 'vitest'
import { nativeForm } from './agent-elicitation'
import { AgentQuestions } from './agent-questions'
import type { NativeCodingSession } from './adapter'

describe('受限原生表单', () => {
  it('原生字符串长度按 Unicode 码点校验，不能用代理对绕过 minLength', () => {
    const form = nativeForm({
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string', minLength: 2 } }
    })
    expect(() =>
      form.content({
        requestId: '',
        cancelled: false,
        answers: [{ questionId: 'q0', values: ['😀'] }]
      })
    ).toThrow('不符合')
    expect(
      form.content({
        requestId: '',
        cancelled: false,
        answers: [{ questionId: 'q0', values: ['😀a'] }]
      })
    ).toEqual({ text: '😀a' })
  })
  it('必填数组允许原生 minItems=0 的空数组，可选数组仍可省略', () => {
    const form = nativeForm({
      type: 'object',
      required: ['required'],
      properties: {
        required: {
          type: 'array',
          items: { type: 'string', enum: ['a'] },
          minItems: 0,
          maxItems: 0
        },
        optional: { type: 'array', items: { type: 'string', enum: ['b'] } }
      }
    })
    expect(
      form.content({
        requestId: '',
        cancelled: false,
        answers: [
          { questionId: 'q0', values: [] },
          { questionId: 'q1', values: [] }
        ]
      })
    ).toEqual({ required: [] })
    expect(() =>
      nativeForm({ type: 'object', properties: { value: { type: 'string' } } }, '请输入 API Key')
    ).toThrow('秘密')
  })
  it('保持枚举原值、可选空值、数字和布尔类型，不用标签替代协议值', async () => {
    const form = nativeForm({
      type: 'object',
      required: ['choice', 'count', 'enabled'],
      properties: {
        choice: {
          type: 'string',
          oneOf: [
            { const: 'a', title: '方案一' },
            { const: 'b', title: '方案二' }
          ]
        },
        count: { type: 'integer', minimum: 1, maximum: 3 },
        enabled: { type: 'boolean' },
        comment: { type: 'string', maxLength: 20 }
      }
    })
    const session: NativeCodingSession = {
      id: 's',
      title: '',
      directory: '/test',
      status: 'running',
      messages: [],
      tools: [],
      options: [],
      approvals: [],
      error: ''
    }
    const manager = new AgentQuestions(() => undefined)
    const pending = manager.ask(session, {
      kind: 'questions',
      title: '',
      questions: form.questions
    })
    const answer = {
      requestId: session.questions![0].id,
      cancelled: false,
      answers: [
        { questionId: 'q0', values: ['a'] },
        { questionId: 'q1', values: ['2'] },
        { questionId: 'q2', values: ['false'] },
        { questionId: 'q3', values: [] }
      ]
    }
    expect(() =>
      manager.answer('s', {
        ...answer,
        answers: answer.answers.map((item, i) => (i === 0 ? { ...item, values: ['方案一'] } : item))
      })
    ).toThrow('不符合')
    manager.answer('s', answer)
    expect(form.content(await pending)).toEqual({ choice: 'a', count: 2, enabled: false })
  })

  it('复核必填、长度、数组边界、重复选项、非有限数和整数精度', () => {
    const form = nativeForm({
      type: 'object',
      required: ['items', 'number', 'name'],
      properties: {
        items: {
          type: 'array',
          items: {
            anyOf: [
              { const: 'x', title: 'X' },
              { const: 'y', title: 'Y' }
            ]
          },
          minItems: 1,
          maxItems: 2
        },
        number: { type: 'integer', minimum: 0, maximum: 10 },
        name: { type: 'string', minLength: 2, maxLength: 4 }
      }
    })
    const answer = {
      requestId: '',
      cancelled: false,
      answers: [
        { questionId: 'q0', values: ['x', 'y'] },
        { questionId: 'q1', values: ['0'] },
        { questionId: 'q2', values: ['名称'] }
      ]
    }
    expect(form.content(answer)).toEqual({ items: ['x', 'y'], number: 0, name: '名称' })
    for (const [index, values] of [
      [0, []],
      [0, ['x', 'x']],
      [0, ['z']],
      [1, ['NaN']],
      [1, ['Infinity']],
      [1, ['1e999']],
      [1, ['1.5']],
      [1, ['11']],
      [1, ['0x1']],
      [2, ['a']],
      [2, ['abcde']]
    ] as Array<[number, string[]]>)
      expect(() =>
        form.content({
          ...answer,
          answers: answer.answers.map((item, i) => (i === index ? { ...item, values } : item))
        })
      ).toThrow('不符合')
  })

  it('拒绝秘密、嵌套、正则、未知格式、过量字段和错误约束', () => {
    for (const field of [
      { type: 'string', title: 'API Key' },
      { type: 'object', properties: {} },
      { type: 'string', pattern: '(a+)+$' },
      { type: 'string', format: 'password' },
      { type: 'number', minimum: 4, maximum: 1 },
      { type: 'array', items: { type: 'object' } },
      { type: 'array', items: { type: 'string', enum: ['a'] }, oneOf: [{ const: ['b'] }] },
      { type: 'array', items: { type: 'string', enum: ['a'] }, uniqueItems: 'true' },
      { type: 'string', enum: ['a', 'a'] },
      { type: 'string', maxLength: -1 }
    ])
      expect(() => nativeForm({ type: 'object', properties: { field } })).toThrow('暂不支持')
    expect(() =>
      nativeForm({ type: 'object', required: ['missing'], properties: { a: { type: 'string' } } })
    ).toThrow()
    expect(() =>
      nativeForm({
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: 5 }, (_, i) => [`f${i}`, { type: 'string' }])
        )
      })
    ).toThrow()
  })
})
