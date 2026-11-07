import { buildMatchExpression, isSingleCjkChar, tokenizeForIndex, tokenizeQuery } from './kb-tokenize'

describe('知识库分词', () => {
  it('中文切成相邻二元组，单字保留', () => {
    expect(tokenizeForIndex('部署失败')).toBe('部署 署失 失败')
    expect(tokenizeForIndex('部署')).toBe('部署')
    expect(tokenizeForIndex('雨')).toBe('雨')
  })

  it('拉丁词统一小写并按标点切分', () => {
    expect(tokenizeForIndex('Rollback DB-01, please!')).toBe('rollback db 01 please')
  })

  it('中英混合与查询去重', () => {
    expect(tokenizeQuery('数据库 Rollback 失败')).toEqual(['数据', '据库', 'rollback', '失败'])
    expect(tokenizeQuery('部署 部署 部署')).toEqual(['部署'])
    expect(tokenizeQuery('，。！')).toEqual([])
  })

  it('查询表达式用双引号包裹并以 OR 连接', () => {
    expect(buildMatchExpression(['部署', '失败'])).toBe('"部署" OR "失败"')
    expect(buildMatchExpression([])).toBe('')
  })

  it('单个汉字查询走兜底判断', () => {
    expect(isSingleCjkChar('雨')).toBe(true)
    expect(isSingleCjkChar(' 雨 ')).toBe(true)
    expect(isSingleCjkChar('部署')).toBe(false)
    expect(isSingleCjkChar('a')).toBe(false)
    expect(isSingleCjkChar('')).toBe(false)
  })

  it('索引与查询使用同一套二元组，两字查询能命中长词', () => {
    const indexed = tokenizeForIndex('部署失败时先回滚数据库')
    for (const token of tokenizeQuery('部署')) {
      expect(indexed.split(' ')).toContain(token)
    }
  })
})
