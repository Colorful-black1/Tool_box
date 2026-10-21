import { describe, expect, it } from 'vitest'
import {
  validateConfigPatch,
  validateOpenCodeApproval,
  validateOpenCodeInput,
  validateOpenCodeOption
} from './validation'

describe('编程工作台 IPC 参数', () => {
  it('任务限制长度和空白，审批必须显式布尔值', () => {
    expect(() => validateOpenCodeInput({ sessionId: 's1', content: ' ' })).toThrow()
    expect(() => validateOpenCodeInput({ sessionId: 's1', content: 'x'.repeat(50001) })).toThrow()
    expect(() =>
      validateOpenCodeApproval({ sessionId: 's1', approvalId: 'a1', approved: 'true' })
    ).toThrow()
    expect(validateOpenCodeInput({ sessionId: 's1', content: ' 测试任务 ' })).toEqual({
      sessionId: 's1',
      content: '测试任务'
    })
  })
  it('配置项逐字段校验，连接偏好只保存白名单字段', () => {
    expect(() => validateOpenCodeOption({ sessionId: 's1', optionId: '', value: 'plan' })).toThrow()
    expect(
      validateConfigPatch({
        opencode: {
          executablePath: '/fixture/opencode',
          directory: '/fixture/project',
          token: 'fixture-value'
        },
        fontSize: 23
      })
    ).toEqual({
      opencode: { executablePath: '/fixture/opencode', directory: '/fixture/project' },
      fontSize: 23
    })
  })
})
