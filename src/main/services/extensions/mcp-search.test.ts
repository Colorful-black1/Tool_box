import { describe, expect, it, vi } from 'vitest'

import { searchMcp } from './mcp-search'

const payload = {
  servers: [
    {
      server: {
        name: 'com.pulsemcp/remote-filesystem',
        title: 'Remote Filesystem',
        description: 'MCP server for remote filesystem\noperations on cloud storage.',
        version: '0.1.2',
        repository: { url: 'https://github.com/pulsemcp/mcp-servers' },
        packages: [
          {
            registryType: 'npm',
            identifier: 'remote-filesystem-mcp-server',
            version: '0.1.2',
            runtimeHint: 'npx',
            runtimeArguments: [{ type: 'positional', value: '-y' }],
            transport: { type: 'stdio' },
            environmentVariables: [{ name: 'GCS_BUCKET', isRequired: true }]
          }
        ]
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } }
    },
    {
      server: { name: 'com.example/old', version: '0.0.1', packages: [] },
      _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: false } }
    },
    {
      server: {
        name: 'com.example/remote',
        version: '1.0.0',
        remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp' }]
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } }
    }
  ],
  metadata: { nextCursor: 'cursor-1' }
}

const respond = (value: unknown, status = 200): ReturnType<typeof vi.fn> =>
  vi.fn(async () => new Response(JSON.stringify(value), { status }))

describe('searchMcp', () => {
  it('把 Registry 条目映射成启动命令与可粘贴的配置片段', async () => {
    const fetchImpl = respond(payload)
    const result = await searchMcp(
      { query: 'filesystem', limit: 20 },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )

    const url = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(url.origin).toBe('https://registry.modelcontextprotocol.io')
    expect(url.pathname).toBe('/v0/servers')
    expect(url.searchParams.get('search')).toBe('filesystem')

    expect(result.items).toHaveLength(2)
    const [stdio, remote] = result.items
    expect(stdio.commandLine).toBe('npx -y remote-filesystem-mcp-server@0.1.2')
    expect(stdio.description).not.toContain('\n')
    expect(stdio.configSnippet).toContain('"mcpServers"')
    expect(stdio.configSnippet).toContain('"GCS_BUCKET": "<在此填写>"')
    expect(stdio.repositoryUrl).toBe('https://github.com/pulsemcp/mcp-servers')

    expect(remote.transport).toBe('http')
    expect(remote.commandLine).toBeNull()
    expect(remote.configSnippet).toContain('"url": "https://mcp.example.com/mcp"')
    expect(result.nextCursor).toBe('cursor-1')
  })

  it('空关键词只带 limit，不传 search', async () => {
    const fetchImpl = respond(payload)
    await searchMcp({ query: '   ' }, { fetchImpl: fetchImpl as unknown as typeof fetch })
    const url = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(url.searchParams.has('search')).toBe(false)
  })

  it('失败时回退到可读文案', async () => {
    const broken = respond({}, 500)
    await expect(
      searchMcp({ query: 'x' }, { fetchImpl: broken as unknown as typeof fetch })
    ).rejects.toThrow('HTTP 500')
  })
})
