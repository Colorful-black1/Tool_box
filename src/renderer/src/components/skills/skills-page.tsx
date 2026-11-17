import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import { EXTENSION_AGENTS, EXTENSION_AGENT_IDS, SKILL_SEARCH_MIN_CHARS } from '@shared/extensions'
import type {
  ExtensionAgentId,
  SkillEntryView,
  SkillScanResult,
  SkillSearchResult
} from '@shared/extensions'

import { ipcErrorText } from '../../lib/extension-errors'
import { Dropdown } from '../dropdown'
import { RefreshIcon } from '../icons'
import { AgentChips } from '../extensions/agent-chips'
import { ExtensionTabs } from '../extensions/extension-tabs'
import type { ExtensionTab, ExtensionTabItem } from '../extensions/extension-tabs'
import { useCopy } from '../extensions/use-copy'

interface SkillGroup {
  name: string
  description: string
  copies: SkillEntryView[]
  agents: ExtensionAgentId[]
  bundled: boolean
  conflict: boolean
  /** 冲突组内所有副本内容一致。 */
  identical: boolean
}

function groupSkills(skills: SkillEntryView[]): SkillGroup[] {
  const groups = new Map<string, SkillGroup>()
  for (const skill of skills) {
    const group = groups.get(skill.name) ?? {
      name: skill.name,
      description: skill.description,
      copies: [],
      agents: [],
      bundled: false,
      conflict: false,
      identical: true
    }
    group.copies.push(skill)
    group.bundled = group.bundled || skill.bundled
    group.conflict = group.conflict || skill.conflict
    for (const agent of skill.agents) if (!group.agents.includes(agent)) group.agents.push(agent)
    groups.set(skill.name, group)
  }
  for (const group of groups.values()) {
    const hashes = new Set(group.copies.map((item) => item.contentHash ?? item.path))
    group.identical = hashes.size === 1
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function timeLabel(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
}

const SKILL_TABS: ExtensionTabItem[] = [
  { value: 'local', label: '本机技能' },
  { value: 'search', label: '在线搜索' }
]

/** 本机技能只读看板 + skills.sh 在线搜索；安装命令由用户自己执行。 */
export function SkillsPage(): JSX.Element {
  const [result, setResult] = useState<SkillScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<ExtensionTab>('local')
  const [keyword, setKeyword] = useState('')
  const [agent, setAgent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<SkillSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchHint, setSearchHint] = useState('')
  const { copied, copy } = useCopy()

  const load = useCallback(async (refresh: boolean): Promise<void> => {
    const bridge = window.toolbox?.skillHub
    if (!bridge) {
      setError('当前版本未提供技能列表，请更新并重启应用')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      setResult(await bridge.list({ refresh }))
    } catch (reason) {
      setError(ipcErrorText(reason, '读取本机技能失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  const groups = useMemo(() => groupSkills(result?.skills ?? []), [result])
  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    return groups.filter((group) => {
      if (agent && !group.agents.includes(agent as ExtensionAgentId)) return false
      if (!needle) return true
      return (
        group.name.toLowerCase().includes(needle) ||
        group.description.toLowerCase().includes(needle) ||
        group.copies.some((item) => item.displayPath.toLowerCase().includes(needle))
      )
    })
  }, [groups, keyword, agent])

  const metrics = [
    { label: '技能名', value: String(groups.length) },
    { label: '物理副本', value: String(result?.skills.length ?? 0) },
    { label: '同名冲突', value: String(groups.filter((group) => group.conflict).length) },
    {
      label: '覆盖 Agent',
      value: String(
        new Set(
          (result?.skills ?? [])
            .flatMap((skill) => skill.agents)
            .filter((item) => item !== 'universal')
        ).size
      )
    }
  ]

  const agentOptions = [
    { value: '', label: '全部 Agent' },
    ...EXTENSION_AGENT_IDS.map((id) => ({ value: id, label: EXTENSION_AGENTS[id] }))
  ]

  const runSearch = async (offset: number): Promise<void> => {
    const bridge = window.toolbox?.skillHub
    if (!bridge) {
      setSearchError('当前版本未提供在线搜索，请更新并重启应用')
      return
    }
    const query = searchQuery.trim()
    if (query.length < SKILL_SEARCH_MIN_CHARS) {
      setSearchHint(`至少输入 ${SKILL_SEARCH_MIN_CHARS} 个字符`)
      return
    }
    setSearching(true)
    setSearchHint('')
    setSearchError('')
    try {
      const next = await bridge.search({ query, limit: 20, offset })
      setSearchResult((previous) =>
        offset > 0 && previous && previous.query === next.query
          ? { ...next, items: [...previous.items, ...next.items] }
          : next
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
          id="skills-ext"
          label="技能视图"
          value={tab}
          tabs={SKILL_TABS}
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
              aria-label="重新扫描本机技能"
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
          id="skills-ext-panel-local"
          role="tabpanel"
          aria-labelledby="skills-ext-tab-local"
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
              placeholder="筛选名称、描述或路径"
              aria-label="筛选本机技能"
            />
            <Dropdown
              value={agent}
              options={agentOptions}
              onChange={setAgent}
              ariaLabel="按 Agent 筛选技能"
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
                    {group.bundled ? <span className="ext-badge">随 Codex 自带</span> : null}
                    {group.conflict ? (
                      <span className="ext-badge" data-tone="warn">
                        同名 {group.copies.length} 份 · {group.identical ? '内容相同' : '内容不同'}
                      </span>
                    ) : null}
                    <AgentChips agents={group.agents} />
                  </div>
                  <p className="ext-desc" title={group.description}>
                    {group.description}
                  </p>
                  <ul className="ext-copies">
                    {group.copies.map((item) => (
                      <li className="ext-copy" key={item.path}>
                        <div className="ext-copy-main">
                          <code>{item.root}</code>
                          <span className="ext-path" title={item.path}>
                            {item.displayPath}
                          </span>
                        </div>
                        <AgentChips agents={item.agents} />
                        {item.contentHash ? (
                          <span className="ext-hash">{item.contentHash}</span>
                        ) : null}
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => copy(item.path, item.path)}
                        >
                          {copied === item.path ? '已复制' : '复制路径'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {!loading && !filtered.length ? <p className="ext-empty">没有匹配的技能。</p> : null}
        </div>
      ) : (
        <div
          className="ext-tab-panel"
          id="skills-ext-panel-search"
          role="tabpanel"
          aria-labelledby="skills-ext-tab-search"
        >
          <section className="glass ext-search">
            <p className="field-hint">
              数据来自 skills.sh；找到后复制命令，在终端里自己执行。本页不安装、不写任何目录。
            </p>
            <form
              className="ext-search-form"
              onSubmit={(event) => {
                event.preventDefault()
                void runSearch(0)
              }}
            >
              <input
                className="field-input"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="至少 2 个字符，例如 pdf、blender"
                aria-label="搜索在线技能"
              />
              <button type="submit" className="btn-gold" disabled={searching}>
                {searching ? '搜索中…' : '搜索'}
              </button>
            </form>
            {searchHint ? <p className="ext-hint">{searchHint}</p> : null}
            {searchError ? (
              <div className="status-banner" role="alert">
                <span>{searchError}</span>
              </div>
            ) : null}

            <ul className="ext-results">
              {(searchResult?.items ?? []).map((item) => (
                <li className="ext-result" key={item.id}>
                  <div className="ext-result-main">
                    <strong>{item.name}</strong>
                    <span className="field-hint">
                      {item.source} · {item.installs.toLocaleString('zh-CN')} 次安装
                    </span>
                  </div>
                  <code className="ext-command">{item.installCommand}</code>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => copy(item.id, item.installCommand)}
                  >
                    {copied === item.id ? '已复制' : '复制命令'}
                  </button>
                </li>
              ))}
            </ul>
            {searchResult?.hasMore ? (
              <button
                type="button"
                className="btn-ghost"
                disabled={searching}
                onClick={() => void runSearch(searchResult.items.length)}
              >
                加载更多
              </button>
            ) : null}
            {searchResult && !searchResult.items.length ? (
              <p className="ext-empty">没有找到匹配的技能，换个关键词试试。</p>
            ) : null}
          </section>
        </div>
      )}
    </div>
  )
}
