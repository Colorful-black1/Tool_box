import { describe, expect, it } from 'vitest'
import { appTargetUrl, parseAppTarget, referenceMarkdown } from './app-reference'
import type { AppTarget } from './app-reference'

describe('应用内只读定位地址', () => {
  it('往返保留章节和含特殊字符的统计筛选', () => {
    const targets: AppTarget[] = [
      { kind: 'note', id: 'n1' },
      { kind: 'todo', id: 't1' },
      { kind: 'chapter', id: 'b1', chapterIdx: 0 },
      { kind: 'kb', id: 'd1' },
      { kind: 'kb', id: 'd1', chunkId: 'chunk_1' },
      {
        kind: 'usage',
        query: {
          client: 'codex',
          project: 'E:\\项目 a&b',
          model: 'a/b',
          from: '2024-02-29',
          to: '2024-03-01'
        }
      }
    ]
    for (const target of targets) expect(parseAppTarget(appTargetUrl(target))).toEqual(target)
  })
  it.each([
    'javascript:alert(1)',
    'file:///C:/test',
    'toolbox://open/delete/n1',
    'toolbox://open/note/n1?delete=true',
    'toolbox://open/usage?client=__proto__',
    'toolbox://open/usage?from=2025-02-30',
    'toolbox://open/usage?from=2025-03-01&to=2025-02-01',
    'toolbox://open/usage?refresh=true',
    'toolbox://open/usage?model=a&model=b',
    'toolbox://open/chapter/b1?chapter=-1',
    'toolbox://open/kb/d1?chunk=../x',
    'toolbox://open/kb/d1?chunk=a&chunk=b',
    'toolbox://open/note/n1#abc',
    'toolbox://open/note/%22onclick%3Dalert(1)'
  ])('拒绝非白名单或非法入口 %s', (href) => expect(parseAppTarget(href)).toBeNull())
  it('标题不能注入 Markdown 或 HTML 结构', () => {
    const text = referenceMarkdown({
      label: 'a]\n[危险](bad)<x>',
      target: { kind: 'note', id: 'n1' }
    })
    expect(text.split('\n')).toHaveLength(1)
    expect(text.match(/\]\(/g)).toHaveLength(1)
    expect(text).not.toContain('<x>')
  })
})
