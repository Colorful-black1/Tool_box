import { chunkText } from './kb-chunking'

describe('知识库分块', () => {
  it('按标题切段并带面包屑，标题行不进入正文', () => {
    const text = [
      '# 部署',
      '',
      '## 回滚',
      '',
      '数据库回滚要先恢复备份。',
      '',
      '## 发布',
      '',
      '发布前检查网关。'
    ].join('\n')

    const chunks = chunkText(text)
    expect(chunks.map((chunk) => chunk.heading)).toEqual(['部署 > 回滚', '部署 > 发布'])
    expect(chunks.map((chunk) => chunk.content)).toEqual([
      '数据库回滚要先恢复备份。',
      '发布前检查网关。'
    ])
    expect(chunks.every((chunk) => !chunk.content.startsWith('#'))).toBe(true)
  })

  it('代码围栏里的 # 不算标题，围栏整体不被切断', () => {
    const code = `\`\`\`md\n# 不是标题\n${'代码行。'.repeat(400)}\n\`\`\``
    const chunks = chunkText(`# 示例\n\n${code}\n\n正文`)

    expect(chunks).toHaveLength(2)
    expect(chunks[0].heading).toBe('示例')
    expect(chunks[0].oversized).toBe(true)
    expect(chunks[0].content).toContain('# 不是标题')
    expect(chunks[0].content.endsWith('```')).toBe(true)
    expect(chunks[1].content).toBe('正文')
  })

  it('Markdown 表格作为原子块，不按行拆开', () => {
    const header = '| 列A | 列B |\n| --- | --- |'
    const rows = Array.from({ length: 30 }, (_, index) => `| 值${index} | 说明${index} |`).join('\n')
    const chunks = chunkText(`# 表格\n\n${header}\n${rows}\n\n结尾段落。`)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toContain('| 列A | 列B |')
    expect(chunks[0].content).toContain('| 值29 | 说明29 |')
    expect(chunks[0].content.endsWith('结尾段落。')).toBe(true)
  })

  it('超长表格保持完整并标记 oversized', () => {
    const header = '| 列A | 列B |\n| --- | --- |'
    const rows = Array.from({ length: 120 }, (_, index) => `| 值${index} | 说明${index} |`).join('\n')
    const chunks = chunkText(`# 表格\n\n${header}\n${rows}`)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].oversized).toBe(true)
    expect(chunks[0].charCount).toBeGreaterThan(1400)
    expect(chunks[0].content).toContain('| 值119 | 说明119 |')
  })

  it('无换行长文本按句切分，块长不超上限且带上一句重叠', () => {
    const sentence = '这是一句用于测试分块的句子，长度大概二十来个字。'
    const chunks = chunkText(`# 长文\n\n${sentence.repeat(120)}`)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.charCount).toBeLessThanOrEqual(1400)
      expect(chunk.charCount).toBeGreaterThanOrEqual(300)
    }
    // 第二块开头应当重复第一块最后一句（重叠 ≤100 字）
    expect(chunks[1].content.startsWith('这是一句用于测试分块的句子')).toBe(true)
  })

  it('整段没有标点时按码点硬切兜底，不产生代理对半截', () => {
    const text = `# 无标点\n\n${'星光'.repeat(3000)}`
    const chunks = chunkText(text)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.charCount).toBeLessThanOrEqual(1400)
      expect(chunk.content).toContain('星光')
    }
  })

  it('碎片合并到目标长度', () => {
    const chunks = chunkText(`# 合并\n\n${'甲'.repeat(400)}\n\n${'乙'.repeat(400)}`)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].charCount).toBe(802)
  })

  it('尾块不足下限时并入前一块', () => {
    const chunks = chunkText(
      `# 尾块\n\n${'甲'.repeat(700)}\n\n${'乙'.repeat(700)}\n\n${'丙'.repeat(100)}`
    )

    expect(chunks).toHaveLength(2)
    expect(chunks[1].charCount).toBe(802)
    expect(chunks[1].content.endsWith('丙'.repeat(100))).toBe(true)
  })

  it('短文档与空文档', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\n  ')).toEqual([])
    const chunks = chunkText('只有一句话。')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ heading: '', content: '只有一句话。', charCount: 6 })
    expect(chunks[0].startOffset).toBe(0)
  })

  it('偏移可在归一的正文中定位回原文', () => {
    const text = '# 标题\r\n\r\n第一段。\r\n\r\n第二段。'
    const chunks = chunkText(text)
    const normalized = text.replace(/\r\n?/g, '\n')
    expect(normalized.slice(chunks[0].startOffset, chunks[0].startOffset + 4)).toBe('第一段。')
  })
})
