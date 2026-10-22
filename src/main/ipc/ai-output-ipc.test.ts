import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import type { AiCompletionOptions, AiGateway } from '../services/ai-gateway/ai-gateway'
import type { PasswordAiService } from '../services/password/password-ai-service'
import { registerAiOutputIpc } from './ai-output-ipc'

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  fromWebContents: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      mock.handlers.set(channel, handler)
  },
  BrowserWindow: { fromWebContents: mock.fromWebContents }
}))

function setup() {
  const sender = Object.assign(new EventEmitter(), {
    id: 1,
    mainFrame: {},
    send: vi.fn(),
    isDestroyed: () => false
  })
  const event = { sender, senderFrame: sender.mainFrame }
  const complete = vi.fn(async (_system: string, _user: string, options?: AiCompletionOptions) => {
    options?.onDelta?.('润色 {{context}}')
    return '润色 {{context}}'
  })
  const recognize = vi.fn(async (_text: string, options?: AiCompletionOptions) => {
    options?.onDelta?.('[{"title":"合成账号","account":"fixture","password":"fixture-only"}')
    options?.onDelta?.(']')
    return {
      entries: [
        { title: '合成账号', account: 'fixture', password: 'fixture-only', url: '', remark: '' }
      ],
      skipped: 0
    }
  })
  const pickText = vi.fn(async () => '合成文件内容')
  registerAiOutputIpc({
    gateway: { complete } as unknown as AiGateway,
    passwordAi: { recognize } as unknown as PasswordAiService,
    pickText,
    duplicateKeys: () => new Set(['合成账号 fixture'])
  })
  const invoke = async (channel: string, args: unknown[] = [], context: unknown = event) =>
    mock.handlers.get(channel)!(context, ...args)
  return { complete, recognize, sender, event, pickText, invoke }
}

beforeEach(() => {
  mock.handlers.clear()
  mock.fromWebContents.mockReturnValue({})
})
describe('无会话 AI 流式边界', () => {
  it('拒绝子 frame 和无效输入，不启动请求', async () => {
    const { invoke, event, complete } = setup()
    await expect(
      invoke(IPC.toolsPromptPolish, ['x', 'id'], { ...event, senderFrame: {} })
    ).rejects.toThrow('无权')
    await expect(invoke(IPC.toolsPromptPolish, ['x'.repeat(12001), 'id'])).rejects.toThrow('12000')
    await expect(invoke(IPC.toolsPromptPolish, ['x', 'i'.repeat(65)])).rejects.toThrow('64')
    expect(complete).not.toHaveBeenCalled()
  })
  it('增量仅发给请求窗口，校验完成后返回正文', async () => {
    const { invoke, sender } = setup()
    await expect(invoke(IPC.toolsPromptPolish, ['原文 {{context}}', 'p1'])).resolves.toBe(
      '润色 {{context}}'
    )
    expect(sender.send).toHaveBeenCalledWith(WINDOW_EVENT.aiOutput, {
      kind: 'prompt-polish',
      requestId: 'p1',
      delta: '润色 {{context}}'
    })
    expect(sender.listenerCount('destroyed')).toBe(0)
  })
  it('仅请求窗口能停止，重复请求拒绝，取消后可复用 ID', async () => {
    const { invoke, complete, event } = setup()
    let signal: AbortSignal | undefined
    complete.mockImplementationOnce(
      (_s, _u, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal
          signal?.addEventListener('abort', () => reject(new Error('合成取消诊断')))
        })
    )
    const pending = invoke(IPC.toolsPromptPolish, ['原文 {{context}}', 'p1'])
    await expect(invoke(IPC.toolsPromptPolish, ['原文 {{context}}', 'p2'])).rejects.toThrow(
      '正在生成'
    )
    await invoke(IPC.toolsAiStop, ['p1'], {
      ...event,
      sender: { ...event.sender, id: 2, mainFrame: event.senderFrame }
    })
    expect(signal?.aborted).toBe(false)
    const rejected = expect(pending).rejects.toThrow('已停止')
    await invoke(IPC.toolsAiStop, ['p1'])
    await rejected
    await expect(invoke(IPC.toolsPromptPolish, ['原文 {{context}}', 'p1'])).resolves.toContain(
      '{{context}}'
    )
  })
  it('密码预览在返回前逐条出现，不传明文密码，最终保留重复标记', async () => {
    const { invoke, sender } = setup()
    const result = await invoke(IPC.passwordImportAi, ['a1'])
    const payload = sender.send.mock.calls[0][1]
    expect(payload.entries).toEqual([
      { title: '合成账号', account: 'fixture', url: '', hasPassword: true }
    ])
    expect(JSON.stringify(payload)).not.toContain('fixture-only')
    expect(result).toMatchObject([{ duplicate: true, password: 'fixture-only' }])
  })
  it('页面重载会中止请求并清理监听，系统异常不回显原始数据', async () => {
    const { invoke, complete, recognize, sender } = setup()
    complete.mockImplementationOnce(
      (_s, _u, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('合成底层诊断')))
        })
    )
    const pending = invoke(IPC.toolsPromptPolish, ['合成 {{context}}', 'n1'])
    const rejected = expect(pending).rejects.toThrow('已停止')
    sender.emit('did-start-navigation')
    await rejected
    expect(sender.listenerCount('destroyed')).toBe(0)
    expect(sender.listenerCount('render-process-gone')).toBe(0)
    recognize.mockRejectedValueOnce(new Error('fixture-private-password'))
    await expect(invoke(IPC.passwordImportAi, ['n2'])).rejects.toThrow('AI 处理失败')
  })
})
