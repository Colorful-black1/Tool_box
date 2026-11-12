import type { FetchLike } from '../../github-trending/fetch'

/** 原生数据源错误；message 可展示，不携带响应正文。 */
export class NativeSourceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NativeSourceError'
  }
}

const TIMEOUT_MS = 25_000
const USER_AGENT = 'ToolBox/0.3.0'

async function request(
  fetchImpl: FetchLike,
  url: string,
  label: string,
  maxBytes: number
): Promise<Response> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json, text/csv, application/zip, */*',
        'User-Agent': USER_AGENT
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    throw new NativeSourceError(`${label}连接失败，请检查网络或代理`, { cause: error })
  }
  if (!response.ok) throw new NativeSourceError(`${label}返回 HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > maxBytes)
    throw new NativeSourceError(`${label}响应超过大小上限`)
  return response
}

export async function fetchText(
  fetchImpl: FetchLike,
  url: string,
  label: string,
  maxBytes = 48 * 1024 * 1024
): Promise<string> {
  const response = await request(fetchImpl, url, label, maxBytes)
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > maxBytes)
    throw new NativeSourceError(`${label}响应超过大小上限`)
  return text
}

export async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  label: string,
  maxBytes = 48 * 1024 * 1024
): Promise<unknown> {
  const text = await fetchText(fetchImpl, url, label, maxBytes)
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new NativeSourceError(`${label}不是有效 JSON`, { cause: error })
  }
}

export async function fetchBytes(
  fetchImpl: FetchLike,
  url: string,
  label: string,
  maxBytes = 16 * 1024 * 1024
): Promise<Uint8Array> {
  const response = await request(fetchImpl, url, label, maxBytes)
  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  if (bytes.byteLength > maxBytes) throw new NativeSourceError(`${label}响应超过大小上限`)
  return bytes
}
