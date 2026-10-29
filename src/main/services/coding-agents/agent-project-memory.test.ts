import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { CODING_AGENT_IDS } from '../../../shared/coding-agents'
import { AGENT_CONFIG_KEYS } from '../../../shared/agent-projects'
import { AgentProjectMemory } from './agent-project-memory'

const roots: string[] = []
async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'toolbox-project-memory-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(root) !== tmpdir() || !basename(root).startsWith('toolbox-project-memory-'))
      throw new Error('测试清理路径不在预期临时目录')
    await rm(root, { recursive: true, force: true })
  }
})

function fixture(initial: Record<string, unknown> = {}) {
  let config = initial
  const store = {
    configGet: () => config,
    configSet: vi.fn((patch: Record<string, unknown>) => (config = { ...config, ...patch }))
  }
  return { store, memory: new AgentProjectMemory(store) }
}

describe('Agent 项目选择记忆', () => {
  it('未连接即可按 Agent 保存，重建服务后仍独立恢复规范目录', async () => {
    const root = await temporaryDirectory()
    const { store, memory } = fixture()
    for (const id of CODING_AGENT_IDS) {
      const directory = join(root, id)
      await mkdir(directory)
      expect(await memory.select(id, directory)).toBe(await realpath(directory))
    }
    const restarted = new AgentProjectMemory(store)
    for (const id of CODING_AGENT_IDS) {
      const directory = await realpath(join(root, id))
      expect(await restarted.inspect(id)).toEqual({ projectDirectory: directory })
      expect(store.configGet()[AGENT_CONFIG_KEYS[id]]).toEqual({ directory })
    }
  })

  it('Desktop 旧别名迁入规范键，同时保留程序、扩展和会话偏好', async () => {
    const root = await temporaryDirectory()
    const preferences = {
      executablePath: '/fixture/claude.exe',
      extensionDirectories: ['/old'],
      sessionIds: ['s1']
    }
    const { store, memory } = fixture({
      'claude-desktop': preferences,
      claude: { directory: '/code' }
    })
    await memory.select('claude-desktop', root)
    expect(store.configGet().claudeDesktop).toEqual({
      ...preferences,
      directory: await realpath(root)
    })
    expect(store.configGet().claude).toEqual({ directory: '/code' })
  })

  it('失效记忆只提示，失败选择不覆盖原记忆、不创建目录', async () => {
    const root = await temporaryDirectory()
    const missing = join(root, 'missing')
    const file = join(root, 'file')
    await writeFile(file, '')
    const { store, memory } = fixture({ codex: { directory: missing } })
    expect(await memory.inspect('codex')).toEqual({
      projectDirectory: missing,
      projectError: expect.stringContaining('不可访问')
    })
    await expect(memory.select('codex', missing)).rejects.toThrow('不可访问')
    await expect(memory.select('codex', file)).rejects.toThrow('不可访问')
    await expect(memory.select('codex', 'relative')).rejects.toThrow('绝对目录')
    expect(store.configSet).not.toHaveBeenCalled()
    expect(await memory.inspect('claude')).toEqual({ projectDirectory: '' })
  })
})
