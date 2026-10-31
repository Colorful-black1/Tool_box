import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configuredMcpToml, discoverConfiguredMcp, parseMcpJson } from './local-mcp-catalog'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith('toolbox-local-mcp-')
    )
      throw new Error('拒绝清理非本用例目录')
    await rm(root, { recursive: true, force: true })
  }
})
describe('MCP 配置只读元数据', () => {
  it('JSONC 保留字符串里的注释与逗号字符，拒绝未闭合注释', () => {
    expect(
      parseMcpJson('{ /* note */ "url":"https://example.test/a,}", "mcp":{}, // note\n }').url
    ).toBe('https://example.test/a,}')
    expect(() => parseMcpJson('{/* broken')).toThrow()
  })
  it('TOML 的 env 子表不是服务，子表值不能改变所属服务状态', () => {
    expect(
      configuredMcpToml(
        '[mcp_servers.node_repl]\n[mcp_servers.node_repl.env]\nenabled = false\n[mcp_servers."browser.tools"]\nenabled = false'
      )
    ).toEqual([
      { name: 'node_repl', enabled: true },
      { name: 'browser.tools', enabled: false }
    ])
  })
  it('只返回服务名称与开关，不暴露执行参数、URL、环境变量或认证', async () => {
    const root = await mkdtemp(join(tmpdir(), 'toolbox-local-mcp-'))
    roots.push(root)
    const home = join(root, 'home'),
      project = join(root, 'project')
    await mkdir(home)
    await mkdir(project)
    await writeFile(
      join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          browser: {
            command: 'PRIVATE_COMMAND',
            args: ['PRIVATE_ARGS'],
            env: { secret: 'PRIVATE_ENV' }
          }
        }
      })
    )
    await writeFile(
      join(project, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          docs: {
            url: 'https://PRIVATE_URL',
            headers: { Authorization: 'PRIVATE_HEADER' },
            disabled: true
          }
        }
      })
    )
    const result = await discoverConfiguredMcp('claude', project, home, {})
    expect(result.mcp.map((item) => item.name)).toEqual(['browser', 'docs'])
    expect(result.mcp[0].status).toContain('未验证连接')
    expect(result.mcp[1].status).toContain('已禁用')
    expect(JSON.stringify(result)).not.toContain('PRIVATE_')
    // Desktop 继续不加载／发现 CLI 用户配置。
    expect(
      (await discoverConfiguredMcp('claude-desktop', project, home, {})).mcp.map(
        (item) => item.name
      )
    ).toEqual(['docs'])
  })
})
