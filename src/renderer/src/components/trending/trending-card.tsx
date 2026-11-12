import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import { formatCompact } from '@shared/usage-format'
import type { TrendingPeriod, TrendingRepo } from '@shared/github-trending'

interface TrendingCardProps {
  item: TrendingRepo
  period: TrendingPeriod
  onOpen: (fullName: string) => void
}

type CopyState = 'idle' | 'ok' | 'error'

/** 排名、仓库、简介、语言和 Star 信息的一条榜单记录。 */
export function TrendingCard({ item, period, onOpen }: TrendingCardProps): JSX.Element {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gainLabel = period === 'daily' ? '今日' : period === 'weekly' ? '本周' : '本月'

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const split = item.fullName.split('/')
  const owner = split[0] ?? ''
  const name = split[1] ?? item.fullName

  const copy = async (): Promise<void> => {
    const bridge = window.toolbox?.system
    if (!bridge) return
    try {
      await bridge.copyText(item.url)
      setCopyState('ok')
    } catch {
      setCopyState('error')
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopyState('idle'), 1_600)
  }

  return (
    <li className={`glass trending-card${item.rank <= 3 ? ' top' : ''}`}>
      <span className="trending-rank" aria-label={`第 ${item.rank} 名`}>
        {String(item.rank).padStart(2, '0')}
      </span>

      <div className="trending-main">
        <div className="trending-title">
          <span className="trending-owner">{owner} /</span> <strong>{name}</strong>
        </div>
        <p className="trending-desc">{item.description || '暂无简介'}</p>
        <div className="trending-meta">
          <span className="trending-language">
            <i
              className="trending-language-dot"
              style={{ background: item.languageColor ?? 'var(--text-dim)' }}
              aria-hidden="true"
            />
            {item.language || '未标注'}
          </span>
          <span title="GitHub 总 Star">★ {formatCompact(item.stars)}</span>
          <span className={item.periodStars === null ? 'trending-gain muted' : 'trending-gain'}>
            {item.periodStars === null
              ? '新增 —'
              : `+${item.periodStars.toLocaleString('zh-CN')} ${gainLabel}`}
          </span>
          <span title="Fork 数">Fork {formatCompact(item.forks)}</span>
        </div>
      </div>

      <div className="trending-actions">
        <button
          type="button"
          className="btn-ghost trending-action"
          onClick={() => void copy()}
          aria-label={`复制 ${item.fullName} 的 GitHub 链接`}
        >
          {copyState === 'ok' ? '已复制' : copyState === 'error' ? '复制失败' : '复制'}
        </button>
        <button
          type="button"
          className="btn-ghost trending-action"
          onClick={() => onOpen(item.fullName)}
          aria-label={`在浏览器打开 ${item.fullName}`}
        >
          打开
        </button>
      </div>
    </li>
  )
}
