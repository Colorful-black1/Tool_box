/** 注入 fetch 便于单测；生产环境由主进程传入 Electron net.fetch。 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** 面向用户的抓取错误；message 已经是可展示文案，不携带 HTML / 响应体。 */
export class TrendingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TrendingError'
  }
}

/** 把超时 / 网络错误 / HTTP 状态收敛成短文案，避免 IPC 暴露内部细节。 */
export function describeTrendingError(error: unknown): string {
  if (error instanceof TrendingError) return error.message
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError')
      return '连接 GitHub 超时，请检查网络或代理后重试'
    if (error.name === 'TypeError') return '无法连接 GitHub，请检查网络后重试'
  }
  return '读取 GitHub 热榜失败，请稍后重试'
}
