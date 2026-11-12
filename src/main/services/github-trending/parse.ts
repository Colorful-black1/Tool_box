import { TRENDING_MAX_DESCRIPTION, TRENDING_MAX_ITEMS } from '../../../shared/github-trending'
import type { TrendingPeriod, TrendingRepo } from '../../../shared/github-trending'

/** 防止异常响应把正则和内存拖死；GitHub 实际页面约 600KB。 */
const MAX_HTML_CHARS = 2_000_000

const ARTICLE_RE = /<article\b[^>]*\bclass="[^"]*\bBox-row\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi
const H2_RE = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i
const HREF_RE = /<a\b[^>]*\bhref="\/([^"?#]+)"[^>]*>/i
const DESC_RE = /<p\b[^>]*\bclass="[^"]*color-fg-muted[^"]*"[^>]*>([\s\S]*?)<\/p>/i
const LANGUAGE_RE = /itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/i
const LANGUAGE_TAG_RE = /<span\b[^>]*\brepo-language-color\b[^>]*>/i
const COLOR_RE = /background-color:\s*(#[0-9a-fA-F]{3,8})/i

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  middot: '·',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™'
}

export class TrendingParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrendingParseError'
  }
}

/** 解析 GitHub Trending 页面；只依赖字符串，便于用固定 fixture 做回归测试。 */
export function parseTrendingHtml(html: string, period: TrendingPeriod): TrendingRepo[] {
  if (typeof html !== 'string' || html.length > MAX_HTML_CHARS) {
    throw new TrendingParseError('GitHub 页面内容异常')
  }

  const items: TrendingRepo[] = []
  let articleIndex = 0
  for (const match of html.matchAll(ARTICLE_RE)) {
    articleIndex++
    const article = match[1]
    if (!article) continue

    const h2 = article.match(H2_RE)?.[1] ?? ''
    const href = h2.match(HREF_RE)?.[1]
    if (!href) continue

    const segments = href.split('/')
    if (segments.length !== 2) continue
    const owner = decodeSegment(segments[0])
    const name = decodeSegment(segments[1])
    if (!owner || !name) continue

    // 仓库名是拼 URL 和调用 openExternal 的唯一来源，必须先按 GitHub 规则收窄。
    if (!isRepoPart(owner) || !isRepoPart(name)) continue

    const stars = countFromAnchor(article, href, 'stargazers')
    if (stars === null) continue
    const forks = countFromAnchor(article, href, 'forks') ?? 0

    const fullName = `${owner}/${name}`
    const description = textOf(article.match(DESC_RE)?.[1] ?? '').slice(0, TRENDING_MAX_DESCRIPTION)
    const language = textOf(article.match(LANGUAGE_RE)?.[1] ?? '')
    const languageColor = languageColorOf(article)
    const periodStars = periodStarsOf(article, period)

    items.push({
      rank: articleIndex,
      fullName,
      url: `https://github.com/${fullName}`,
      description,
      language,
      languageColor,
      stars,
      forks,
      periodStars
    })
    if (items.length >= TRENDING_MAX_ITEMS) break
  }

  if (items.length === 0) throw new TrendingParseError('GitHub 页面没有可解析的项目')
  return items
}

function decodeSegment(value: string | undefined): string | null {
  if (!value) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function isRepoPart(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 100 &&
    value !== '.' &&
    value !== '..' &&
    /^[A-Za-z0-9_.-]+$/.test(value)
  )
}

/**
 * 从仓库对应的 stargazers / forks 链接里取数字。
 *
 * 必须从 <a 开始匹配：只从 href 开始会把属性中的其他数字一起带进可见文本。
 */
function countFromAnchor(
  article: string,
  repoPath: string,
  kind: 'stargazers' | 'forks'
): number | null {
  const re = new RegExp(
    `<a\\b[^>]*\\bhref="/${escapeRegExp(repoPath)}/${kind}"[^>]*>([\\s\\S]*?)<\\/a>`,
    'i'
  )
  const match = article.match(re)
  if (!match) return null
  return parseCount(textOf(match[1]))
}

/** 支持千分位逗号；GitHub 页面正常使用 24,410 这种格式。 */
export function parseCount(value: string): number | null {
  const cleaned = value.replace(/,/g, '').trim()
  const match = /^([0-9]+(?:\.[0-9]+)?)([kKmM])?$/.exec(cleaned)
  if (!match) return null
  const base = Number(match[1])
  if (!Number.isFinite(base)) return null
  const suffix = match[2]?.toLowerCase()
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : 1
  return Math.round(base * multiplier)
}

function periodStarsOf(article: string, period: TrendingPeriod): number | null {
  const label = period === 'daily' ? 'today' : period === 'weekly' ? 'this week' : 'this month'
  const match = textOf(article).match(new RegExp(`([0-9][0-9,]*)\\s+stars\\s+${label}`, 'i'))
  return match ? parseCount(match[1]) : null
}

function languageColorOf(article: string): string | null {
  const tag = article.match(LANGUAGE_TAG_RE)?.[0] ?? ''
  const color = tag.match(COLOR_RE)?.[1]?.toLowerCase() ?? ''
  return /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/.test(color) ? color : null
}

function textOf(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (raw, code: string) => {
    const normalized = code.toLowerCase()
    if (normalized.startsWith('#x')) {
      const point = Number.parseInt(normalized.slice(2), 16)
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : raw
    }
    if (normalized.startsWith('#')) {
      const point = Number.parseInt(normalized.slice(1), 10)
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : raw
    }
    return NAMED_ENTITIES[normalized] ?? raw
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
