import { describe, expect, it } from 'vitest'

import { parseCount, parseTrendingHtml, TrendingParseError } from './parse'

interface ArticleOptions {
  repo?: string
  description?: string
  language?: string
  color?: string
  stars?: string
  forks?: string
  gain?: string
}

function article(options: ArticleOptions = {}): string {
  const {
    repo = 'meta/astryx',
    description = 'An open source design system',
    language = 'TypeScript',
    color = '#3178c6',
    stars = '24,410',
    forks = '1,906',
    gain = '2,842 stars today'
  } = options
  return `
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/${repo}"><span class="text-normal">meta /</span> astryx</a>
  </h2>
  <p class="col-9 color-fg-muted my-1 tmp-pr-4">${description}</p>
  <div class="f6 color-fg-muted mt-2">
    <span class="tmp-mr-3"><span class="repo-language-color" style="background-color: ${color}"></span>
      <span itemprop="programmingLanguage">${language}</span>
    </span>
    <a href="/${repo}/stargazers" class="Link"><svg aria-label="star"></svg>${stars}</a>
    <a href="/${repo}/forks" class="Link"><svg aria-label="fork"></svg>${forks}</a>
    <span class="float-sm-right">${gain}</span>
  </div>
</article>`
}

describe('GitHub Trending 解析', () => {
  it('解析仓库、语言、Star、Fork 与本期新增', () => {
    const items = parseTrendingHtml(article(), 'daily')
    expect(items).toEqual([
      {
        rank: 1,
        fullName: 'meta/astryx',
        url: 'https://github.com/meta/astryx',
        description: 'An open source design system',
        language: 'TypeScript',
        languageColor: '#3178c6',
        stars: 24_410,
        forks: 1_906,
        periodStars: 2_842
      }
    ])
  })

  it('按周期匹配本周 / 本月新增文案', () => {
    const weekly = parseTrendingHtml(article({ gain: '429 stars this week' }), 'weekly')
    const monthly = parseTrendingHtml(article({ gain: '73 stars this month' }), 'monthly')
    expect(weekly[0].periodStars).toBe(429)
    expect(monthly[0].periodStars).toBe(73)
  })

  it('把 HTML 实体还原为纯文本', () => {
    const [item] = parseTrendingHtml(
      article({ description: 'A &amp; B &#39;quote&#39; &lt;tag&gt;' }),
      'daily'
    )
    expect(item.description).toBe("A & B 'quote' <tag>")
  })

  it('缺简介 / 语言时保留空值，颜色不合法时置空', () => {
    const [item] = parseTrendingHtml(
      article({ description: '', language: '', color: 'not-a-color', gain: '' }),
      'daily'
    )
    expect(item.description).toBe('')
    expect(item.language).toBe('')
    expect(item.languageColor).toBeNull()
    expect(item.periodStars).toBeNull()
  })

  it('跳过坏条目但保留原始排名', () => {
    const html = article() + article({ repo: 'bad', stars: 'abc' }) + article({ repo: 'a/b' })
    const items = parseTrendingHtml(html, 'daily')
    expect(items.map((item) => item.fullName)).toEqual(['meta/astryx', 'a/b'])
    expect(items[1].rank).toBe(3)
  })

  it('没有可解析条目时抛错，不返回空数组', () => {
    expect(() => parseTrendingHtml('<html><body>no rows</body></html>', 'daily')).toThrow(
      TrendingParseError
    )
  })

  it('解析千分位和 k / m 后缀', () => {
    expect(parseCount('24,410')).toBe(24_410)
    expect(parseCount('1.2k')).toBe(1_200)
    expect(parseCount('3m')).toBe(3_000_000)
    expect(parseCount('abc')).toBeNull()
  })
})
