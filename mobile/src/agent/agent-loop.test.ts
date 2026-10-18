import { describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '../shared-bridge'
import type { FetchLike } from '../ai/stream-chat'
import { AGENT_MAX_STEPS, looksLikeToolsUnsupported, runAgent } from './agent-loop'
import type { AgentRunInput, AgentToolSink } from './agent-loop'
import { ApprovalGate } from './approval-gate'
import type { AgentToolDefinition } from './tool-registry'

// ==================== 假 SSE 响应 ====================

/** 把 SSE 文本切成若干 Uint8Array，模拟网络分块 */
function toChunks(text: string, byteSize: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text)
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += byteSize) out.push(bytes.slice(i, i + byteSize))
  return out
}

function sseResponse(text: string, byteSize = text.length): Response {
  const chunks = toChunks(text, byteSize)
  let index = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () =>
          Promise.resolve(
            index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true, value: undefined }
          ),
        cancel: () => Promise.resolve()
      })
    },
    text: () => Promise.resolve(text)
  } as unknown as Response
}

function contentDelta(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
}

/** 模型请求一次工具调用：arguments 分两片下发，模拟真实网关的碎片化 */
function toolCallRound(id: string, name: string, args: string): string {
  const half = Math.ceil(args.length / 2)
  const first = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 0, id, type: 'function', function: { name, arguments: args.slice(0, half) } }
          ]
        }
      }
    ]
  })
  const second = JSON.stringify({
    choices: [
      { delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] } }
    ]
  })
  return `data: ${first}\n\ndata: ${second}\n\ndata: [DONE]\n\n`
}

function answerRound(text: string): string {
  return `${contentDelta(text)}data: [DONE]\n\n`
}

interface Script {
  body?: string
  /** 非 2xx：走 streamChat 的错误分支 */
  status?: number
  errorText?: string
  /** 网络层直接 reject */
  reject?: string
}

/** 按脚本依次返回响应，并记录每次请求体；脚本用完后就重复最后一条 */
function scriptedFetch(scripts: Script[]): { fetchImpl: FetchLike; bodies: string[] } {
  const bodies: string[] = []
  let index = 0
  const fetchImpl: FetchLike = (_url, init) => {
    bodies.push(String(init?.body ?? ''))
    const script = scripts[Math.min(index, scripts.length - 1)]
    index++
    if (script.reject) return Promise.reject(new Error(script.reject))
    if (script.status && script.status >= 400) {
      return Promise.resolve({
        ok: false,
        status: script.status,
        text: () => Promise.resolve(script.errorText ?? '')
      } as unknown as Response)
    }
    return Promise.resolve(sseResponse(script.body ?? ''))
  }
  return { fetchImpl, bodies }
}

// ==================== 测试夹具 ====================

const HISTORY: ChatMessage[] = [
  { id: 'm1', conversationId: 'c1', role: 'user', content: '我有几篇笔记', createdAtMs: 1 }
]

function makeTools() {
  const readSpy = vi.fn(async () => ({ count: 3 }))
  const writeSpy = vi.fn(async () => ({ saved: true }))
  const read: AgentToolDefinition = {
    name: 'notes_list',
    description: '列出笔记',
    parameters: { type: 'object', properties: {} },
    risk: 'read',
    handler: readSpy,
    summarize: (_input, result) => `共 ${(result as { count: number }).count} 篇笔记`
  }
  const write: AgentToolDefinition = {
    name: 'notes_save',
    description: '保存笔记',
    parameters: { type: 'object', properties: {} },
    risk: 'write',
    handler: writeSpy,
    summarize: () => '已保存笔记'
  }
  return { read, write, readSpy, writeSpy }
}

interface SinkLog {
  calls: Array<{ callId: string; name: string; args: string }>
  results: Array<{ callId: string; ok: boolean; summary: string }>
  approvals: Array<{ callId: string; name: string; risk: string }>
  notices: string[]
  deltas: string[]
}

function makeSink(onApproval?: (event: { callId: string; name: string }) => void): {
  sink: AgentToolSink
  log: SinkLog
  onDelta: (delta: string) => void
} {
  const log: SinkLog = { calls: [], results: [], approvals: [], notices: [], deltas: [] }
  const sink: AgentToolSink = {
    onToolCall: (event) => log.calls.push(event),
    onToolResult: (event) => log.results.push(event),
    onToolApprovalRequest: (event) => {
      log.approvals.push({ callId: event.callId, name: event.name, risk: event.risk })
      onApproval?.(event)
    }
  }
  return { sink, log, onDelta: (delta) => log.deltas.push(delta) }
}

