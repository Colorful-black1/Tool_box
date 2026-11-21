import type { FetchLike } from '../../github-trending/fetch'
import { AiAgentArenaError } from '../errors'

export interface SourceCacheHeaders {
  etag: string | null
  lastModified: string | null
}

export interface SourceTextResult {
  notModified: boolean
  text: string | null
  etag: string | null
  lastModified: string | null
}

interface FetchSourceOptions extends SourceCacheHeaders {
  timeoutMs?: number
  maxBytes?: number
  accept?: string
}

/** 固定 HTTPS、固定超时、限制响应大小；304 只更新检查时间，不重新解析。 */
export async function fetchSourceText(
  fetchImpl: FetchLike,
  url: string,
  options: FetchSourceOptions
): Promise<SourceTextResult> {
  const headers: Record<string, string> = {
    accept: options.accept ?? 'text/html,application/xhtml+xml'
  }
  if (options.etag) headers['if-none-match'] = options.etag
  if (options.lastModified) headers['if-modified-since'] = options.lastModified

  let response: Response
  try {
    response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000)
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError')
      throw new AiAgentArenaError('榜单请求超时，请检查网络或代理后重试', { cause: error })
    throw new AiAgentArenaError('无法连接榜单来源，请检查网络或代理后重试', { cause: error })
  }

  if (response.status === 304) {
    return {
      notModified: true,
      text: null,
      etag: response.headers.get('etag') ?? options.etag,
      lastModified: response.headers.get('last-modified') ?? options.lastModified
    }
  }
  if (!response.ok) throw new AiAgentArenaError(`榜单来源返回 HTTP ${response.status}`)

  const text = (await response.text()).replace(/^\uFEFF/, '')
  if (Buffer.byteLength(text, 'utf8') > (options.maxBytes ?? 2 * 1024 * 1024)) {
    throw new AiAgentArenaError('榜单页面超过大小上限，未写入缓存')
  }
  return {
    notModified: false,
    text,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified')
  }
}
