import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeAdapter, type ClaudeSdk } from './claude-adapter'
import type { NativeCodingEvent } from './adapter'
import type { ClaudeProviderSettings } from './claude-provider-settings'
import type { DesktopCodeSession } from './claude-desktop-history'

vi.mock('./claude-desktop-history', () => ({
  readDesktopCodeSessions: vi.fn(async () => []),
  assertDesktopCodeIdle: vi.fn(async () => undefined)
}))

vi.mock('./claude-runtime', () => ({
  bundledClaudeExecutable: vi.fn(async () => '/fixture/claude.exe'),
  inspectClaudeExecutable: vi.fn(async (path: string) => ({ path, version: '2.1.310' }))
}))

const adapters: ClaudeAdapter[] = []
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.disconnect()
  vi.unstubAllEnvs()
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

async function fixture(
  provider: ClaudeProviderSettings = { env: {} },
  id: 'claude' | 'claude-desktop' = 'claude',
  initialConfig: Record<string, unknown> = {}
) {
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
  let config = structuredClone(initialConfig)
  const store = {
    configGet: () => config,
    configSet: vi.fn((patch: Record<string, unknown>) => {
      config = { ...config, ...patch }
      return structuredClone(config)
    })
  }
  const readProvider = vi.fn(async () => structuredClone(provider))
  const readDesktopHistory = vi.fn(async (): Promise<DesktopCodeSession[]> => [])
  const assertDesktopIdle = vi.fn(async (): Promise<void> => undefined)
  const adapter = new ClaudeAdapter(
    store,
    async () => sdk,
    readProvider,
    id,
    readDesktopHistory,
    assertDesktopIdle
  )
  adapters.push(adapter)
  const events: NativeCodingEvent[] = []
  adapter.subscribe((event) => events.push(event))
  await adapter.connect(process.cwd())
  const session = await adapter.openSession()
  return {
    adapter,
    sdk,
    store,
    queries,
    options,
    events,
    session,
    readProvider,
    readDesktopHistory,
    assertDesktopIdle
  }
}

