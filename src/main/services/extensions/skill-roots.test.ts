import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ExtensionError } from '../../../shared/extensions'
import { SkillRootStore, expandRootPath, normalizeRootPath, skillRootsView } from './skill-roots'

const homes: string[] = []

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'toolbox-skill-roots-'))
  homes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe('normalizeRootPath', () => {
  it('统一 ~ 写法并拒绝相对路径', () => {
    expect(normalizeRootPath('  ~\\.cc-switch\\skills  ')).toBe('~/.cc-switch/skills')
    expect(normalizeRootPath('~/.cc-switch/skills')).toBe('~/.cc-switch/skills')
    expect(normalizeRootPath('C:\\skills')).toBe('C:\\skills')
    expect(() => normalizeRootPath('relative/skills')).toThrow(ExtensionError)
    expect(() => normalizeRootPath('')).toThrow('路径不能为空')
  })

  it('展开 ~ 到家目录', () => {
    expect(expandRootPath('C:\\Users\\fixture', '~/.cc-switch/skills')).toBe(
      join('C:\\Users\\fixture', '.cc-switch', 'skills')
    )
  })
})

describe('SkillRootStore', () => {
  it('添加、持久化并删除自定义路径', async () => {
    const home = await tempHome()
    const dir = join(home, '.cc-switch', 'skills')
    await mkdir(dir, { recursive: true })
    const file = join(home, 'skill-roots.json')
    const store = new SkillRootStore(file)

    await store.add('~/.cc-switch/skills', home)
    expect(await store.list()).toEqual(['~/.cc-switch/skills'])

    // 新实例从磁盘读回，证明不是内存状态。
    expect(await new SkillRootStore(file).list()).toEqual(['~/.cc-switch/skills'])

    await store.remove('~/.cc-switch/skills')
    expect(await store.list()).toEqual([])
  })

  it('拒绝不存在的路径、文件、重复路径与默认路径', async () => {
    const home = await tempHome()
    const store = new SkillRootStore(join(home, 'skill-roots.json'))
    const existing = join(home, 'skills')
    await mkdir(existing, { recursive: true })

    await expect(store.add('~/missing', home)).rejects.toThrow('路径不存在')
    await expect(store.add(existing, home)).resolves.toEqual([existing])
    await expect(store.add(existing, home)).rejects.toThrow('已经添加')

    const file = join(home, 'a.txt')
    await writeFile(file, 'x', 'utf8')
    await expect(store.add(file, home)).rejects.toThrow('文件夹')

    await mkdir(join(home, '.agents', 'skills'), { recursive: true })
    await expect(store.add(join(home, '.agents', 'skills'), home)).rejects.toThrow('默认来源')
  })

  it('设置页视图只列 5 个默认来源，并标出自定义路径', async () => {
    const home = await tempHome()
    for (const dir of ['.agents/skills', '.claude/skills', '.codex/skills', '.config/opencode/skills', '.dsh/skills'])
      await mkdir(join(home, dir), { recursive: true })
    await mkdir(join(home, '.cc-switch', 'skills'), { recursive: true })
    const store = new SkillRootStore(join(home, 'skill-roots.json'))
    await store.add('~/.cc-switch/skills', home)

    const view = await skillRootsView(store, home, {})
    expect(view.defaults).toHaveLength(5)
    expect(view.defaults.every((item) => item.exists)).toBe(true)
    expect(view.custom).toEqual([
      {
        path: '~/.cc-switch/skills',
        displayPath: '~/.cc-switch/skills',
        kind: 'custom',
        exists: true,
        label: '自定义路径'
      }
    ])
  })
})
