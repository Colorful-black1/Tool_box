/** 原生上下文快照；累计消耗不得用作当前窗口占用。 */
export interface AgentContextUsage {
  usedTokens: number
  windowTokens: number | null
  source: 'acp' | 'codex' | 'claude'
  approximate: boolean
  measuredAt: number
  windowKind: 'context' | 'compaction'
  model?: string
  stale?: boolean
}

/** 只记录本轮本地观测时间，旧历史没有时间时不补造。 */
export interface AgentTurnTiming {
  startedAt: number
  finishedAt?: number
  elapsedMs?: number
}

/** 可由客户端呈现的受限原生问题，不透传任意 JSON schema。 */
export interface AgentQuestion {
  id: string
  title: string
  text: string
  multiple: boolean
  allowText: boolean
  options: Array<{ label: string; description: string }>
}

/** 请求仅在其所属原生运行期有效，id 是不透明的本地引用。 */
export interface AgentQuestionRequest {
  id: string
  kind: 'questions' | 'plan'
  title: string
  questions: AgentQuestion[]
}

/** 答案逐题校验；取消不等于选择默认选项。 */
export interface AgentQuestionAnswer {
  requestId: string
  cancelled: boolean
  answers: Array<{ questionId: string; values: string[] }>
}
