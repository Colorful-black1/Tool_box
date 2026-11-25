import type { FetchLike } from '../github-trending/fetch'
import {
  AI_WORLD_AA_API_BASE,
  AI_WORLD_AA_MAX_PAGES
} from '../../../shared/ai-world-aa'
import type { AiWorldAaModel } from '../../../shared/ai-world-aa'
import { AiWorldAaError } from './errors'
import { parseAiWorldAaPage } from './parse'

const MAX_PAGE_BYTES = 8 * 1024 * 1024

export interface AaQuota {
  remaining: number | null
  resetAt: string | null
}

export interface AaFetchResult {
  models: AiWorldAaModel[]
  intelligenceIndexVersion: number | null
  quota: AaQuota
  truncated: boolean
}

function quotaFromHeaders(headers: Headers): AaQuota {
  const rawRemaining = headers.get('x-ratelimit-remaining')
  const rawReset = headers.get('x-ratelimit-reset')
  const remaining = rawRemaining == null ? Number.NaN : Number(rawRemaining)
  const reset = rawReset == null ? Number.NaN : Number(rawReset)
  return {
    remaining: Number.isFinite(remaining) ? remaining : null,
    resetAt: Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : null
  }
}

function retryAfterText(headers: Headers): string {
  const raw = headers.get('retry-after')
  const seconds = raw == null ? Number.NaN : Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return `约 ${Math.ceil(seconds)} 秒后重试`
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分钟后重试`
  return `约 ${Math.ceil(seconds / 3600)} 小时后重试`
}

function describeStatus(status: number, headers: Headers): string {
  if (status === 401) return 'API Key 无效或已失效，请在数据来源中重新配置'
  if (status === 403) return '当前 API Key 无权访问 Artificial Analysis 免费档接口'
  if (status === 429) {
    const retry = retryAfterText(headers)
    return `Artificial Analysis 今日额度已用完${retry ? `，${retry}` : '，请稍后重试'}`
  }
  return `Artificial Analysis 返回 HTTP ${status}`
}

async function fetchPage(
  fetchImpl: FetchLike,
  page: number,
  apiKey: string
): Promise<{
  models: AiWorldAaModel[]
  hasMore: boolean
  intelligenceIndexVersion: number | null
  quota: AaQuota
}> {
  const url = `${AI_WORLD_AA_API_BASE}/language/models/free?page=${page}`
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey
      },
      signal: AbortSignal.timeout(20_000)
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError')
      throw new AiWorldAaError('连接 Artificial Analysis 超时，请检查网络或代理后重试', {
        cause: error
      })
    throw new AiWorldAaError('无法连接 Artificial Analysis，请检查网络或代理后重试', {
      cause: error
    })
  }

  if (!response.ok) throw new AiWorldAaError(describeStatus(response.status, response.headers))

  const body = await response.text()
  if (Buffer.byteLength(body, 'utf8') > MAX_PAGE_BYTES) {
    throw new AiWorldAaError('Artificial Analysis 单页响应超过大小上限')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch (error) {
    throw new AiWorldAaError('Artificial Analysis 返回的 JSON 无法解析', { cause: error })
  }
  const pageData = parseAiWorldAaPage(parsed)
  return {
    models: pageData.models,
    hasMore: pageData.hasMore,
    intelligenceIndexVersion: pageData.intelligenceIndexVersion,
    quota: quotaFromHeaders(response.headers)
  }
}

/** 顺序翻页拉取免费档全部模型；任一分页失败则整次刷新失败，不写入半份快照。 */
export async function fetchAiWorldAa(
  fetchImpl: FetchLike,
  apiKey: string
): Promise<AaFetchResult> {
  const models: AiWorldAaModel[] = []
  const seen = new Set<string>()
  let intelligenceIndexVersion: number | null = null
  let quota: AaQuota = { remaining: null, resetAt: null }
  let truncated = false

  for (let page = 1; page <= AI_WORLD_AA_MAX_PAGES; page++) {
    const result = await fetchPage(fetchImpl, page, apiKey)
    for (const model of result.models) {
      if (seen.has(model.id)) continue
      seen.add(model.id)
      models.push(model)
    }
    if (result.intelligenceIndexVersion != null)
      intelligenceIndexVersion = result.intelligenceIndexVersion
    if (result.quota.remaining != null || result.quota.resetAt != null) quota = result.quota
    if (!result.hasMore) break
    if (page === AI_WORLD_AA_MAX_PAGES) truncated = true
  }

  if (!models.length) throw new AiWorldAaError('Artificial Analysis 没有返回模型数据')
  return { models, intelligenceIndexVersion, quota, truncated }
}
