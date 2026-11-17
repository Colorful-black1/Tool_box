import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import { EXTENSION_AGENTS, EXTENSION_AGENT_IDS } from '@shared/extensions'
import type {
  ExtensionAgentId,
  McpEntryView,
  McpScanResult,
  McpSearchResult,
  McpTransport
} from '@shared/extensions'

import { ipcErrorText } from '../../lib/extension-errors'
import { Dropdown } from '../dropdown'
import { RefreshIcon } from '../icons'
import { AgentChips } from '../extensions/agent-chips'
import { ExtensionTabs } from '../extensions/extension-tabs'
import type { ExtensionTab, ExtensionTabItem } from '../extensions/extension-tabs'
import { useCopy } from '../extensions/use-copy'

interface ServerGroup {
  name: string
  copies: McpEntryView[]
  agents: ExtensionAgentId[]
  conflict: boolean
}

const TRANSPORT_LABEL: Record<McpTransport, string> = {
  stdio: 'stdio',
  http: 'http',
  sse: 'sse',
  unknown: '未知'
}

function groupServers(servers: McpEntryView[]): ServerGroup[] {
  const groups = new Map<string, ServerGroup>()
  for (const server of servers) {
    const group = groups.get(server.name) ?? {
      name: server.name,
      copies: [],
      agents: [],
      conflict: false
    }
    group.copies.push(server)
    group.conflict = group.conflict || server.conflict
    if (!group.agents.includes(server.agent)) group.agents.push(server.agent)
    groups.set(server.name, group)
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function timeLabel(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
}

const MCP_TABS: ExtensionTabItem[] = [
  { value: 'local', label: '本机 MCP' },
  { value: 'search', label: '在线搜索' }
]

/** 本机 MCP 只读看板 + 官方 Registry 在线搜索；配置片段由用户自己粘贴。 */
export function McpPage(): JSX.Element {
  const [result, setResult] = useState<McpScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<ExtensionTab>('local')
  const [keyword, setKeyword] = useState('')
  const [agent, setAgent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<McpSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const { copied, copy } = useCopy()

  const load = useCallback(async (refresh: boolean): Promise<void> => {
    const bridge = window.toolbox?.mcpHub
    if (!bridge) {
      setError('当前版本未提供 MCP 列表，请更新并重启应用')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      setResult(await bridge.list({ refresh }))
    } catch (reason) {
      setError(ipcErrorText(reason, '读取本机 MCP 失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  const groups = useMemo(() => groupServers(result?.servers ?? []), [result])
  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    return groups.filter((group) => {
      if (agent && !group.agents.includes(agent as ExtensionAgentId)) return false
      if (!needle) return true
      return (
        group.name.toLowerCase().includes(needle) ||
        group.copies.some(
          (item) =>
            item.sourceLabel.toLowerCase().includes(needle) ||
            item.command?.toLowerCase().includes(needle) ||
            item.urlHost?.toLowerCase().includes(needle)
        )
      )
    })
  }, [groups, keyword, agent])

  const servers = result?.servers ?? []
  const metrics = [
    { label: '配置条数', value: String(servers.length) },
    { label: '不同服务', value: String(groups.length) },
    { label: '已启用', value: String(servers.filter((item) => item.enabled).length) },
    { label: '启动方式冲突', value: String(groups.filter((group) => group.conflict).length) }
  ]

  const agentOptions = [
    { value: '', label: '全部 Agent' },
    ...EXTENSION_AGENT_IDS.map((id) => ({ value: id, label: EXTENSION_AGENTS[id] }))
  ]

  const runSearch = async (cursor?: string): Promise<void> => {
    const bridge = window.toolbox?.mcpHub
    if (!bridge) {
      setSearchError('当前版本未提供在线搜索，请更新并重启应用')
      return
    }
    setSearching(true)
    setSearchError('')
    try {
      const next = await bridge.search({
        query: searchQuery.trim(),
        limit: 20,
        ...(cursor ? { cursor } : {})
      })
      setSearchResult((previous) =>
        cursor && previous ? { ...next, items: [...previous.items, ...next.items] } : next
      )
    } catch (reason) {
      setSearchError(ipcErrorText(reason, '搜索失败，请稍后重试'))
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="ext-page view-enter">
      <header className="ext-heading">
        <ExtensionTabs
          id="mcp-ext"
          label="MCP 视图"
          value={tab}
          tabs={MCP_TABS}
          onChange={setTab}
        />
        {tab === 'local' ? (
          <div className="ext-actions">
            <span className="field-hint">
              {result ? `扫描于 ${timeLabel(result.scannedAt)}` : '尚未扫描'}
            </span>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void load(true)}
              disabled={loading}
              aria-label="重新扫描本机 MCP"
            >
              <RefreshIcon />
              刷新
            </button>
          </div>
        ) : null}
      </header>

      {tab === 'local' ? (
        <div
          className="ext-tab-panel"
          id="mcp-ext-panel-local"
          role="tabpanel"
          aria-labelledby="mcp-ext-tab-local"
        >
          {error ? (
            <div className="status-banner" role="alert">
              <span>{error}</span>
            </div>
          ) : null}

          <div className="ext-metrics">
            {metrics.map((metric) => (
              <div className="glass ext-metric" key={metric.label}>
                <span className="field-label">{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>

          <div className="glass ext-filters">
            <input
              className="field-input"
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="筛选名称、来源或地址"
              aria-label="筛选本机 MCP"
            />
            <Dropdown
              value={agent}
              options={agentOptions}
              onChange={setAgent}
              ariaLabel="按 Agent 筛选 MCP"
            />
            <span className="field-hint">
              {filtered.length} / {groups.length}
            </span>
          </div>

          {loading && !result ? (
            <div>
              <div className="loading-skeleton" />
              <div className="loading-skeleton" />
            </div>
          ) : (
            <ul className="ext-list">
              {filtered.map((group) => (
                <li className="glass ext-group" key={group.name}>
                  <div className="ext-group-head">
                    <strong>{group.name}</strong>
                    {group.conflict ? (
                      <span className="ext-badge" data-tone="warn">
                        启动方式不同
                      </span>
                    ) : null}
                    <AgentChips agents={group.agents} />
                  </div>
                  <ul className="ext-copies">
                    {group.copies.map((item) => (
                      <li className="ext-copy" key={`${item.sourceId}-${item.name}`}>
                        <div className="ext-copy-main">
                          <span className="ext-badge">{TRANSPORT_LABEL[item.transport]}</span>
                          <code>{item.command ?? item.urlHost ?? '未声明启动方式'}</code>
                          {item.command && item.argCount ? (
                            <span className="field-hint">{item.argCount} 个参数</span>
                          ) : null}
                          {!item.enabled ? <span className="ext-badge">已禁用</span> : null}
                        </div>
                        <div className="ext-copy-meta">
                          <span className="ext-path" title={item.sourceDisplay}>
                            {item.sourceLabel}
                          </span>
                          {item.envKeys.length ? (
                            <span className="field-hint" title={item.envKeys.join('、')}>
                              env：{item.envKeys.slice(0, 3).join('、')}
                              {item.envKeys.length > 3 ? ` 等 ${item.envKeys.length} 个` : ''}
                            </span>
                          ) : null}
                          {item.headerKeys.length ? (
                            <span className="field-hint" title={item.headerKeys.join('、')}>
                              headers：{item.headerKeys.slice(0, 3).join('、')}
                              {item.headerKeys.length > 3 ? ` 等 ${item.headerKeys.length} 个` : ''}
                            </span>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {!loading && !filtered.length ? <p className="ext-empty">没有匹配的 MCP 服务。</p> : null}
        </div>
      ) : (
        <div
          className="ext-tab-panel"
          id="mcp-ext-panel-search"
          role="tabpanel"
          aria-labelledby="mcp-ext-tab-search"
        >
          <section className="glass ext-search">
            <p className="field-hint">
              数据来自官方 MCP Registry；留空搜索返回最新条目。复制命令或配置片段后自己安装。
            </p>
            <form
              className="ext-search-form"
              onSubmit={(event) => {
                event.preventDefault()
                void runSearch()
              }}
            >
              <input
                className="field-input"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="例如 playwright、filesystem，留空看最新"
                aria-label="搜索在线 MCP"
              />
              <button type="submit" className="btn-gold" disabled={searching}>
                {searching ? '搜索中…' : '搜索'}
              </button>
            </form>
            {searchError ? (
              <div className="status-banner" role="alert">
                <span>{searchError}</span>
              </div>
            ) : null}

            <ul className="ext-results">
              {(searchResult?.items ?? []).map((item) => (
                <li className="ext-result ext-result-wide" key={item.name}>
                  <div className="ext-result-main">
                    <strong>{item.title}</strong>
                    <span className="field-hint">
                      {item.name}
                      {item.version ? ` · v${item.version}` : ''} ·{' '}
                      {TRANSPORT_LABEL[item.transport]}
                    </span>
                  </div>
                  {item.description ? <p className="ext-desc">{item.description}</p> : null}
                  {item.commandLine ? (
                    <div className="ext-result-line">
                      <code className="ext-command">{item.commandLine}</code>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => copy(`${item.name}:cmd`, item.commandLine ?? '')}
                      >
                        {copied === `${item.name}:cmd` ? '已复制' : '复制命令'}
                      </button>
                    </div>
                  ) : null}
                  {item.configSnippet ? (
                    <div className="ext-result-line">
                      <pre className="ext-snippet">{item.configSnippet}</pre>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => copy(`${item.name}:cfg`, item.configSnippet)}
                      >
                        {copied === `${item.name}:cfg` ? '已复制' : '复制配置'}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {searchResult?.nextCursor ? (
              <button
                type="button"
                className="btn-ghost"
                disabled={searching}
                onClick={() => void runSearch(searchResult.nextCursor ?? undefined)}
              >
                加载更多
              </button>
            ) : null}
            {searchResult && !searchResult.items.length ? (
              <p className="ext-empty">没有找到匹配的 MCP 服务，换个关键词试试。</p>
            ) : null}
          </section>
        </div>
      )}
    </div>
  )
}
