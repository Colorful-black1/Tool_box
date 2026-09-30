import type { JSX } from 'react'

import type { AppView } from '../stores/app-store'

interface RailItem {
  view: AppView
  label: string
  icon: string
}

interface SideRailProps {
  view: AppView
  onChange: (view: AppView) => void
  items?: RailItem[]
}

function RailIcon({ name }: { name: string }): JSX.Element {
  if (name === 'book') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'lock') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'note') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M12 20h9" strokeLinecap="round" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'settings') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.64.74.83.3.17.64.26.98.26H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  // chat 默认
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" strokeLinecap="round" />
    </svg>
  )
}

export function SideRail({ view, onChange, items }: SideRailProps): JSX.Element {
  const fallback: RailItem[] = [
    { view: 'chat', label: '对话', icon: 'chat' },
    { view: 'settings', label: '设置', icon: 'settings' }
  ]
  const railItems = items ?? fallback

  return (
    <nav className="side-rail" aria-label="主导航">
      <div className="logo-mark" aria-hidden="true">
        智
      </div>
      {railItems.map((item) => (
        <button
          key={item.view}
          type="button"
          className={`nav-item${view === item.view || (view === 'reading' && item.view === 'shelf') ? ' active' : ''}`}
          aria-current={view === item.view ? 'page' : undefined}
          onClick={() => onChange(item.view)}
        >
          <RailIcon name={item.icon} />
          {item.label}
        </button>
      ))}
      <div className="rail-spacer" />
      <div
        className="logo-mark"
        style={{ width: 44, height: 44, fontSize: 18, marginBottom: 0 }}
        aria-hidden="true"
      >
        T
      </div>
    </nav>
  )
}

interface TopBarProps {
  title: string
  subtitle: string
  children?: import('react').ReactNode
}

export function TopBar({ title, subtitle, children }: TopBarProps): JSX.Element {
  return (
    <header className="topbar">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-sub">{subtitle}</p>
      </div>
      <div className="top-actions">{children}</div>
    </header>
  )
}
