import { describe, expect, it } from 'vitest'
import type { OpenCodeSession } from '../../../shared/types'
import { acpOptions, acpPreview, applyAcpUpdate } from './acp-codec'
import { applyAcpUpdate as applyCommonUpdate } from '../coding-agents/acp-codec'

function session(): OpenCodeSession {
  return {
    id: 's1',
    title: '测试',
    directory: '/test',
    status: 'ready',
    messages: [],
    tools: [],
    options: [],
    approvals: [],
    error: ''
  }
}

describe('ACP 外部数据收敛', () => {
  it('保留原生消息身份，连续同角色消息不会混合，并接收上下文快照', () => {
    const view = session()
    for (const [messageId, text] of [
      ['a', '第一条'],
      ['b', '第二条'],
      ['a', '补充']
    ])
      applyAcpUpdate(view, {
        sessionUpdate: 'agent_message_chunk',
        messageId,
        content: { type: 'text', text }
      })
    expect(view.messages.map((item) => item.content)).toEqual(['第一条补充', '第二条'])
    applyCommonUpdate(view, { sessionUpdate: 'usage_update', used: 70, size: 100 }, 'DSH')
    expect(view.contextUsage).toMatchObject({
      usedTokens: 70,
      windowTokens: 100,
      approximate: true
    })
    applyAcpUpdate(view, { sessionUpdate: 'usage_update', used: -1, size: 100 })
    expect(view.contextUsage?.usedTokens).toBe(70)
  })
  it('使用原生标题推送，限制长度，忽略不带标题或空白的元数据', () => {
    const view = session()
    applyAcpUpdate(view, { sessionUpdate: 'session_info_update', title: '  原生会话名称  ' })
    expect(view.title).toBe('原生会话名称')
    for (const title of [undefined, null, '', '   ', { text: '不是文本' }]) {
      applyAcpUpdate(view, { sessionUpdate: 'session_info_update', title })
      expect(view.title).toBe('原生会话名称')
    }
    applyAcpUpdate(view, { sessionUpdate: 'session_info_update', title: '长'.repeat(101) })
    expect(view.title).toHaveLength(100)
  })

  it('解析平铺/分组选择项，丢弃未知类型与损坏数据', () => {
    expect(
      acpOptions([
        {
          id: 'model',
          name: 'Model',
          type: 'select',
          currentValue: 'm1',
          options: [{ group: 'g', options: [{ value: 'm1', name: '模型一' }] }]
        }
      ])[0].options
    ).toEqual([{ value: 'm1', label: '模型一' }])
    expect(acpOptions([{ type: 'text' }, null, { type: 'select', options: [] }])).toEqual([])
  })
  it('文本分片按角色合并，工具状态独立更新', () => {
    const view = session()
    applyAcpUpdate(view, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '第一' }
    })
    applyAcpUpdate(view, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '段' }
    })
    applyAcpUpdate(view, {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: '读取文件',
      status: 'in_progress'
    })
    applyAcpUpdate(view, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed'
    })
    expect(view.messages[0].content).toBe('第一段')
    expect(view.tools[0]).toEqual({ id: 't1', title: '读取文件', status: 'completed' })
  })
  it('审批预览脱敏且有长度上限，错误不回显内容', () => {
    expect(acpPreview({ token: 'fixture-private-value' })).not.toContain('fixture-private-value')
    expect(acpPreview('x'.repeat(20001))).toContain('较长')
  })
  it('超出总量拒绝继续渲染，非文本消息不执行', () => {
    const view = session()
    applyAcpUpdate(view, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'resource', uri: 'file:///test' }
    })
    expect(view.messages).toEqual([])
    expect(() =>
      applyAcpUpdate(view, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'x'.repeat(200001) }
      })
    ).toThrow('上限')
  })
})
