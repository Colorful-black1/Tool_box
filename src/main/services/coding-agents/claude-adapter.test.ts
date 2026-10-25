import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeAdapter, type ClaudeSdk } from './claude-adapter'
import type { NativeCodingEvent } from './adapter'

vi.mock('./claude-runtime', () => ({
  bundledClaudeExecutable: vi.fn(async () => '/fixture/claude.exe'),
  inspectClaudeExecutable: vi.fn(async (path: string) => ({ path, version: '2.1.310' }))
}))

const adapters: ClaudeAdapter[] = []
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.disconnect()
})

function channel() {
  const queued: unknown[] = []
  let wake: (() => void) | null = null
  let done = false
  const query = {
    initializationResult: vi.fn(async () => ({})),
    supportedModels: vi.fn(async () => [
      {
        value: 'fixture-model',
        displayName: '模型',
        description: '',
        supportedEffortLevels: ['low', 'high']
      }
    ]),
    close: vi.fn(() => {
      done = true
      wake?.()
    }),
    [Symbol.asyncIterator]: async function* () {
      while (!done) {
        if (queued.length) yield queued.shift() as SDKMessage
        else
          await new Promise<void>((resolve) => {
            wake = resolve
          })
      }
    }
  } as unknown as Query
  return {
    query,
    push: (value: unknown) => {
      queued.push(value)
      wake?.()
    }
  }
}

async function fixture() {
  const queries: ReturnType<typeof channel>[] = []
  const options: Options[] = []
  const sdk: ClaudeSdk = {
    query: vi.fn(({ options: opts }) => {
      const item = channel()
      queries.push(item)
      options.push(opts!)
      return item.query
    }),
    listSessions: vi.fn(async () => [
      { sessionId: 'native-one', summary: '历史', lastModified: 1, cwd: process.cwd() },
      { sessionId: 'foreign', summary: '其他项目', lastModified: 2, cwd: '/other-project' }
    ]),
    getSessionMessages: vi.fn(async () => [
      {
        type: 'assistant' as const,
        uuid: 'old',
        session_id: 'native-one',
        message: { content: [{ type: 'text', text: '历史正文' }] },
        parent_tool_use_id: null,
        parent_agent_id: null
      }
    ])
  }
  const store = { configGet: () => ({}), configSet: vi.fn(() => ({})) }
  const adapter = new ClaudeAdapter(store, async () => sdk)
  adapters.push(adapter)
  const events: NativeCodingEvent[] = []
  adapter.subscribe((event) => events.push(event))
  await adapter.connect(process.cwd())
  const session = await adapter.openSession()
  return { adapter, sdk, store, queries, options, events, session }
}

