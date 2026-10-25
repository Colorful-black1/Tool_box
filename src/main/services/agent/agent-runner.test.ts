import { createServer } from 'node:http'
import type { Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { ChatOpenAI } from '@langchain/openai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as z from 'zod'

import type { ChatMessage } from '../../../shared/types'
import { ApprovalGate } from './approval-gate'
import { runAgent } from './agent-runner'
import type { AgentToolSink } from './agent-runner'
import type { AgentToolDefinition } from './tool-registry'

/** 以 SSE 形式写出一段 OpenAI 流式响应 */
function writeSse(response: ServerResponse, chunks: object[]): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  }
  response.write('data: [DONE]\n\n')
  response.end()
}

function chunk(delta: object, finishReason: string | null): object {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  }
}

/** 第一轮返回工具调用，第二轮返回最终回答 */
function createMockServer(): { server: Server; baseUrl: () => string } {
  let round = 0
  const server = createServer((_request, response) => {
    round += 1
    if (round === 1) {
      writeSse(response, [
        chunk(
          {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call_echo',
                type: 'function',
                function: { name: 'echo', arguments: '{"text":"hi"}' }
              }
            ]
          },
          null
        ),
        chunk({}, 'tool_calls')
      ])
      return
    }
    writeSse(response, [
      chunk({ role: 'assistant', content: '已完成' }, null),
      chunk({}, 'stop')
    ])
  })
  return {
    server,
    baseUrl: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  }
}

function history(content: string): ChatMessage[] {
  return [
    { id: 'm1', conversationId: 'c1', role: 'user', content, createdAtMs: 0 }
  ]
}

const echoTool: AgentToolDefinition = {
  name: 'echo',
  description: '回显文本',
  schema: z.object({ text: z.string() }),
  risk: 'read',
  handler: async (input) => {
    return { echoed: String(input.text ?? '') }
  }
}

describe('runAgent', () => {
  let server: Server
  let baseUrl: string
  let executed: string[]

  beforeEach(async () => {
    executed = []
    const mock = createMockServer()
    server = mock.server
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = mock.baseUrl()
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function model(): ChatOpenAI {
    return new ChatOpenAI({
      apiKey: 'sk-test',
      model: 'test-model',
      configuration: { baseURL: baseUrl }
    })
  }

  function collect(): { sink: AgentToolSink; deltas: string[]; calls: string[] } {
    const deltas: string[] = []
    const calls: string[] = []
    const sink: AgentToolSink = {
      onToolCall: (event) => calls.push(event.name),
      onToolResult: () => undefined,
      onToolApprovalRequest: () => undefined
    }
    return { sink, deltas, calls }
  }

  it('执行只读工具并流式返回最终回答', async () => {
    const { sink, deltas, calls } = collect()
    const tool: AgentToolDefinition = {
      ...echoTool,
      references: () => [{ label: '合成笔记', target: { kind: 'note', id: 'n1' } }],
      handler: async (input) => {
        executed.push(String(input.text ?? ''))
        return { echoed: String(input.text ?? '') }
      }
    }

    const result = await runAgent({
      conversationId: 'c1',
      history: history('回显 hi'),
      model: model(),
      systemPrompt: '你是测试助手',
      tools: [tool],
      permission: 'full',
      gate: new ApprovalGate(),
      sink,
      onDelta: (text) => deltas.push(text),
      signal: new AbortController().signal
    })

    expect(result.usedTools).toBe(true)
    expect(result.references).toEqual([{ label: '合成笔记', target: { kind: 'note', id: 'n1' } }])
    expect(executed).toEqual(['hi'])
    expect(calls).toEqual(['echo'])
    expect(deltas.join('')).toContain('已完成')
    expect(result.content).toContain('已完成')
  })

  it('confirm 档位下写工具需用户批准后才执行', async () => {
    const { sink, calls } = collect()
    const gate = new ApprovalGate()
    const writeTool: AgentToolDefinition = {
      ...echoTool,
      risk: 'write',
      handler: async (input) => {
        executed.push(String(input.text ?? ''))
        return { echoed: String(input.text ?? '') }
      }
    }

    // 收到审批请求后批准
    const approvingSink: AgentToolSink = {
      ...sink,
      onToolApprovalRequest: (event) => {
        setTimeout(() => gate.settle(event.callId, true), 0)
      }
    }

    await runAgent({
      conversationId: 'c1',
      history: history('回显 hi'),
      model: model(),
      systemPrompt: '你是测试助手',
      tools: [writeTool],
      permission: 'confirm',
      gate,
      sink: approvingSink,
      onDelta: () => undefined,
      signal: new AbortController().signal
    })

    expect(calls).toEqual(['echo'])
    expect(executed).toEqual(['hi'])
  })

  it('confirm 档位下用户拒绝则工具不执行', async () => {
    const { sink } = collect()
    const gate = new ApprovalGate()
    const writeTool: AgentToolDefinition = {
      ...echoTool,
      risk: 'destructive',
      handler: async (input) => {
        executed.push(String(input.text ?? ''))
        return { echoed: String(input.text ?? '') }
      }
    }

    const denyingSink: AgentToolSink = {
      ...sink,
      onToolApprovalRequest: (event) => {
        setTimeout(() => gate.settle(event.callId, false), 0)
      }
    }

    await runAgent({
      conversationId: 'c1',
      history: history('回显 hi'),
      model: model(),
      systemPrompt: '你是测试助手',
      tools: [writeTool],
      permission: 'confirm',
      gate,
      sink: denyingSink,
      onDelta: () => undefined,
      signal: new AbortController().signal
    })

    expect(executed).toEqual([])
  })
})
