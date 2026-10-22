import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import type { AiOutputEvent, PasswordAiPreview } from '../../shared/types'
import { JsonArrayObjectStream, passwordPreview } from '../../shared/ai-output'
import type { AiGateway } from '../services/ai-gateway/ai-gateway'
import { AiGatewayError } from '../services/ai-gateway/errors'
import { DeveloperToolError, PromptPolisher } from '../services/developer-tools'
import { parseAiResponse } from '../services/password/password-ai-service'
import type { PasswordAiService } from '../services/password/password-ai-service'
import { requireString, validatePromptPolishInput } from './validation'

/** 无会话 AI 的请求归属、取消与事件传输；不广播密码数据。 */
export function registerAiOutputIpc(input: {
  gateway: AiGateway
  passwordAi: PasswordAiService
  pickText(): Promise<string | null>
  duplicateKeys(): Set<string>
}): void {
  const active = new Map<
    string,
    { owner: number; kind: AiOutputEvent['kind']; controller: AbortController }
  >()
  const polisher = new PromptPolisher((system, user, options) =>
    input.gateway.complete(system, user, options)
  )
  const guard = (event: IpcMainInvokeEvent): void => {
    if (
      !BrowserWindow.fromWebContents(event.sender) ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error('当前页面无权使用 AI 工具')
  }
  const run = async <T>(
    event: IpcMainInvokeEvent,
    value: unknown,
    kind: AiOutputEvent['kind'],
    action: (signal: AbortSignal, emit: (event: AiOutputEvent) => void, id: string) => Promise<T>
  ): Promise<T> => {
    guard(event)
    // requestId 可选以兼容旧调用；新界面提前分配 id，首个分片抵达前即可关联。
    const id =
      value === undefined ? randomUUID() : requireString(value, '请求 ID', { maxLength: 64 })
    if (
      active.has(id) ||
      [...active.values()].some((item) => item.owner === event.sender.id && item.kind === kind)
    )
      throw new Error('该工具正在生成，请先停止或稍候')
    const controller = new AbortController()
    active.set(id, { owner: event.sender.id, kind, controller })
    const abort = (): void => controller.abort()
    event.sender.once('destroyed', abort)
    event.sender.once('did-start-navigation', abort)
    event.sender.once('render-process-gone', abort)
    try {
      return await action(
        controller.signal,
        (payload) => {
          if (!controller.signal.aborted && !event.sender.isDestroyed())
            event.sender.send(WINDOW_EVENT.aiOutput, payload)
        },
        id
      )
    } catch (error) {
      const message = controller.signal.aborted
        ? '已停止生成，未完成的结果未采用'
        : kind !== 'password-import' &&
            (error instanceof DeveloperToolError || error instanceof AiGatewayError)
          ? error.message
          : 'AI 处理失败，请检查配置、输入内容后重试'
      // 故意不携带 cause：原始异常链可能含密码文本或请求凭据。
      throw new DeveloperToolError(message)
    } finally {
      active.delete(id)
      event.sender.removeListener('destroyed', abort)
      event.sender.removeListener('did-start-navigation', abort)
      event.sender.removeListener('render-process-gone', abort)
    }
  }
  ipcMain.handle(IPC.toolsAiStop, (event, value: unknown) => {
    guard(event)
    const id = requireString(value, '请求 ID', { maxLength: 64 })
    const request = active.get(id)
    if (request?.owner === event.sender.id) request.controller.abort()
  })
  ipcMain.handle(IPC.toolsPromptPolish, (event, text: unknown, requestId: unknown) => {
    guard(event)
    const value = validatePromptPolishInput(text)
    return run(event, requestId, 'prompt-polish', (signal, emit, id) =>
      polisher.polish(value, {
        signal,
        onDelta: (delta) => emit({ kind: 'prompt-polish', requestId: id, delta })
      })
    )
  })
  ipcMain.handle(IPC.passwordImportAi, (event, requestId: unknown) =>
    run(event, requestId, 'password-import', async (signal, emit, id) => {
      const text = await input.pickText()
      signal.throwIfAborted()
      if (text === null) return null
      const parser = new JsonArrayObjectStream()
      let previewCount = 0
      let receivedChars = 0
      const { entries } = await input.passwordAi.recognize(text, {
        signal,
        onDelta: (delta) => {
          const previews: PasswordAiPreview[] = []
          receivedChars += delta.length
          for (const object of parser.push(delta)) {
            try {
              if (previewCount < 200) {
                const items = parseAiResponse(`[${object}]`).map(passwordPreview)
                previews.push(...items)
                previewCount += items.length
              }
            } catch {
              // 未通过解析的对象不进入预览；完整回复仍由 recognize 严格校验。
            }
          }
          emit({ kind: 'password-import', requestId: id, receivedChars, entries: [...previews] })
        }
      })
      signal.throwIfAborted()
      const duplicates = input.duplicateKeys()
      for (const draft of entries) {
        if (draft.account && duplicates.has(`${draft.title} ${draft.account}`))
          draft.duplicate = true
      }
      return entries
    })
  )
}
