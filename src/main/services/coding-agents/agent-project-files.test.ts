import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { AgentProjectFiles } from './agent-project-files'

const roots: string[] = []
async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'toolbox-agent-refs-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(root) !== tmpdir() || !basename(root).startsWith('toolbox-agent-refs-'))
      throw new Error('测试清理路径不在预期临时目录中')
    await rm(root, { recursive: true, force: true })
  }
})

describe('项目文件引用', () => {
  it('仅列普通项目文件，过滤敏感名称与依赖目录，引用按窗口隔离', async () => {
    const root = await temporaryProject()
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules', 'hidden.ts'), '')
    await writeFile(join(root, '.env.local'), 'fixture')
    await writeFile(join(root, '证书.key'), 'fixture')
    await writeFile(join(root, '中文 file.ts'), 'fixture')
    const files = new AgentProjectFiles()
    const result = await files.search('1:codex', root, '')
    expect(result.files.map((item) => item.label)).toEqual(['中文 file.ts'])
    expect(await files.resolve('1:codex', root, result.files[0])).toBe(join(root, '中文 file.ts'))
    await expect(files.resolve('2:codex', root, result.files[0])).rejects.toThrow('失效')
    await rm(join(root, '中文 file.ts'))
    await expect(files.resolve('1:codex', root, result.files[0])).rejects.toThrow('失效')
  })

  it('发送前再检查 junction 的实际落点，不能越出根目录', async () => {
    const root = await temporaryProject()
    const other = await temporaryProject()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'index.ts'), 'fixture')
    await writeFile(join(other, 'index.ts'), 'fixture')
    const files = new AgentProjectFiles()
    const result = await files.search('1:codex', root, 'index')
    await rm(join(root, 'src'), { recursive: true })
    await symlink(other, join(root, 'src'), 'junction')
    await expect(files.resolve('1:codex', root, result.files[0])).rejects.toThrow('越出项目')
  })
})
