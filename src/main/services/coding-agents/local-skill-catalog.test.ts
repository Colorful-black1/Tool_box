import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverLocalSkills, resolveLocalSkill } from './local-skill-catalog'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith('toolbox-local-skills-')
    )
      throw new Error('拒绝清理非本用例目录')
    await rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'toolbox-local-skills-'))
  roots.push(root)
  const project = join(root, 'project'),
    home = join(root, 'home')
  await mkdir(project)
  await mkdir(home)
  const skill = async (
    folder: string,
    name: string,
    extra = '',
    description = '用途说明'
  ): Promise<string> => {
    const dir = join(folder, name)
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'SKILL.md')
    await writeFile(
      file,
      `---\nname: ${name}\ndescription: ${description}\n${extra}---\n正文不应进入目录快照`
    )
    return file
  }
  return { root, project, home, skill }
}
describe('本机 Skill 发现与引用', () => {
  it('从 CC Switch 发现链接分发的 Skill，并按名称去重，项目优先', async () => {
    const f = await fixture()
    const managed = join(f.home, '.cc-switch', 'skills')
    const global = join(f.home, '.claude', 'skills')
    await f.skill(managed, 'design-review')
    await f.skill(managed, 'dogfood')
    await mkdir(global, { recursive: true })
    await symlink(join(managed, 'design-review'), join(global, 'design-review'), 'junction')
    const projectSkill = await f.skill(
      join(f.project, '.agents', 'skills'),
      'design-review',
      '',
      '项目说明'
    )
    const result = await discoverLocalSkills('claude', f.project, f.home, {})
    expect(result.skills.map((item) => item.name).sort()).toEqual(['design-review', 'dogfood'])
    expect(result.skills.find((item) => item.name === 'design-review')?.path).toBe(
      await realpath(projectSkill)
    )
    expect(JSON.stringify(result)).not.toContain('正文不应进入目录快照')
    expect(result.notices).toEqual([])
  })
  it('所有已接入 Agent 均能列出共享与 CC Switch Skill', async () => {
    const f = await fixture()
    await f.skill(join(f.home, '.cc-switch', 'skills'), 'impeccable')
    for (const id of ['codex', 'opencode', 'claude', 'claude-desktop', 'dsh'] as const)
      expect((await discoverLocalSkills(id, f.project, f.home, {})).skills[0].name).toBe(
        'impeccable'
      )
  })
  it('支持折叠说明，跳过明确不可手动调用的技能及越出已知根的链接', async () => {
    const f = await fixture()
    const shared = join(f.home, '.agents', 'skills')
    await f.skill(shared, 'folded', '', '>\n  第一行\n  第二行')
    await f.skill(shared, 'hidden', 'user-invocable: false\n')
    const outside = join(f.root, 'outside')
    await f.skill(outside, 'escape')
    await symlink(join(outside, 'escape'), join(shared, 'escape'), 'junction')
    const result = await discoverLocalSkills('opencode', f.project, f.home, {})
    expect(result.skills.map((item) => item.name)).toEqual(['folded'])
    expect(result.skills[0].description).toContain('第一行 第二行')
    expect(result.notices).toHaveLength(1)
  })
  it('引用删除后拒绝发送；项目不存在不扫描全局根', async () => {
    const f = await fixture()
    const file = await f.skill(join(f.home, '.agents', 'skills'), 'verify')
    const actual = await realpath(file)
    expect(await resolveLocalSkill(actual)).toBe(actual)
    await rm(file)
    await expect(resolveLocalSkill(actual)).rejects.toThrow('已失效')
    expect((await discoverLocalSkills('codex', join(f.root, 'absent'), f.home, {})).skills).toEqual(
      []
    )
  })
})
