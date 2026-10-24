import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { CodingAgentError } from './adapter'

/** Codex stdio 使用逐行 JSON-RPC；不假定 ACP 的 jsonrpc 字段存在。 */
export class CodexConnection {
  private sequence = 0
  private buffer = ''
  private closed = false
  private incoming = 0
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: NodeJS.Timeout
    }
  >()

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly notification: (method: string, params: unknown) => void,
    private readonly handler: (method: string, params: unknown) => Promise<unknown>,
    private readonly disconnected: () => void
  ) {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.receive(chunk))
    // 排空而不保存可能包含用户内容、凭据和原生配置的诊断输出。
    child.stderr.on('data', () => undefined)
    child.on('error', () => this.close())
    child.stdin.on('error', () => this.close())
    child.once('exit', () => this.close())
  }

  request(method: string, params: unknown, timeoutMs = 20_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new CodingAgentError('Codex 已断开，请重新连接'))
    if (this.pending.size >= 32)
      return Promise.reject(new CodingAgentError('Codex 请求过多，请稍后再试'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CodingAgentError('Codex 请求超时，结果未知；请核对原生会话，不会自动重发'))
        this.close()
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new CodingAgentError('Codex 连接已结束，未自动重发任务'))
    }
    this.pending.clear()
    this.buffer = ''
    this.child.stdin.end()
    if (this.child.exitCode === null) {
      const timer = setTimeout(() => this.child.kill(), 1500)
      timer.unref()
      this.child.once('exit', () => clearTimeout(timer))
    }
    this.disconnected()
  }

  private write(message: Record<string, unknown>): void {
    if (this.closed) return
    try {
      this.child.stdin.write(JSON.stringify(message) + '\n')
    } catch {
      this.close()
    }
  }

  private receive(chunk: string): void {
    if (this.closed) return
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer) > 2_000_000) return this.close()
    let index: number
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      if (!line.trim()) continue
      let message: Record<string, unknown> | null
      try {
        message = codexObject(JSON.parse(line))
      } catch {
        return this.close()
      }
      if (!message) return this.close()
      if (typeof message.method === 'string') {
        if (typeof message.id === 'number' || typeof message.id === 'string') {
          if (++this.incoming > 32) return this.close()
          void this.respond(message.id, message.method, message.params)
        } else {
          try {
            this.notification(message.method, message.params)
          } catch {
            return this.close()
          }
        }
      } else if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id)
        if (!pending) continue
        clearTimeout(pending.timer)
        this.pending.delete(message.id)
        if (message.error)
          pending.reject(new CodingAgentError('Codex 请求失败，请检查原生登录、模型和项目配置'))
        else if (Object.hasOwn(message, 'result')) pending.resolve(message.result)
        else pending.reject(new CodingAgentError('Codex 返回了无效响应'))
      }
    }
  }

  private async respond(id: number | string, method: string, params: unknown): Promise<void> {
    try {
      this.write({ id, result: await this.handler(method, params) })
    } catch {
      this.write({ id, error: { code: -32601, message: 'Unsupported client request' } })
    } finally {
      --this.incoming
    }
  }
}

/** 外部对象先收窄；不把协议对象直接传到 IPC。 */
export function codexObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function codexText(value: unknown, limit = 200): string {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}
