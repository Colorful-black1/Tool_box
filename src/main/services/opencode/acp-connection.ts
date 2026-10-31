import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { acpObject, StdioRpcConnection } from '../coding-agents/stdio-rpc-connection'
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

  /** 只识别已知错误标记，不把上游正文、请求内容或凭据透传给界面。 */
  protected requestError(error: unknown): Error {
    const value = acpObject(error)
    const data = acpObject(value?.data)
    const details = [value?.message, data?.message, data?.details]
    if (
      details.some(
        (detail) => typeof detail === 'string' && /\bInsufficient account funds\b/i.test(detail)
      )
    )
      return new OpenCodeError(
        'OpenCode 当前模型供应商返回账户余额不足。请检查该供应商的余额与计费状态，或切换其他可用供应商／模型；未自动重发'
      )
    const trainingBlocked = details.some(
      (detail) =>
        typeof detail === 'string' &&
        (detail.includes('Account.TrainingNotAllowed') ||
          detail.includes('This Go model trains on request data.'))
    )
    return trainingBlocked
      ? new OpenCodeError(
          'OpenCode Go 的工作区隐私设置不允许当前模型使用请求数据训练。请更换模型，或自行在 OpenCode 控制台「Settings → Privacy」确认是否允许；未自动重发'
        )
      : super.requestError(error)
  }
}
