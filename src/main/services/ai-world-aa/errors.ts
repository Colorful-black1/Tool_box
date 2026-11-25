/** Artificial Analysis 抓取 / Key 管理错误；message 已是可展示文案。 */
export class AiWorldAaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AiWorldAaError'
  }
}
