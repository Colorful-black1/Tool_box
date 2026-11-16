import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { scanSkills } from './skill-scan'

const roots: string[] = []

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'toolbox-skill-scan-'))
  roots.push(home)
  return home
}

async function skill(
  home: string,
  relative: string,
  name: string,
  description: string
): Promise<void> {
  const dir = join(home, relative)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    'utf8'
  )
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('scanSkills', () => {
  it('同一个物理目录被链接进多个 Agent 时只算一条，并记录来源 Agent', async () => {
    const home = await tempHome()
    await skill(home, '.agents/skills/alpha', 'alpha', '第一位描述')
    const link = join(home, '.claude/skills/alpha')
    await mkdir(join(home, '.claude/skills'), { recursive: true })
    await symlink(
      join(home, '.agents/skills/alpha'),
      link,
      process.platform === 'win32' ? 'junction' : 'dir'
    )

    const result = await scanSkills({ home, env: {} })

    const copies = result.skills.filter((item) => item.name === 'alpha')
    expect(copies).toHaveLength(1)
    expect(copies[0].agents).toEqual(expect.arrayContaining(['universal', 'claude']))
    expect(copies[0].root).toBe('~/.agents/skills')
    expect(copies[0].conflict).toBe(false)
    expect(result.sources.find((item) => item.id === 'claude')?.count).toBe(1)
  })

  it('同名不同路径标记冲突，并给出不同的内容摘要', async () => {
    const home = await tempHome()
    await skill(home, '.agents/skills/alpha', 'alpha', '通用目录版本')
    await skill(home, '.claude/skills/alpha', 'alpha', 'Claude 目录版本，内容不同')

    const result = await scanSkills({ home, env: {} })

    const copies = result.skills.filter((item) => item.name === 'alpha')
    expect(copies).toHaveLength(2)
    expect(copies.every((item) => item.conflict)).toBe(true)
    expect(new Set(copies.map((item) => item.contentHash)).size).toBe(2)
    expect(result.skills.map((item) => item.root).sort()).toEqual([
      '~/.agents/skills',
      '~/.claude/skills'
    ])
  })

  it('Codex 自带技能单独标记，未安装的目录报 missing', async () => {
    const home = await tempHome()
    await skill(home, '.codex/skills/.system/beta', 'beta', '系统技能')

    const result = await scanSkills({ home, env: {} })

    const beta = result.skills.find((item) => item.name === 'beta')
    expect(beta?.bundled).toBe(true)
    expect(beta?.agents).toEqual(['codex'])
    expect(result.sources.find((item) => item.id === 'opencode')?.status).toBe('missing')
    expect(result.sources.find((item) => item.id === 'codex-system')?.status).toBe('ready')
  })

  it('指向扫描根之外的技能目录静默跳过', async () => {
    const home = await tempHome()
    await skill(home, 'outside/alpha', 'alpha', '范围外')
    await mkdir(join(home, '.agents/skills'), { recursive: true })
    await symlink(
      join(home, 'outside/alpha'),
      join(home, '.agents/skills/alpha'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )

    const result = await scanSkills({ home, env: {} })

    expect(result.skills).toEqual([])
    expect(result.notices).toEqual([])
  })

  it('自定义路径加入后才统计，默认不扫描 CC Switch 主副本', async () => {
    const home = await tempHome()
    await skill(home, '.cc-switch/skills/delta', 'delta', '主副本')

    const without = await scanSkills({ home, env: {} })
    expect(without.skills).toEqual([])
    expect(without.sources.some((item) => item.id === 'cc-switch')).toBe(false)

    const withRoot = await scanSkills({
      home,
      env: {},
      extraRoots: [join(home, '.cc-switch', 'skills')]
    })
    expect(withRoot.skills.map((item) => item.name)).toEqual(['delta'])
    expect(withRoot.skills[0].agents).toEqual([])
    expect(withRoot.sources.find((item) => item.id === 'custom-1')?.status).toBe('ready')
  })
})