function runInput(overrides: Partial<AgentRunInput> & Pick<AgentRunInput, 'fetchImpl'>): AgentRunInput {
  return {
    conversationId: 'c1',
    history: HISTORY,
    config: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-pro',
      apiKey: 'sk-test'
    },
    systemPrompt: '你是助手',
    permission: 'confirm',
    tools: [],
    gate: new ApprovalGate(),
    sink: makeSink().sink,
    onDelta: () => {},
    signal: new AbortController().signal,
    timeoutMs: 5000,
    idFactory: () => 'generated-id',
    ...overrides
  }
}

// ==================== 用例 ====================

describe('runAgent', () => {
  it('先执行工具、把结果回灌给模型，再给出最终回答', async () => {
    const { read, readSpy } = makeTools()
    const { fetchImpl, bodies } = scriptedFetch([
      { body: toolCallRound('call_1', 'notes_list', '{"query":"灵"}') },
      { body: answerRound('你有 3 篇笔记。') }
    ])
    const { sink, log, onDelta } = makeSink()

    const result = await runAgent(runInput({ fetchImpl, tools: [read], sink, onDelta }))

    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(readSpy).toHaveBeenCalledWith({ query: '灵' }, expect.anything())
    expect(result).toEqual({ content: '你有 3 篇笔记。', usedTools: true })
    expect(log.calls).toEqual([{ callId: 'call_1', name: 'notes_list', args: '{"query":"灵"}' }])
    expect(log.results).toEqual([
      { callId: 'call_1', ok: true, summary: '共 3 篇笔记' }
    ])
    expect(log.deltas.join('')).toBe('你有 3 篇笔记。')

    // 第一轮带工具与 system 提示词
    const first = JSON.parse(bodies[0] ?? '{}') as Record<string, unknown>
    expect(Array.isArray(first['tools'])).toBe(true)
    expect((first['messages'] as Array<{ role: string }>)[0]?.role).toBe('system')

    // 第二轮把 assistant 的 tool_calls 与 tool 结果一起发回去
    const second = JSON.parse(bodies[1] ?? '{}') as Record<string, unknown>
    const messages = second['messages'] as Array<Record<string, unknown>>
    expect(messages.some((message) => message['role'] === 'assistant')).toBe(true)
    expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_1' })
  })

  it('模型不支持 tools 时降级为普通对话，并提示用户', async () => {
    const { read } = makeTools()
    const { fetchImpl, bodies } = scriptedFetch([
      {
        status: 400,
        errorText: '{"error":{"message":"This model does not support tools"}}'
      },
      { body: answerRound('好的，我直接回答。') }
    ])
    const { sink } = makeSink()
    const notices: string[] = []

    const result = await runAgent(
      runInput({
        fetchImpl,
        tools: [read],
        sink,
        onNotice: (message) => notices.push(message)
      })
    )

    expect(result.content).toBe('好的，我直接回答。')
    expect(notices.join('')).toContain('不支持工具调用')
    expect(bodies).toHaveLength(2)
    expect(JSON.parse(bodies[0] ?? '{}')['tools']).toBeDefined()
    expect(JSON.parse(bodies[1] ?? '{}')['tools']).toBeUndefined()
  })

  it('写工具在 confirm 档位下等用户批准；拒绝则不执行', async () => {
    const { write, writeSpy } = makeTools()
    const { fetchImpl, bodies } = scriptedFetch([
      { body: toolCallRound('call_2', 'notes_save', '{"title":"a","content":"b"}') },
      { body: answerRound('已按你的意思取消了。') }
    ])
    const gate = new ApprovalGate()
    const { sink, log } = makeSink((event) => {
      // 界面上的「拒绝」：审批门已武装，这里同步回执即可
      gate.settle(event.callId, false)
    })

    const result = await runAgent(
      runInput({ fetchImpl, tools: [write], sink, gate, permission: 'confirm' })
    )

    expect(log.approvals).toEqual([{ callId: 'call_2', name: 'notes_save', risk: 'write' }])
    expect(writeSpy).not.toHaveBeenCalled()
    expect(log.results[0]).toMatchObject({ ok: false, summary: '用户已拒绝该操作' })
    // 拒绝结果也要回灌给模型，否则它会以为工具成功了
    const second = JSON.parse(bodies[1] ?? '{}') as Record<string, unknown>
    const messages = second['messages'] as Array<Record<string, unknown>>
    expect(String(messages.at(-1)?.['content'])).toContain('拒绝了该操作')
    expect(result.content).toBe('已按你的意思取消了。')
  })

  it('写工具被批准后才真的执行', async () => {
    const { write, writeSpy } = makeTools()
    const { fetchImpl } = scriptedFetch([
      { body: toolCallRound('call_3', 'notes_save', '{"title":"a","content":"b"}') },
      { body: answerRound('已保存。') }
    ])
    const gate = new ApprovalGate()
    const { sink } = makeSink((event) => gate.settle(event.callId, true))

    await runAgent(runInput({ fetchImpl, tools: [write], sink, gate, permission: 'confirm' }))
    expect(writeSpy).toHaveBeenCalledTimes(1)
  })

  it('只读档位下不下发任何写工具', async () => {
    const { write, writeSpy } = makeTools()
    const { fetchImpl, bodies } = scriptedFetch([{ body: answerRound('我不能改。') }])
    const { sink } = makeSink()

    const result = await runAgent(
      runInput({ fetchImpl, tools: [write], sink, permission: 'readonly' })
    )

    expect(writeSpy).not.toHaveBeenCalled()
    expect(result.usedTools).toBe(false)
    expect(JSON.parse(bodies[0] ?? '{}')['tools']).toBeUndefined()
  })

  it('模型指定了不存在的工具时如实告知，不静默忽略', async () => {
    const { read } = makeTools()
    const { fetchImpl } = scriptedFetch([
      { body: toolCallRound('call_4', 'nope_tool', '{}') },
      { body: answerRound('抱歉，我换个方式。') }
    ])
    const { sink, log } = makeSink()

    await runAgent(runInput({ fetchImpl, tools: [read], sink }))
    expect(log.results[0]).toMatchObject({ ok: false, summary: '未知工具：nope_tool' })
  })

  it('工具往返超过上限时报错，避免模型陷入死循环', async () => {
    const { read, readSpy } = makeTools()
    // 脚本只有一条且会被重复使用：模型每轮都要调工具
    const { fetchImpl } = scriptedFetch([
      { body: toolCallRound('call_5', 'notes_list', '{}') }
    ])
    const { sink } = makeSink()

    await expect(runAgent(runInput({ fetchImpl, tools: [read], sink }))).rejects.toThrow(
      /轮次过多/
    )
    expect(readSpy).toHaveBeenCalledTimes(AGENT_MAX_STEPS)
  })

  it('网络错误不触发降级重试（否则用户要白等一整个超时）', async () => {
    const { read } = makeTools()
    const { fetchImpl, bodies } = scriptedFetch([
      { reject: 'Network request failed' },
      { body: answerRound('不该走到这里') }
    ])
    const { sink } = makeSink()
    const notices: string[] = []

    await expect(
      runAgent(runInput({ fetchImpl, tools: [read], sink, onNotice: (m) => notices.push(m) }))
    ).rejects.toThrow(/无法连接 AI 服务/)

    expect(bodies).toHaveLength(1)
    expect(notices).toEqual([])
  })

  it('中止后抛出 AbortError（由网关翻成 stopped，不算错误）', async () => {
    const { read } = makeTools()
    const { fetchImpl } = scriptedFetch([{ body: answerRound('慢慢来') }])
    const controller = new AbortController()
    controller.abort()
    const { sink } = makeSink()

    await expect(
      runAgent(runInput({ fetchImpl, tools: [read], sink, signal: controller.signal }))
    ).rejects.toThrow(/aborted/)
  })
})

describe('looksLikeToolsUnsupported', () => {
  it('只对「工具相关 + 请求无效」同时命中时报真', () => {
    expect(looksLikeToolsUnsupported('This model does not support tools')).toBe(true)
    expect(looksLikeToolsUnsupported('400 invalid request: unknown parameter tools')).toBe(true)
    expect(looksLikeToolsUnsupported('不支持 tools 参数')).toBe(true)
  })

  it('桌面端错误映射出来的中文文案不会误命中', () => {
    expect(looksLikeToolsUnsupported('API Key 无效或没有访问权限')).toBe(false)
    expect(looksLikeToolsUnsupported('没有访问该模型的权限')).toBe(false)
    expect(looksLikeToolsUnsupported('接口地址或模型名称可能不正确')).toBe(false)
    expect(looksLikeToolsUnsupported('请求频率或额度受限，请稍后重试')).toBe(false)
    expect(looksLikeToolsUnsupported('AI 请求超时，请检查网络后重试')).toBe(false)
    expect(looksLikeToolsUnsupported('无法连接 AI 服务，请检查网络或接口地址')).toBe(false)
  })
})