describe('Claude 官方 SDK 适配器', () => {
  it.each(['auto', 'default', 'acceptEdits', 'plan'] as const)(
    '按用户选择传递原生 %s 模式，不开启 Bypass',
    async (mode) => {
      const f = await fixture()
      await f.adapter.setOption(f.session.id, 'permission', mode)
      await expect(
        f.adapter.setOption(f.session.id, 'permission', 'bypassPermissions')
      ).rejects.toThrow('不可用')
      await f.adapter.send(f.session.id, '合成任务')
      expect(f.options[1].permissionMode).toBe(mode)
      expect(f.options[1].allowDangerouslySkipPermissions).not.toBe(true)
    }
  )
  it('空闲重读正文保留模式与模型，运行中不允许刷新覆盖会话', async () => {
    const f = await fixture()
    const first = await f.adapter.openSession('native-one')
    await f.adapter.setOption(first.id, 'permission', 'acceptEdits')
    await f.adapter.setOption(first.id, 'model', 'fixture-model')
    const records = await f.sdk.getSessionMessages(first.id)
    records[0].message = { content: [{ type: 'text', text: '外部新增正文' }] }
    vi.mocked(f.sdk.getSessionMessages).mockResolvedValueOnce(records)
    const fresh = await f.adapter.openSession(first.id)
    expect(fresh.messages[0].content).toBe('外部新增正文')
    expect(fresh.options.find((item) => item.id === 'permission')?.currentValue).toBe('acceptEdits')
    expect(fresh.options.find((item) => item.id === 'model')?.currentValue).toBe('fixture-model')
    await f.adapter.send(first.id, '合成任务')
    await expect(f.adapter.openSession(first.id)).rejects.toThrow('先停止任务')
  })
  it('原生 Auto 降为 Manual 时同步实际模式并提示，不冒充仍在 Auto', async () => {
    const f = await fixture()
    await f.adapter.setOption(f.session.id, 'permission', 'auto')
    await f.adapter.send(f.session.id, '合成任务')
    f.queries[1].push({
      type: 'system',
      subtype: 'status',
      session_id: f.session.id,
      permissionMode: 'default'
    })
    await vi.waitFor(() =>
      expect(f.events.at(-1)).toMatchObject({
        kind: 'session',
        session: {
          error: expect.stringContaining('所选模式未生效'),
          options: expect.arrayContaining([
            expect.objectContaining({ id: 'permission', currentValue: 'default' })
          ])
        }
      })
    )
  })
  const nativeId = '00000000-0000-4000-8000-000000000003'
  const native = (): DesktopCodeSession => ({
    id: nativeId,
    title: 'Desktop 原有标题',
    directory: process.cwd(),
    resumable: true
  })
  const original = async () => {
    const f = await fixture({ env: {} }, 'claude-desktop')
    f.readDesktopHistory.mockResolvedValue([native()])
    vi.mocked(f.sdk.listSessions).mockResolvedValue([
      { sessionId: nativeId, summary: 'SDK 标题', lastModified: 1, cwd: process.cwd() },
      { sessionId: 'code-only', summary: 'Code 标题', lastModified: 2, cwd: process.cwd() }
    ])
    return f
  }
  it('发现原 Desktop Code 历史，以 CLI ID 读取和续接，不查询原进程或复制成新会话', async () => {
    const f = await original()
    expect(await f.adapter.listSessions()).toEqual([{ id: nativeId, title: 'Desktop 原有标题' }])
    const restored = await f.adapter.openSession(nativeId)
    expect(restored.messages[0].content).toBe('历史正文')
    expect(f.sdk.getSessionMessages).toHaveBeenCalledWith(nativeId, {
      dir: process.cwd(),
      limit: 201
    })
    expect(f.queries).toHaveLength(1)
    expect(f.assertDesktopIdle).not.toHaveBeenCalled()
    await f.adapter.send(restored.id, '在原上下文继续')
    expect(f.assertDesktopIdle).toHaveBeenCalledOnce()
    expect(f.options[1].resume).toBe(nativeId)
    expect(f.options[1].sessionId).toBeUndefined()
    expect(f.options[1].permissionMode).toBe('plan')
    expect(f.store.configGet().claudeDesktop).not.toHaveProperty('sessionIds')
  })
  it('Code 不混入 Desktop 原生会话；归档和缺少实际 SDK 记录的描述不成为可续接历史', async () => {
    const f = await original()
    const code = new ClaudeAdapter(
      f.store,
      async () => f.sdk,
      async () => ({ env: {} }),
      'claude',
      f.readDesktopHistory
    )
    adapters.push(code)
    await code.connect(process.cwd())
    expect(await code.listSessions()).toEqual([{ id: 'code-only', title: 'Code 标题' }])
    f.readDesktopHistory.mockResolvedValue([
      { ...native(), resumable: false },
      { ...native(), id: '00000000-0000-4000-8000-000000000099' }
    ])
    expect(await f.adapter.listSessions()).toEqual([])
    await expect(f.adapter.openSession(nativeId)).rejects.toThrow('不属于当前项目')
  })
  it('原进程未退出、描述移除或变为不可续接时拒绝发送，保留原生身份', async () => {
    const f = await original()
    const restored = await f.adapter.openSession(nativeId)
    f.assertDesktopIdle.mockRejectedValueOnce(new Error('请完整退出 Claude Desktop'))
    await expect(f.adapter.send(restored.id, '合成任务')).rejects.toThrow('完整退出')
    expect(f.queries).toHaveLength(1)
    f.readDesktopHistory.mockResolvedValueOnce([])
    await expect(f.adapter.send(restored.id, '合成任务')).rejects.toThrow('原会话已失效')
    expect(f.queries).toHaveLength(1)
    f.readDesktopHistory.mockResolvedValueOnce([{ ...native(), resumable: false }])
    await expect(f.adapter.send(restored.id, '合成任务')).rejects.toThrow('本次未发送')
    expect(f.queries).toHaveLength(1)
    await f.adapter.send(restored.id, '用户明确重试')
    expect(f.options[1].resume).toBe(nativeId)
  })
  it('原生续接检查期间停止，不迟到创建 SDK 任务；普通 SDK 新会话不增加进程门', async () => {
    const f = await original()
    const restored = await f.adapter.openSession(nativeId)
    let finish!: () => void
    f.assertDesktopIdle.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const pending = f.adapter.send(restored.id, '合成任务')
    await vi.waitFor(() => expect(f.assertDesktopIdle).toHaveBeenCalledOnce())
    f.adapter.stop(restored.id)
    finish()
    await expect(pending).rejects.toThrow('草稿已保留')
    expect(f.queries).toHaveLength(1)
    const fresh = await f.adapter.openSession()
    await f.adapter.send(fresh.id, '新的 SDK 任务')
    expect(f.assertDesktopIdle).toHaveBeenCalledOnce()
    expect(f.options[1].sessionId).toBe(fresh.id)
  })
  it('Desktop 独立读取网关模型和偏好，清理继承的 Code 路由、认证与云端模式', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-code-key')
    vi.stubEnv('ANTHROPIC_MODEL', 'code-model')
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'code-sonnet')
    vi.stubEnv('ANTHROPIC_CUSTOM_HEADERS', 'Authorization: fixture-code-key')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'fixture-oauth-token')
    vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '1')
    const provider = {
      env: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:43210/claude-desktop',
        ANTHROPIC_AUTH_TOKEN: 'fixture-desktop-key'
      },
      model: 'desktop-model',
      models: [{ value: 'desktop-model', label: 'Desktop 供应商模型' }]
    }
    const f = await fixture(provider, 'claude-desktop', {
      claude: { executablePath: '/fixture/code/claude.exe', directory: '/fixture/code' }
    })
    expect(f.options[0].env).toMatchObject(provider.env)
    for (const key of [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_CUSTOM_HEADERS',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_USE_BEDROCK'
    ])
      expect(f.options[0].env).not.toHaveProperty(key)
    expect(f.options[0].model).toBe('desktop-model')
    const info = await f.adapter.inspect()
    expect(info.runtimeId).toBe('claude-desktop')
    expect(info.capabilities.desktopHistory).toBe('supported')
    expect(info.visibleModelIds).toEqual(['native-default', 'desktop-model'])
    expect(f.queries[0].query.supportedModels).not.toHaveBeenCalled()
    expect(f.session.options[0].options).toContainEqual({
      value: 'desktop-model',
      label: 'Desktop 供应商模型'
    })
    await f.adapter.selectExecutable('/fixture/desktop/claude.exe')
    expect(f.store.configGet().claude).toEqual({
      executablePath: '/fixture/code/claude.exe',
      directory: '/fixture/code'
    })
    expect(f.store.configGet().claudeDesktop).toMatchObject({
      executablePath: '/fixture/desktop/claude.exe',
      directory: process.cwd()
    })
    expect(JSON.stringify(f.store.configGet())).not.toContain('fixture-desktop-key')
    expect(JSON.stringify(f.events)).not.toContain('fixture-desktop-key')
  })

  it('Desktop 下次发送重读路由；显式模型移除后不发送，也不自动改用其他模型', async () => {
    const provider = {
      env: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:43210/claude-desktop',
        ANTHROPIC_AUTH_TOKEN: 'fixture-desktop-key'
      },
      model: 'first-model',
      models: [{ value: 'first-model', label: '第一个模型' }]
    }
    const f = await fixture(provider, 'claude-desktop')
    await f.adapter.setOption(f.session.id, 'model', 'first-model')
    provider.model = 'second-model'
    provider.models = [{ value: 'second-model', label: '第二个模型' }]
    await expect(f.adapter.send(f.session.id, '合成请求')).rejects.toThrow('同步模型')
    expect(f.queries).toHaveLength(1)
    await f.adapter.setOption(f.session.id, 'model', 'native-default')
    provider.env.ANTHROPIC_BASE_URL = 'https://new-gateway.example.test'
    await f.adapter.send(f.session.id, '显式采用新配置')
    expect(f.options[1].model).toBe('second-model')
    expect(f.options[1].env?.ANTHROPIC_BASE_URL).toBe('https://new-gateway.example.test')
  })

  it('Code 和 Desktop 按 SDK 会话来源隔离历史；不能跨入口恢复原生 ID', async () => {
    const f = await fixture({ env: {} }, 'claude-desktop')
    await f.adapter.send(f.session.id, '合成 Desktop 任务')
    f.adapter.stop(f.session.id)
    expect(f.store.configGet().claudeDesktop).toMatchObject({ sessionIds: [f.session.id] })
    vi.mocked(f.sdk.listSessions).mockResolvedValue([
      { sessionId: 'native-one', summary: 'Code 历史', lastModified: 1, cwd: process.cwd() },
      { sessionId: f.session.id, summary: 'Desktop 入口历史', lastModified: 2, cwd: process.cwd() }
    ])
    const code = new ClaudeAdapter(f.store, async () => f.sdk, async () => ({ env: {} }))
    adapters.push(code)
    await code.connect(process.cwd())
    expect(await code.listSessions()).toEqual([{ id: 'native-one', title: 'Code 历史' }])
    expect(await f.adapter.listSessions()).toEqual([{ id: f.session.id, title: 'Desktop 入口历史' }])
    await expect(code.openSession(f.session.id)).rejects.toThrow('不属于当前项目')
    await expect(f.adapter.openSession('native-one')).rejects.toThrow('不属于当前项目')
    expect(f.sdk.getSessionMessages).not.toHaveBeenCalled()
    const restarted = new ClaudeAdapter(
      f.store,
      async () => f.sdk,
      async () => ({ env: {} }),
      'claude-desktop'
    )
    adapters.push(restarted)
    await restarted.connect(process.cwd())
    expect(await restarted.listSessions()).toEqual(await f.adapter.listSessions())
  })

  it('来源索引损坏或持久化失败时不混合历史、不启动无归属任务', async () => {
    const f = await fixture({ env: {} }, 'claude-desktop', {
      claudeDesktop: { sessionIds: 'broken' }
    })
    await expect(f.adapter.listSessions()).rejects.toThrow('原有记录已保留')
    await expect(f.adapter.send(f.session.id, '合成任务')).rejects.toThrow('原有记录已保留')
    expect(f.queries).toHaveLength(1)
    f.store.configSet({ claudeDesktop: {} })
    f.store.configSet.mockImplementationOnce(() => {
      throw new Error('fixture-index-write-failed')
    })
    await expect(f.adapter.send(f.session.id, '合成任务')).rejects.toThrow(
      'fixture-index-write-failed'
    )
    expect(f.queries).toHaveLength(1)
  })

  it('连接与发送沿用用户路由，切换供应商后重读；显式模型优先且凭据不落库', async () => {
    const provider = {
      env: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:43210',
        ANTHROPIC_AUTH_TOKEN: 'fixture-private-provider-token',
        ANTHROPIC_MODEL: 'route-model'
      },
      model: 'user-model'
    }
    const f = await fixture(provider)
    expect(f.options[0].env).toMatchObject(provider.env)
    expect(f.options[0].settingSources).toEqual([])
    expect(f.options[0].model).toBe('route-model')
    provider.env.ANTHROPIC_MODEL = 'next-model'
    await f.adapter.send(f.session.id, '合成请求')
    expect(f.options[1].model).toBe('next-model')
    f.adapter.stop(f.session.id)
    await f.adapter.setOption(f.session.id, 'model', 'fixture-model')
    await f.adapter.send(f.session.id, '第二条合成请求')
    expect(f.options[2].model).toBe('fixture-model')
    expect(f.readProvider).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(f.store.configSet.mock.calls)).not.toContain(
      'fixture-private-provider-token'
    )
    expect(JSON.stringify(f.events)).not.toContain('fixture-private-provider-token')
  })
  it('读取路由期间停止或断开不会迟到启动任务，重复发送不并发', async () => {
    const f = await fixture()
    let finish!: (value: ClaudeProviderSettings) => void
    f.readProvider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = f.adapter.send(f.session.id, '合成请求')
    await expect(f.adapter.send(f.session.id, '重复请求')).rejects.toThrow('正在执行')
    f.adapter.stop(f.session.id)
    finish({ env: {} })
    await expect(pending).rejects.toThrow('停止准备')
    expect(f.queries).toHaveLength(1)
    f.readProvider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const disconnected = f.adapter.send(f.session.id, '准备断开')
    f.adapter.disconnect()
    finish({ env: {} })
    await expect(disconnected).rejects.toThrow('草稿已保留')
    expect(f.queries).toHaveLength(1)
  })
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
