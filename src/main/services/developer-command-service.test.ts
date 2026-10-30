import { describe, expect, it } from 'vitest'
import { DeveloperCommandService } from './developer-command-service'
import type { DeveloperCommandInput } from '../../shared/developer-commands'

const input: DeveloperCommandInput = {
  title: '日志',
  command: '  one\n\ttwo\\  \n',
  category: '其他',
  description: '',
  tags: [],
  shell: 'unspecified',
  risk: 'read',
  expectedRevision: 0
}
function fixture() {
  let raw: string | null = null
  let fail = false
  const store = {
    commandLibraryGet: () => raw,
    commandLibrarySet: (value: string) => {
      if (fail) throw new Error('磁盘失败')
      raw = value
    }
  }
  return {
    service: new DeveloperCommandService(store),
    store,
    raw: () => raw,
    corrupt: (value: string) => {
      raw = value
    },
    fail: () => {
      fail = true
    }
  }
}
describe('命令库独立 kv 服务', () => {
  it('首次只读不写盘，保存原文，新的服务实例恢复同一记录', () => {
    const f = fixture()
    expect(f.service.read().revision).toBe(0)
    expect(f.raw()).toBeNull()
    const saved = f.service.save(input)
    expect(saved.entries[0].command).toBe(input.command)
    expect(new DeveloperCommandService(f.store).read()).toEqual(saved)
  })
  it('旧 revision、未知条目和内置编辑不会改写记录', () => {
    const f = fixture()
    f.service.save(input)
    const before = f.raw()
    expect(() => f.service.save(input)).toThrow('已变化')
    expect(() =>
      f.service.save({ ...input, id: 'builtin:docker-logs', expectedRevision: 1 })
    ).toThrow('不存在')
    expect(f.raw()).toBe(before)
  })
  it('归档保留收藏，恢复后原文仍在，不能归档内置或编辑归档项', () => {
    const { service } = fixture()
    const id = service.save(input).entries[0].id
    service.setFavorite({ id, value: true, expectedRevision: 1 })
    expect(service.setArchived({ id, value: true, expectedRevision: 2 }).favoriteIds).toEqual([id])
    expect(() => service.save({ ...input, id, expectedRevision: 3 })).toThrow('先恢复')
    const restored = service.setArchived({ id, value: false, expectedRevision: 3 })
    expect(restored.entries[0].archivedAtMs).toBeNull()
    expect(() =>
      service.setArchived({ id: 'builtin:docker-logs', value: true, expectedRevision: 4 })
    ).toThrow('个人')
  })
  it('损坏文档保留原样且阻止继续写入', () => {
    const f = fixture()
    f.corrupt('{broken')
    expect(() => f.service.read()).toThrow('原记录已保留')
    expect(() => f.service.save(input)).toThrow('原记录已保留')
    expect(f.raw()).toBe('{broken')
  })
  it('写入失败不改变已保存的文档或 revision', () => {
    const f = fixture()
    const before = f.service.save(input)
    f.fail()
    expect(() =>
      f.service.save({ ...input, title: '更新', id: before.entries[0].id, expectedRevision: 1 })
    ).toThrow('保存失败')
    expect(f.service.read()).toEqual(before)
  })
})
