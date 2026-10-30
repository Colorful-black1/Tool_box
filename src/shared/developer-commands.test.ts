import { describe, expect, it } from 'vitest'
import { DEVELOPER_COMMAND_PRESETS } from './developer-command-presets'
import { EMPTY_COMMAND_LIBRARY, searchDeveloperCommands } from './developer-commands'
import type { CommandFilters } from './developer-commands'
import {
  parseDeveloperCommandInput,
  parseDeveloperCommandSnapshot
} from './developer-command-validation'

const filters: CommandFilters = { query: '', category: '', shell: '', view: 'all' }
export const commandInput = {
  title: '查看日志',
  command: '  echo "中文"\n\tprintf \'\\n\'  \n',
  category: 'Linux',
  description: '跟踪容器日志',
  tags: ['日志'],
  shell: 'bash' as const,
  risk: 'read' as const,
  expectedRevision: 0
}
describe('命令速查目录与校验', () => {
  it('内置目录恰有 50 条，稳定 ID 唯一并符合保存字段限制', () => {
    expect(DEVELOPER_COMMAND_PRESETS).toHaveLength(50)
    expect(new Set(DEVELOPER_COMMAND_PRESETS.map((item) => item.id)).size).toBe(50)
    expect(
      searchDeveloperCommands(DEVELOPER_COMMAND_PRESETS, [], { ...filters, query: '端口占用' })[0]
        .id
    ).toBe('builtin:linux-ports')
    for (const item of DEVELOPER_COMMAND_PRESETS) {
      const { id: _id, archivedAtMs: _archive, ...fields } = item
      expect(parseDeveloperCommandInput({ ...fields, expectedRevision: 0 }).command).toBe(
        item.command
      )
    }
  })
  it('多词搜索不区分大小写，标题优先，查询副本不会修改命令原文', () => {
    const entries = [
      { ...commandInput, title: '其他', id: 'builtin:a', archivedAtMs: null },
      {
        ...commandInput,
        title: '容器日志',
        command: 'docker logs -f <容器名>',
        id: 'builtin:b',
        archivedAtMs: null
      }
    ]
    expect(
      searchDeveloperCommands(entries, ['builtin:a'], { ...filters, query: '容器 日志' }).map(
        (item) => item.id
      )
    ).toEqual(['builtin:b', 'builtin:a'])
    expect(searchDeveloperCommands(entries, [], { ...filters, query: 'DOCKER LOGS' })).toHaveLength(
      1
    )
    expect(parseDeveloperCommandInput(commandInput).command).toBe(commandInput.command)
  })
  it('归档与收藏、Shell 和分类筛选共同生效', () => {
    const entries = [
      { ...commandInput, id: 'user:one', archivedAtMs: null },
      { ...commandInput, id: 'user:two', archivedAtMs: 1 }
    ]
    expect(
      searchDeveloperCommands(entries, ['user:one', 'user:two'], {
        ...filters,
        view: 'favorites',
        category: 'Linux',
        shell: 'bash'
      }).map((item) => item.id)
    ).toEqual(['user:one'])
    expect(searchDeveloperCommands(entries, [], { ...filters, view: 'archived' })).toHaveLength(1)
    expect(searchDeveloperCommands(entries, [], { ...filters, shell: 'cmd' })).toEqual([])
  })
  it.each([
    { command: ' '.repeat(8001) },
    { command: '   ' },
    { tags: Array(9).fill('a') },
    { tags: ['x', 'x'] },
    { shell: 'zsh' },
    { risk: 'auto' },
    { expectedRevision: '0' },
    { id: 'builtin:docker-logs' },
    { title: 'a'.repeat(81) }
  ])('拒绝非法输入 %j', (patch) => {
    expect(() => parseDeveloperCommandInput({ ...commandInput, ...patch })).toThrow()
  })
  it('拒绝未知文档版本、重复 ID 与悬空收藏', () => {
    expect(() => parseDeveloperCommandSnapshot({ ...EMPTY_COMMAND_LIBRARY, version: 2 })).toThrow()
    expect(() =>
      parseDeveloperCommandSnapshot({
        ...EMPTY_COMMAND_LIBRARY,
        favoriteIds: ['user:00000000-0000-0000-0000-000000000000']
      })
    ).toThrow()
    const entry = {
      ...commandInput,
      id: 'user:00000000-0000-0000-0000-000000000000',
      archivedAtMs: null
    }
    expect(() =>
      parseDeveloperCommandSnapshot({ ...EMPTY_COMMAND_LIBRARY, entries: [entry, entry] })
    ).toThrow()
  })
  it('总量按 UTF-8 字节限制，中文不能绕过 2 MiB 上限', () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
      ...commandInput,
      id: `user:00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      command: '中'.repeat(8000),
      archivedAtMs: null
    }))
    expect(() => parseDeveloperCommandSnapshot({ ...EMPTY_COMMAND_LIBRARY, entries })).toThrow(
      '2 MiB'
    )
  })
})
