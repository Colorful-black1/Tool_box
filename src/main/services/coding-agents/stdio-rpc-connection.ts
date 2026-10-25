import { CodingAgentError } from './adapter'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

type JsonObject = Record<string, unknown>

/** 外部 ACP 消息只在边界收窄，错误不透传第三方正文或 stderr。 */
export function acpObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

/** 一个自有子进程的 JSON-RPC 连接，支持拆包、请求关联、限额与有界退出。 */
export class StdioRpcConnection {
  private sequence = 0
  private buffer = ''
  private closed = false
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }
  >()

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly notification: (method: string, params: unknown) => void,
    private readonly requestHandler: (method: string, params: unknown) => Promise<unknown>,
    private readonly disconnected: () => void,
    private readonly runtimeName = 'Agent',
    private readonly makeError: (message: string) => Error = (message) =>
      new CodingAgentError(message),
    private readonly exitGraceMs = 1500
  ) {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.receive(chunk))
    // 仅排空诊断管道，不保留可能含路径、凭据或用户内容的原始 stderr。
    child.stderr.on('data', () => undefined)
    child.on('error', () => this.close())
    child.stdin.on('error', () => this.close())
    child.once('exit', () => this.close())
  }

  request(method: string, params: unknown, timeoutMs = 20_000): Promise<unknown> {
    if (this.closed) return Promise.reject(this.makeError(`${this.runtimeName} 已断开，请重新连接`))
    if (this.pending.size >= 32)
      return Promise.reject(this.makeError(`${this.runtimeName} 请求过多，请稍后再试`))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(this.makeError(`${this.runtimeName} 请求超时；任务结果未知，请检查后再操作`))
        this.close()
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    if (!this.closed) this.write({ jsonrpc: '2.0', method, params })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(this.makeError(`${this.runtimeName} 连接已结束，未自动重发任务`))
    }
    this.pending.clear()
    this.buffer = ''
    this.child.stdin.end()
    if (this.child.exitCode === null) {
      const timer = setTimeout(() => this.child.kill(), this.exitGraceMs)
      timer.unref()
      this.child.once('exit', () => clearTimeout(timer))
    }
    this.disconnected()
  }

  private write(message: JsonObject): void {
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
      let message: JsonObject | null
      try {
        message = acpObject(JSON.parse(line))
      } catch {
        return this.close()
      }
      if (!message || message.jsonrpc !== '2.0') return this.close()
      if (typeof message.method === 'string') {
        if (typeof message.id === 'number' || typeof message.id === 'string') {
          void this.handleRequest(message.id, message.method, message.params)
        } else {
          try {
            this.notification(message.method, message.params)
          } catch {
            this.close()
          }
        }
      } else if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id)
        if (!pending) continue
        clearTimeout(pending.timer)
        this.pending.delete(message.id)
        if (message.error)
          pending.reject(this.makeError(`${this.runtimeName} 请求失败，请检查登录、模型和项目配置`))
        else if (Object.hasOwn(message, 'result')) pending.resolve(message.result)
        else pending.reject(this.makeError(`${this.runtimeName} 返回了无效响应`))
      }
    }
  }

  private async handleRequest(id: number | string, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.requestHandler(method, params)
      this.write({ jsonrpc: '2.0', id, result })
    } catch {
      this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unsupported request' } })
    }
  }
}