describe('Claude 官方 SDK 适配器', () => {
  it('迟到初始化不能覆盖新连接的模型；启动失败作为发送失败返回', async () => {
    const f = await fixture()
    const pending = channel()
    let finish!: (models: Awaited<ReturnType<Query['supportedModels']>>) => void
    vi.mocked(pending.query.supportedModels).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    vi.mocked(f.sdk.query).mockReturnValueOnce(pending.query)
    const old = f.adapter.connect(process.cwd()).catch((error: unknown) => error)
    await vi.waitFor(() => expect(pending.query.supportedModels).toHaveBeenCalled())
    f.adapter.disconnect()
    await f.adapter.connect(process.cwd())
    finish([{ value: 'stale-model', displayName: '过期模型', description: '' }])
    expect(await old).toBeInstanceOf(Error)
    const current = await f.adapter.openSession()
    expect(current.options[0].options.some((option) => option.value === 'stale-model')).toBe(false)
    const failed = channel()
    vi.mocked(failed.query.initializationResult).mockRejectedValueOnce(
      new Error('fixture startup failure')
    )
    vi.mocked(f.sdk.query).mockReturnValueOnce(failed.query)
    await expect(f.adapter.send(current.id, '合成请求')).rejects.toThrow('草稿已保留')
    expect(f.events.at(-1)).toMatchObject({
      kind: 'session',
      session: { status: 'error', outcome: 'failed' }
    })
  })
  it('连接仅初始化，历史按项目选择；默认计划模式、不加载 settings、不发送任务', async () => {
    const { adapter, sdk, queries, options, session } = await fixture()
    expect(queries).toHaveLength(1)
    expect(options[0].settingSources).toEqual([])
    expect(options[0].permissionMode).toBe('plan')
    expect(queries[0].query.close).toHaveBeenCalled()
    expect(session.messages).toEqual([])
    expect(await adapter.listSessions()).toEqual([{ id: 'native-one', title: '历史' }])
    await expect(adapter.openSession('foreign')).rejects.toThrow('不属于当前项目')
    expect((await adapter.openSession('native-one')).messages[0].content).toBe('历史正文')
    expect(sdk.query).toHaveBeenCalledTimes(1)
  })
  it('合并真实增量与完整快照，不混入子任务消息；模型和推理选项仅用原生目录', async () => {
    const { adapter, queries, options, session, events } = await fixture()
    await adapter.setOption(session.id, 'model', 'fixture-model')
    await adapter.setOption(session.id, 'effort', 'low')
    await expect(adapter.setOption(session.id, 'effort', 'invented')).rejects.toThrow('不可用')
    await adapter.send(session.id, '合成请求')
    expect(options[1].sessionId).toBe(session.id)
    expect(options[1].effort).toBe('low')
    const push = (value: Record<string, unknown>) =>
      queries[1].push({ session_id: session.id, ...value })
    push({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } })
    push({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '第一' } }
    })
    await vi.waitFor(() =>
      expect(
        events.some(
          (event) =>
            event.kind === 'session' &&
            event.session.messages.some((message) => message.content === '第一')
        )
      ).toBe(true)
    )
    push({
      type: 'stream_event',
      parent_tool_use_id: 'child',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '子任务内容' } }
    })
    push({
      type: 'assistant',
      message: { id: 'm1', content: [{ type: 'text', text: '第一段完整回复' }] }
    })
    push({ type: 'result', subtype: 'success' })
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({ kind: 'session', session: { outcome: 'completed' } })
    )
    const last = events.at(-1)
    if (last?.kind !== 'session') throw new Error('缺少会话事件')
    expect(last.session.messages.filter((item) => item.role === 'assistant')).toEqual([
      { id: 'm1', role: 'assistant', content: '第一段完整回复' }
    ])
  })
  it('单次允许和拒绝、停止审批及迟到回调隔离', async () => {
    const { adapter, session, options, events, sdk } = await fixture()
    await adapter.send(session.id, '合成请求')
    const ask = (name: string) =>
      options[1].canUseTool!(
        name,
        { command: 'fixture', api_key: 'fixture-private' },
        { signal: new AbortController().signal, toolUseID: name, requestId: name }
      )
    const permission = ask('Bash')
    const event = events.at(-1)
    if (event?.kind !== 'session') throw new Error('缺少审批事件')
    const approval = event.session.approvals[0]
    expect(approval.details).not.toContain('fixture-private')
    adapter.approve(session.id, approval.id, true)
    expect(await permission).toMatchObject({ behavior: 'allow' })
    expect(() => adapter.approve(session.id, approval.id, true)).toThrow('失效')
    const denied = ask('Write')
    const pending = events.at(-1)
    if (pending?.kind !== 'session') throw new Error('缺少审批事件')
    adapter.approve(session.id, pending.session.approvals[0].id, false)
    expect(await denied).toMatchObject({ behavior: 'deny' })
    const stopped = ask('Edit')
    adapter.stop(session.id)
    expect(await stopped).toMatchObject({ behavior: 'deny' })
    expect(events.at(-1)).toMatchObject({
      kind: 'session',
      session: { status: 'ready', outcome: 'stopped', approvals: [] }
    })
    expect(await ask('Bash')).toMatchObject({ behavior: 'deny' })
    const prompt = vi.mocked(sdk.query).mock.calls[1][0].prompt
    if (typeof prompt === 'string') throw new Error('必须使用可取消的输入流')
    expect(await prompt[Symbol.asyncIterator]().next()).toMatchObject({ done: true })
  })
  it('结构化问答明确结束，不把布尔允许当作答案；未知终态不冒充完成', async () => {
    const { adapter, session, options, events } = await fixture()
    await adapter.send(session.id, '合成请求')
    expect(
      await options[1].canUseTool!(
        'AskUserQuestion',
        {},
        { signal: new AbortController().signal, toolUseID: 'question', requestId: 'question' }
      )
    ).toMatchObject({ behavior: 'deny', interrupt: true })
    expect(events.at(-1)).toMatchObject({
      kind: 'session',
      session: { outcome: 'stopped', error: expect.stringContaining('结构化问答') }
    })
  })
})
