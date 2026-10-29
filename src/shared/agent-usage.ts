/** 统计来源独立于可聊天的运行时，新增采集器不授予执行能力。 */
export const USAGE_CLIENTS = {
  codex: 'Codex',
  opencode: 'OpenCode',
  claude: 'Claude Code',
  kimi: 'Kimi Code',
  pi: 'Pi',
  workbuddy: 'WorkBuddy',
  dsh: 'DeepSeek Harness',
  zcode: 'ZCode',
  gemini: 'Gemini CLI',
  copilot: 'GitHub Copilot',
  grok: 'Grok CLI',
  mimocode: 'MiMoCode',
  mcode: 'MCode',
  cline: 'Cline'
} as const

export type UsageClient = keyof typeof USAGE_CLIENTS

/** 空值代表未知；input 是未缓存输入，reasoning 可能属于 output，不能再次求和。 */
export interface UsageTokens {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
  reasoning: number | null
  total: number | null
}

/** 明细排序字段；只允许这些列，避免把任意字段名传进主进程。 */
export const USAGE_SORT_KEYS = [
  'time',
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'reasoning',
  'total',
  'cost'
] as const
export type UsageSortKey = (typeof USAGE_SORT_KEYS)[number]

/** 日期为本地日历日期，结束日包含整日；不带日期时包含时间未知的记录。 */
export interface UsageQuery {
  client?: UsageClient
  project?: string
  model?: string
  from?: string
  to?: string
  offset?: number
  /** 单页条数；主进程会再收一次上限，导出时分页取全量。 */
  limit?: number
  sort?: UsageSortKey
  desc?: boolean
  refresh?: boolean
}

/** 来源状态不把未安装、无法解析和零用量混为一谈。 */
export interface UsageSourceView {
  client: UsageClient
  paths: string[]
  custom: boolean
  status: 'ready' | 'missing' | 'empty' | 'partial' | 'error'
  detail: string
  records: number
  /** 上次扫描耗时（毫秒）；从缓存恢复时为上次记录值。 */
  durationMs: number
}

/** 费用只来自原生上报；reported / total 表示覆盖度，未上报不代表免费。 */
export interface UsageCost {
  usd: number | null
  reported: number
  total: number
}

/** 仅统计元数据；不传递会话正文、标题或认证字段。 */
export interface UsageSessionView {
  client: UsageClient
  sessionId: string
  project: string
  model: string
  time: number | null
  tokens: UsageTokens
  requests: number | null
  /** 原生上报花费（USD）；没有上报时为 null。 */
  costUsd: number | null
  /** 同一会话里只有部分记录带花费。 */
  costPartial: boolean
  partial: boolean
}

/** 模型 / 项目等维度的用量排行，按总量降序取前若干项。 */
export interface UsageBreakdown {
  key: string
  tokens: UsageTokens
  costUsd: number | null
  costPartial: boolean
  requests: number | null
  sessions: number
}

/** 每日趋势按 Agent 堆叠；日期只是本地日历日期。 */
export interface UsageDaily {
  date: string
  total: number | null
  clients: { client: UsageClient; total: number | null }[]
  /** 当天各模型的已知用量；可选以兼容旧统计结果，空模型名仍表示未知。 */
  models?: { model: string; total: number | null }[]
}

/** 所有聚合使用同一筛选条件，空时间和缺失字段有独立提示。 */
export interface UsageReport {
  scannedAt: number
  sources: UsageSourceView[]
  tokens: UsageTokens
  cost: UsageCost
  requests: number | null
  sessions: number
  partial: boolean
  unknownTime: number
  projects: string[]
  models: string[]
  byClient: { client: UsageClient; tokens: UsageTokens; costUsd: number | null }[]
  byModel: UsageBreakdown[]
  byProject: UsageBreakdown[]
  daily: UsageDaily[]
  /** 趋势按 Agent / 项目 / 模型筛选统计，不受日期范围限制，供 7/30/90 天切换。 */
  trend: UsageDaily[]
  rows: UsageSessionView[]
  rowCount: number
}
