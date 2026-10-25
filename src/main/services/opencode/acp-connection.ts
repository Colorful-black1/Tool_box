import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { StdioRpcConnection } from '../coding-agents/stdio-rpc-connection'
import { OpenCodeError } from './opencode-error'

export { acpObject } from '../coding-agents/stdio-rpc-connection'

/** 兼容原 OpenCode 文案与退出策略；通用传输不依赖具体 Agent。 */
export class AcpConnection extends StdioRpcConnection {
  constructor(
    child: ChildProcessWithoutNullStreams,
    notification: (method: string, params: unknown) => void,
    requestHandler: (method: string, params: unknown) => Promise<unknown>,
    disconnected: () => void
  ) {
    super(
      child,
      notification,
      requestHandler,
      disconnected,
      'OpenCode',
      (message) => new OpenCodeError(message)
    )
  }
}
