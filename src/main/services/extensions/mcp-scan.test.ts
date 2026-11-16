import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parseCodexMcp, scanMcp } from './mcp-scan'

const homes: string[] = []

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'toolbox-mcp-scan-'))
  homes.push(home)
  return home
}

async function file(home: string, relative: string, content: string): Promise<void> {
  const target = join(home, relative)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, content, 'utf8')
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe('scanMcp', () => {
  it('汇总 Claude / Codex / OpenCode / DSH 的配置，且不返回密钥值', async () => {
    const home = await tempHome()
    await file(
      home,
      '.claude.json',
      JSON.stringify({
        mcpServers: {
          playwright: {
            command: 'cmd',
            args: ['/c', 'npx'],
            env: { SECRET_TOKEN: '不要出现的值' }
          }
        },
        projects: {
          [join(home, 'demo')]: {
            mcpServers: { demo: { type: 'stdio', command: 'uvx', args: ['demo-mcp'] } }
          }
        }
      })
    )
    await file(
      home,
      '.codex/config.toml',
      [
        '[mcp_servers.node_repl]',
        "command = 'C:\\\\tools\\\\node.exe'",
        'args = ["-y", "pkg"]',
        '',
        '[mcp_servers.node_repl.env]',
        'TOKEN = "另一个不该出现的值"',
        '',
        '[mcp_servers.playwright]',
        'command = "npx"',
        'args = ["-y", "@playwright/mcp@latest"]',
        ''
      ].join('\n')
    )
    await file(
      home,
      '.config/opencode/opencode.json',
      JSON.stringify({
        mcp: { playwright: { type: 'local', command: ['npx', '-y', '@playwright/mcp@latest'] } }
      })
    )
    await file(
      home,
      '.dsh/profiles/desktop/cordis.patch.yml',
      [
        '- id: mcp-blender',
        '  name: "@deepseek-ai/dsh-mcp-client"',
        '  config:',
        '    serverName: blender',
        '    transport: stdio',
        "    command: 'E:\\\\python\\\\Scripts\\\\uvx.exe'",
        '    args:',
        '      - --python',
        '      - "3.11"',
        '      - mcp-for-blender',
        '    env:',
        '      BLENDER_HOST: localhost',
        '      BLENDER_PORT: "9876"',
        '    toolCallTimeoutMs: 120000',
        ''
      ].join('\n')
    )

    const result = await scanMcp({ home, env: {} })

    expect(result.servers).toHaveLength(6)
    const playwright = result.servers.filter((item) => item.name === 'playwright')
    expect(playwright).toHaveLength(3)
    expect(playwright.every((item) => item.conflict)).toBe(true)
    expect(playwright.map((item) => item.command).sort()).toEqual(['cmd', 'npx', 'npx'])

    const codex = result.servers.find((item) => item.name === 'node_repl')
    expect(codex).toMatchObject({ transport: 'stdio', command: 'node.exe', argCount: 2 })
    expect(codex?.envKeys).toEqual(['TOKEN'])

    const blender = result.servers.find((item) => item.name === 'blender')
    expect(blender).toMatchObject({ transport: 'stdio', command: 'uvx.exe', argCount: 3 })
    expect(blender?.envKeys).toEqual(['BLENDER_HOST', 'BLENDER_PORT'])

    const project = result.servers.find((item) => item.name === 'demo')
    expect(project?.sourceLabel).toContain('demo')
    expect(project?.sourceDisplay).toContain('demo')

    expect(JSON.stringify(result)).not.toContain('不要出现的值')
    expect(JSON.stringify(result)).not.toContain('另一个不该出现的值')
    expect(JSON.stringify(result)).not.toContain('localhost')

    expect(result.sources.find((item) => item.id === 'dsh-web')?.status).toBe('missing')
    expect(result.sources.find((item) => item.id === 'dsh-desktop')?.status).toBe('ready')
  })

  it('TOML 只认 mcp_servers 顶层表与 env 子表', () => {
    const entries = parseCodexMcp(
      [
        '[mcp_servers."browser.tools"]',
        'command = "npx"',
        'args = ["-y"]',
        'enabled = false',
        '',
        '[mcp_servers."browser.tools".env]',
        'API_KEY = "x"',
        '',
        '[other]',
        'command = "ignored"'
      ].join('\n')
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      name: 'browser.tools',
      command: 'npx',
      argCount: 1,
      enabled: false,
      envKeys: ['API_KEY']
    })
  })
})
