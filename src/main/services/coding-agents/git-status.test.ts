import { describe, expect, it } from 'vitest'

import { parseNumstat, parseStatusOutput } from './git-status'

describe('parseStatusOutput', () => {
  it('解析干净工作区的普通分支', () => {
    expect(parseStatusOutput('## main\n')).toEqual({
      branch: 'main',
      detached: false,
      ahead: 0,
      behind: 0,
      changedFiles: 0,
      insertions: 0,
      deletions: 0
    })
  })

  it('解析上游差距与改动文件数，兼容 Windows 换行', () => {
    const output = [
      '## bug_fix...origin/bug_fix [ahead 2, behind 1]',
      ' M src/a.ts',
      '?? docs/new.md',
      'A  src/b.ts',
      ''
    ].join('\r\n')
    expect(parseStatusOutput(output)).toMatchObject({
      branch: 'bug_fix',
      detached: false,
      ahead: 2,
      behind: 1,
      changedFiles: 3
    })
  })

  it('首提交仓库没有上游也能取到分支', () => {
    expect(parseStatusOutput('## No commits yet on main\n')).toMatchObject({
      branch: 'main',
      ahead: 0,
      behind: 0,
      changedFiles: 0
    })
  })

  it('识别分离 HEAD', () => {
    expect(parseStatusOutput('## HEAD (no branch)\n M a.ts\n')).toMatchObject({
      branch: '',
      detached: true,
      changedFiles: 1
    })
  })

  it('非 git status 输出返回 null', () => {
    expect(parseStatusOutput('')).toBeNull()
    expect(parseStatusOutput('fatal: not a git repository')).toBeNull()
  })
})

describe('parseNumstat', () => {
  it('累加普通文件并跳过二进制占位', () => {
    const output = ['12\t3\tsrc/a.ts', '-\t-\tassets/icon.png', '0\t7\tsrc/b.ts', ''].join('\n')
    expect(parseNumstat(output)).toEqual({ insertions: 12, deletions: 10 })
  })

  it('空输出为零', () => {
    expect(parseNumstat('')).toEqual({ insertions: 0, deletions: 0 })
  })
})
