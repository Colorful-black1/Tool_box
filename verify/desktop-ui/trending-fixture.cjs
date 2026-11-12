/** 合成热榜桥接：不访问 GitHub，只验证页面、筛选与打开动作。 */
module.exports = function createTrendingFixture() {
  const calls = []
  const opens = []

  const item = (rank, fullName, periodStars) => ({
    rank,
    fullName,
    url: `https://github.com/${fullName}`,
    description: rank === 1 ? 'An open source design system' : 'A new weekly project',
    language: rank === 1 ? 'TypeScript' : 'Go',
    languageColor: rank === 1 ? '#3178c6' : '#00add8',
    stars: rank === 1 ? 24_410 : 1_526,
    forks: rank === 1 ? 1_906 : 90,
    periodStars
  })

  const bridge = {
    list: async (query) => {
      calls.push(query)
      // 模拟没有磁盘缓存：渲染层随后会 force 拉取最新结果。
      if (query.allowStale) return null
      const weekly = query.period === 'weekly'
      return {
        period: query.period,
        language: query.language ?? null,
        source: 'trending',
        items: weekly ? [item(1, 'acme/weekly', 1_200)] : [item(1, 'meta/astryx', 2_842)],
        fetchedAtMs: Date.now(),
        stale: false,
        warning: null
      }
    },
    open: async (fullName) => {
      opens.push(fullName)
    }
  }

  return {
    bridge,
    controls: {
      trendingCalls: () => calls,
      trendingOpens: () => opens
    }
  }
}
