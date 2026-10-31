/** 仅本次运行的纯文本历史，无来源进程与磁盘持久化。 */
export interface ClipboardHistoryEntry {
  id: string
  text: string
  preview: string
  capturedAtMs: number
  pinned: boolean
  truncated: boolean
}

/** 忽略规则也仅存在内存；更改规则使用同一个启用配置通道。 */
export interface ClipboardHistoryConfig {
  enabled: boolean
  keywords: string[]
  prefixes: string[]
}

/** 单调修订号防止旧请求覆盖较新的推送。 */
export interface ClipboardHistorySnapshot extends ClipboardHistoryConfig {
  entries: ClipboardHistoryEntry[]
  pausedUntilMs: number
  revision: number
  error: string
}
