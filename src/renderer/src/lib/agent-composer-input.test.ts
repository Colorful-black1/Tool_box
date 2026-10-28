import { describe, expect, it } from 'vitest'
import { agentInputTrigger, localAgentCommand } from './agent-composer-input'

describe('编程输入触发位置', () => {
  it('识别当前光标前的文件片段，保留后续正文', () => {
    expect(agentInputTrigger('查看 @src/a 后续', 9)).toMatchObject({
      kind: 'files',
      query: 'src/a',
      start: 3,
      end: 9
    })
    expect(agentInputTrigger('/comp', 5)).toMatchObject({ kind: 'commands', query: 'comp' })
  })
  it('邮件、代码和正文斜杠不能自动触发命令', () => {
    for (const value of [
      'name@example.com',
      '```ts\n@src',
      '`@src',
      '路径 /compact',
      '/compact 参数'
    ])
      expect(agentInputTrigger(value, value.length)).toBeNull()
    expect(localAgentCommand('clear')).toBe('new')
    expect(localAgentCommand('compact')).toBeUndefined()
  })
})
