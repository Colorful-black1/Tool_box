import {
  EXTENSION_SEARCH_LIMIT,
  EXTENSION_SEARCH_MAX_LIMIT,
  ExtensionError,
  SKILL_SEARCH_MAX_CHARS,
  SKILL_SEARCH_MIN_CHARS
} from '../../../shared/extensions'
import type {
  SkillSearchInput,
  SkillSearchItem,
  SkillSearchResult
} from '../../../shared/extensions'

const SEARCH_ENDPOINT = 'https://skills.sh/api/search'
const TIMEOUT_MS = 12_000
const USER_AGENT = 'ToolBox/0.3 (+https://skills.sh)'
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SKILL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

const asCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0

/** 关键词在主进程统一收口，渲染层不传空串或超长串。 */
export function normalizeSkillQuery(value: string): string {
  const query = value.trim()
  if (query.length < SKILL_SEARCH_MIN_CHARS)
    throw new ExtensionError(`搜索关键词至少 ${SKILL_SEARCH_MIN_CHARS} 个字符`)
  if (query.length > SKILL_SEARCH_MAX_CHARS)
    throw new ExtensionError(`搜索关键词最多 ${SKILL_SEARCH_MAX_CHARS} 个字符`)
  return query
}

export function normalizeLimit(value?: number): number {
  if (value === undefined) return EXTENSION_SEARCH_LIMIT
  if (!Number.isFinite(value)) return EXTENSION_SEARCH_LIMIT
  return Math.min(EXTENSION_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(value)))
}

/**
 * 搜索 skills.sh。
 *
 * 站点没有开放给第三方的公开搜索接口（v1 需要 Vercel OIDC），这里用的是站点自己
 * 页面在用的匿名 `/api/search`：q 至少 2 个字符，`count` 是本次返回条数而不是总数，
 * 翻页只能按「返回条数 == limit」判断。因此结果只做展示，不做全量归档。
 */
export async function searchSkills(
  input: SkillSearchInput,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<SkillSearchResult> {
  const query = normalizeSkillQuery(input.query)
  const limit = normalizeLimit(input.limit)
  const offset = Number.isFinite(input.offset) ? Math.max(0, Math.floor(input.offset ?? 0)) : 0
  const url = new URL(SEARCH_ENDPOINT)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', String(offset))

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch {
    throw new ExtensionError('无法连接 skills.sh，请检查网络或代理后重试')
  }
  if (response.status === 400) throw new ExtensionError('搜索关键词至少 2 个字符')
  if (response.status === 429) throw new ExtensionError('skills.sh 请求过于频繁，请稍后再试')
  if (!response.ok) throw new ExtensionError(`skills.sh 暂时不可用（HTTP ${response.status}）`)

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ExtensionError('skills.sh 返回了无法解析的内容')
  }
  const skills = asObject(payload)['skills']
  const raw = Array.isArray(skills) ? skills : []
  const items: SkillSearchItem[] = []
  for (const value of raw.slice(0, limit)) {
    const entry = asObject(value)
    const source = asText(entry['source'])
    const [owner, repo] = source.split('/')
    const skill = asText(entry['skillId'])
    if (!owner || !repo || !OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) continue
    if (!SKILL_PATTERN.test(skill)) continue
    items.push({
      id: `${source}:${skill}`,
      name: asText(entry['name']) || skill,
      source,
      installs: asCount(entry['installs']),
      repositoryUrl: `https://github.com/${source}`,
      installCommand: `npx skills add ${source} --skill ${skill} -g`
    })
  }
  if (!items.length && raw.length)
    throw new ExtensionError('搜索结果里没有可安装的技能，请换一个关键词')

  return { query, items, hasMore: raw.length >= limit }
}
