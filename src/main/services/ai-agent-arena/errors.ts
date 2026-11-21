/** Agent 榜抓取错误；message 是可展示文案，不携带页面正文或异常栈。 */
export class AiAgentArenaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AiAgentArenaError'
  }
}
