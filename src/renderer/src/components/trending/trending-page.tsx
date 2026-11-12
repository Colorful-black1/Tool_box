import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import {
  TRENDING_CACHE_TTL_MS,
  TRENDING_LANGUAGES,
  TRENDING_PERIODS
} from '@shared/github-trending'
import { Dropdown } from '../dropdown'
import { RefreshIcon, SearchIcon } from '../icons'
import { TRENDING_REFRESH_INTERVALS, saveTrendingPrefs } from '../../lib/trending-prefs'
import { useTrendingStore } from '../../stores/trending-store'
import { TrendingCard } from './trending-card'

/** GitHub 开源热榜：本地页面，不内嵌 GitHub，不依赖登录。 */
export function TrendingPage(): JSX.Element {
  const period = useTrendingStore((state) => state.period)
  const language = useTrendingStore((state) => state.language)
  const refreshInterval = useTrendingStore((state) => state.refreshInterval)
  const result = useTrendingStore((state) => state.result)
  const loading = useTrendingStore((state) => state.loading)
  const refreshing = useTrendingStore((state) => state.refreshing)
  const error = useTrendingStore((state) => state.error)
  const load = useTrendingStore((state) => state.load)
  const refresh = useTrendingStore((state) => state.refresh)
  const setPeriod = useTrendingStore((state) => state.setPeriod)
  const setLanguage = useTrendingStore((state) => state.setLanguage)
  const setRefreshInterval = useTrendingStore((state) => state.setRefreshInterval)
  const openRepo = useTrendingStore((state) => state.openRepo)

  const [query, setQuery] = useState('')

  useEffect(() => {
    void load(false)
  }, [period, language, load])

  useEffect(() => {
    saveTrendingPrefs({ period, language, refreshInterval })
  }, [period, language, refreshInterval])

  // 只在页面可见时轮询；切到别的页面 / 最小化后不积压请求。
  useEffect(() => {
    if (refreshInterval === '0') return
    const tick = (): void => {
      if (document.hidden) return
      const state = useTrendingStore.getState()
      if (state.loading || state.refreshing) return
      void state.refresh()
    }
    const timer = setInterval(tick, Number(refreshInterval) * 60_000)
    const onVisible = (): void => {
      if (document.hidden) return
      const state = useTrendingStore.getState()
      if (state.loading || state.refreshing) return
      const fetchedAt = state.result?.fetchedAtMs ?? 0
      if (!fetchedAt || Date.now() - fetchedAt > TRENDING_CACHE_TTL_MS) void state.load(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshInterval])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (
        event.key !== 'F5' ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
        return
      event.preventDefault()
      if (!event.repeat) void refresh()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [refresh])

  const items = useMemo(() => {
    const list = result?.items ?? []
    const keyword = query.trim().toLowerCase()
    if (!keyword) return list
    return list.filter((item) =>
      [item.fullName, item.description, item.language].some((value) =>
        value.toLowerCase().includes(keyword)
      )
    )
  }, [result, query])

  const sourceLabel = result?.source === 'search' ? 'GitHub 搜索兜底 · 近期新建' : 'GitHub Trending'
  const periodLabel = TRENDING_PERIODS.find((item) => item.value === period)?.label ?? '今日'

  return (
    <section className="trending-page view-enter" aria-label="GitHub 开源热榜">
      <header className="trending-heading">
        <div>
          <h2>最近走红的开源项目</h2>
          <p className="field-hint">
            Trending 没有官方 API；页面失败时会自动回退 GitHub 搜索，并标注数据来源
          </p>
        </div>
        <div className="trending-status">
          {result ? (
            <span className={`trending-source${result.source === 'search' ? ' search' : ''}`}>
              {sourceLabel}
            </span>
          ) : null}
          <span className="field-hint">
            {result ? `更新于 ${formatUpdated(result.fetchedAtMs)}` : '等待加载'}
          </span>
        </div>
      </header>

      <div className="glass trending-toolbar">
        <div className="segmented" role="tablist" aria-label="榜单周期">
          {TRENDING_PERIODS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              className={`segment${item.value === period ? ' active' : ''}`}
              aria-selected={item.value === period}
              onClick={() => setPeriod(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <Dropdown
          ariaLabel="筛选编程语言"
          value={language}
          align="left"
          options={TRENDING_LANGUAGES.map((item) => ({
            value: item.value,
            label: item.label
          }))}
          onChange={(value) => {
            const next = TRENDING_LANGUAGES.find((item) => item.value === value)?.value
            if (next !== undefined) setLanguage(next)
          }}
        />

        <label className="trending-search">
          <SearchIcon />
          <input
            className="field-input"
            type="search"
            maxLength={100}
            placeholder="筛选当前榜单"
            aria-label="筛选当前榜单"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="trending-toolbar-right">
          <span className="field-hint">自动刷新</span>
          <Dropdown
            ariaLabel="自动刷新间隔"
            value={refreshInterval}
            options={TRENDING_REFRESH_INTERVALS.map((item) => ({ ...item }))}
            onChange={(value) => {
              const next = TRENDING_REFRESH_INTERVALS.find((item) => item.value === value)?.value
              if (next) setRefreshInterval(next)
            }}
          />
          <button
            type="button"
            className="btn-gold trending-refresh"
            disabled={refreshing}
            aria-keyshortcuts="F5"
            title="刷新榜单（F5）"
            onClick={() => void refresh()}
          >
            <RefreshIcon />
            {refreshing ? '刷新中' : '刷新'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="status-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-ghost" onClick={() => void load(false)}>
            重试
          </button>
        </div>
      ) : null}

      {result?.warning ? (
        <div className="status-banner trending-warning" role="status">
          {result.warning}
        </div>
      ) : result?.stale ? (
        <p className="trending-updating" role="status">
          正在更新榜单…
        </p>
      ) : null}

      <div className="trending-summary">
        <span>
          {periodLabel} · {items.length} 个项目
          {query.trim() ? '（已筛选）' : ''}
        </span>
        <span>排名保持 GitHub 原顺序</span>
      </div>

      {!result && error ? null : !result && loading ? (
        <div className="trending-list" aria-busy="true" aria-label="正在加载榜单">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="glass trending-skeleton" key={index} />
          ))}
        </div>
      ) : items.length ? (
        <ol className="trending-list">
          {items.map((item) => (
            <TrendingCard
              key={`${item.fullName}-${item.rank}`}
              item={item}
              period={period}
              onOpen={(fullName) => void openRepo(fullName)}
            />
          ))}
        </ol>
      ) : (
        <div className="glass trending-empty" role="status">
          {query.trim()
            ? '没有匹配的项目，清空搜索试试。'
            : 'GitHub 暂时没有返回可展示的项目，请稍后刷新。'}
        </div>
      )}
    </section>
  )
}

/** 当天只显示时间；跨天补日期，避免把旧缓存误认为今天。 */
function formatUpdated(ms: number): string {
  const date = new Date(ms)
  const now = new Date()
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return time
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${time}`
}
