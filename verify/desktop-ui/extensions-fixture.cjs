/** 合成技能 / MCP 桥接：不读本机目录，不发真实网络请求。 */
module.exports = function extensionsFixture() {
  const now = new Date().toISOString()
  const root = 'C:\\Users\\fixture'
  const skillSources = [
    ['agents', '通用技能目录', '\\.agents\\skills', 1, 'ready'],
    ['claude', 'Claude Code 技能', '\\.claude\\skills', 1, 'ready'],
    ['codex', 'Codex 技能', '\\.codex\\skills', 0, 'empty'],
    ['codex-system', 'Codex 自带技能', '\\.codex\\skills\\.system', 1, 'ready'],
    ['opencode', 'OpenCode 技能', '\\.config\\opencode\\skills', 0, 'missing'],
    ['dsh', 'DeepSeek Harness 技能', '\\.dsh\\skills', 0, 'missing'],
    ['cc-switch', 'CC Switch 主副本', '\\.cc-switch\\skills', 2, 'ready']
  ].map(([id, label, suffix, count, status]) => ({
    id,
    label,
    path: root + suffix,
    displayPath: `~${String(suffix).replaceAll('\\', '/')}`,
    count,
    status,
    detail:
      status === 'ready' ? '已读取' : status === 'empty' ? '目录存在，但没有技能' : '未发现该目录'
  }))

  const skills = [
    {
      name: 'alpha',
      description: '通用目录里的版本，用于验证同名分组。',
      path: `${root}\\.agents\\skills\\alpha\\SKILL.md`,
      displayPath: '~/.agents/skills/alpha/SKILL.md',
      root: '~/.agents/skills',
      agents: ['universal'],
      bundled: false,
      conflict: true,
      contentHash: 'aaaaaaaaaaaa'
    },
    {
      name: 'alpha',
      description: 'CC Switch 副本，内容与通用目录不同。',
      path: `${root}\\.cc-switch\\skills\\alpha\\SKILL.md`,
      displayPath: '~/.cc-switch/skills/alpha/SKILL.md',
      root: '~/.cc-switch/skills',
      agents: [],
      bundled: false,
      conflict: true,
      contentHash: 'bbbbbbbbbbbb'
    },
    {
      name: 'beta',
      description: 'Codex 自带技能。',
      path: `${root}\\.codex\\skills\\.system\\beta\\SKILL.md`,
      displayPath: '~/.codex/skills/.system/beta/SKILL.md',
      root: '~/.codex/skills/.system',
      agents: ['codex'],
      bundled: true,
      conflict: false,
      contentHash: null
    },
    {
      name: 'gamma',
      description: '被两个 Agent 链接的技能。',
      path: `${root}\\.cc-switch\\skills\\gamma\\SKILL.md`,
      displayPath: '~/.cc-switch/skills/gamma/SKILL.md',
      root: '~/.cc-switch/skills',
      agents: ['claude', 'opencode'],
      bundled: false,
      conflict: false,
      contentHash: null
    }
  ]

  const mcpSources = [
    ['claude', 'Claude Code', '~/.claude.json', 1, 'ready'],
    ['codex', 'Codex', '~/.codex/config.toml', 1, 'ready'],
    ['opencode', 'OpenCode', '~/.config/opencode/opencode.json', 1, 'ready'],
    ['dsh-web', 'DSH（web profile）', '~/.dsh/profiles/web/cordis.patch.yml', 0, 'missing'],
    [
      'dsh-desktop',
      'DSH（desktop profile）',
      '~/.dsh/profiles/desktop/cordis.patch.yml',
      0,
      'missing'
    ],
    [
      'claude-desktop',
      'Claude Desktop',
      '~/AppData/Roaming/Claude/claude_desktop_config.json',
      0,
      'missing'
    ],
    ['gemini', 'Gemini CLI', '~/.gemini/settings.json', 0, 'missing'],
    ['cursor', 'Cursor', '~/.cursor/mcp.json', 0, 'missing'],
    ['vscode', 'VS Code', '~/AppData/Roaming/Code/mcp.json', 0, 'missing']
  ].map(([id, label, displayPath, count, status]) => ({
    id,
    label,
    path: `${root}${String(displayPath).slice(1).replaceAll('/', '\\')}`,
    displayPath,
    count,
    status,
    detail: status === 'ready' ? '已读取' : '未发现该配置文件'
  }))

  const mcpEntry = (overrides) => ({
    transport: 'stdio',
    command: null,
    argCount: null,
    urlHost: null,
    envKeys: [],
    headerKeys: [],
    enabled: true,
    sourceId: 'claude',
    sourceLabel: 'Claude Code',
    sourceDisplay: '~/.claude.json',
    conflict: false,
    agent: 'claude',
    ...overrides
  })

  const servers = [
    mcpEntry({
      name: 'playwright',
      command: 'cmd',
      argCount: 2,
      envKeys: ['SECRET_TOKEN'],
      conflict: true
    }),
    mcpEntry({
      name: 'playwright',
      command: 'npx',
      argCount: 2,
      sourceId: 'opencode',
      sourceLabel: 'OpenCode',
      sourceDisplay: '~/.config/opencode/opencode.json',
      agent: 'opencode',
      conflict: true
    }),
    mcpEntry({
      name: 'node_repl',
      command: 'node.exe',
      argCount: 0,
      envKeys: ['TOKEN'],
      enabled: false,
      sourceId: 'codex',
      sourceLabel: 'Codex',
      sourceDisplay: '~/.codex/config.toml',
      agent: 'codex'
    })
  ]

  const skillPages = [
    {
      query: 'pdf',
      items: [
        {
          id: 'anthropics/skills:pdf',
          name: 'pdf',
          source: 'anthropics/skills',
          installs: 228292,
          repositoryUrl: 'https://github.com/anthropics/skills',
          installCommand: 'npx skills add anthropics/skills --skill pdf -g'
        }
      ],
      hasMore: true
    },
    {
      query: 'pdf',
      items: [
        {
          id: 'anthropics/skills:docx',
          name: 'docx',
          source: 'anthropics/skills',
          installs: 217653,
          repositoryUrl: 'https://github.com/anthropics/skills',
          installCommand: 'npx skills add anthropics/skills --skill docx -g'
        }
      ],
      hasMore: false
    }
  ]

  const mcpPages = [
    {
      query: '',
      items: [
        {
          name: 'com.pulsemcp/remote-filesystem',
          title: 'Remote Filesystem',
          description: 'MCP server for remote filesystem operations on cloud storage.',
          version: '0.1.2',
          transport: 'stdio',
          commandLine: 'npx -y remote-filesystem-mcp-server@0.1.2',
          configSnippet:
            '{\n  "mcpServers": {\n    "remote-filesystem": {\n      "command": "npx",\n      "args": ["-y", "remote-filesystem-mcp-server@0.1.2"],\n      "env": {\n        "GCS_BUCKET": "<在此填写>"\n      }\n    }\n  }\n}',
          repositoryUrl: 'https://github.com/pulsemcp/mcp-servers',
          remoteUrl: null
        }
      ],
      nextCursor: 'cursor-1'
    },
    {
      query: '',
      items: [
        {
          name: 'com.example/remote',
          title: 'Remote HTTP Server',
          description: '远程 MCP 服务，走 streamable-http。',
          version: '1.0.0',
          transport: 'http',
          commandLine: null,
          configSnippet:
            '{\n  "mcpServers": {\n    "remote": {\n      "type": "http",\n      "url": "https://mcp.example.com/mcp"\n    }\n  }\n}',
          repositoryUrl: null,
          remoteUrl: 'https://mcp.example.com/mcp'
        }
      ],
      nextCursor: null
    }
  ]

  const calls = { skill: [], mcp: [] }
  const rootsState = {
    defaults: [
      ['通用技能目录', '~/.agents/skills'],
      ['Claude Code 技能', '~/.claude/skills'],
      ['Codex 技能', '~/.codex/skills'],
      ['OpenCode 技能', '~/.config/opencode/skills'],
      ['DeepSeek Harness 技能', '~/.dsh/skills']
    ].map(([label, displayPath]) => ({
      path: `${root}${String(displayPath).slice(1).replaceAll('/', '\\')}`,
      displayPath,
      kind: 'default',
      exists: true,
      label
    })),
    custom: []
  }
  const rootsView = () => ({
    defaults: rootsState.defaults.map((item) => ({ ...item })),
    custom: rootsState.custom.map((item) => ({ ...item }))
  })

  return {
    bridge: {
      skillHub: {
        list: async () => ({
          skills,
          sources: skillSources,
          scannedAt: now,
          notices: ['1 个技能目录指向扫描范围之外，未列出（可在对应 Agent 目录内查看）。']
        }),
        search: async (input) => {
          calls.skill.push({ ...input })
          const page = input.offset ? skillPages[1] : skillPages[0]
          return { query: input.query, items: page.items, hasMore: page.hasMore }
        },
        roots: async () => rootsView(),
        addRoot: async (path) => {
          rootsState.custom.push({
            path,
            displayPath: path,
            kind: 'custom',
            exists: true,
            label: '自定义路径'
          })
          return rootsView()
        },
        removeRoot: async (path) => {
          rootsState.custom = rootsState.custom.filter((item) => item.path !== path)
          return rootsView()
        }
      },
      mcpHub: {
        list: async () => ({
          servers,
          sources: mcpSources,
          scannedAt: now,
          notices: []
        }),
        search: async (input) => {
          calls.mcp.push({ ...input })
          const page = input.cursor ? mcpPages[1] : mcpPages[0]
          return { query: input.query, items: page.items, nextCursor: page.nextCursor }
        }
      }
    },
    controls: {
      extensionCalls: () => calls
    }
  }
}
