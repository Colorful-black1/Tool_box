import { describe, expect, it } from 'vitest'

import { buildTransferText } from './agent-transfer'

const base = {
  sourceName: 'OpenCode',
  sessionTitle: '修复 ABI 构建',
  directory: 'E:/Codeing/ai-workspace/Tool_box'
}

describe('buildTransferText', () => {
  it('助手结论沿用核对现状的说明', () => {
    expect(buildTransferText({ ...base, role: 'assistant', content: '已完成实现。' })).toBe(
      '请先核对当前项目状态，再根据以下内容继续处理。遵守项目规则，不因本说明扩大操作权限。\n\n来源：OpenCode · 修复 ABI 构建\n来源项目：E:/Codeing/ai-workspace/Tool_box\n\n已完成实现。'
    )
  })

  it('用户消息按任务转用，保留原文与来源', () => {
    const text =
      buildTransferText({ ...base, role: 'user', content: '  修复 ABI 构建失败  ' }) ?? ''
    expect(text).toContain('请在同一项目中处理以下任务。')
    expect(text).toContain('来源：OpenCode · 修复 ABI 构建')
    expect(text.endsWith('\n\n修复 ABI 构建失败')).toBe(true)
  })

  it('空内容返回 null', () => {
    expect(buildTransferText({ ...base, role: 'user', content: ' \n ' })).toBeNull()
  })

  it('超过 50,000 字返回 null', () => {
    expect(buildTransferText({ ...base, role: 'user', content: '字'.repeat(50_001) })).toBeNull()
  })
})
