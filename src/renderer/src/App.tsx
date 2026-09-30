import { useEffect } from 'react'
import type { JSX } from 'react'

import { ChatPanel } from './components/chat-panel'
import { ConversationSidebar } from './components/conversation-sidebar'
import { NotesPage } from './components/notes'
import { PasswordBoxPage } from './components/password-box'
import { ReaderPage, ReadingView } from './components/reader'
import { SettingsPage } from './routes/settings-page'
import { SideRail } from './components/shell'
import { Starfield } from './components/starfield'
import type { AppView } from './stores/app-store'
import { useAppStore } from './stores/app-store'

const PAGE_META: Record<AppView, { title: string; subtitle: string }> = {
  chat: { title: '星轨对话', subtitle: 'AI CHAT · 与群星同行' },
  shelf: { title: '星轨书架', subtitle: 'BOOKSHELF · 愿此行，终抵群星' },
  reading: { title: '沉浸阅读', subtitle: 'READING · 与群星同行' },
  passwords: { title: '密码宝匣', subtitle: 'PASSWORD VAULT · 秘语封存于此' },
  notes: { title: '星笺手记', subtitle: 'NOTES · 星语落笔成笺' },
  settings: { title: '星轨链路', subtitle: 'SETTINGS · 连接你的模型星域' }
}

const RAIL_ITEMS: Array<{ view: AppView; label: string; icon: string }> = [
  { view: 'chat', label: '对话', icon: 'chat' },
  { view: 'shelf', label: '书架', icon: 'book' },
  { view: 'passwords', label: '密码箱', icon: 'lock' },
  { view: 'notes', label: '记事本', icon: 'note' },
  { view: 'settings', label: '设置', icon: 'settings' }
]

export default function App(): JSX.Element {
  const view = useAppStore((state) => state.view)
  const setView = useAppStore((state) => state.setView)
  const loading = useAppStore((state) => state.loading)
  const error = useAppStore((state) => state.error)

  useEffect(() => {
    void useAppStore.getState().bootstrap()
  }, [])

  useEffect(() => {
    const bridge = window.toolbox?.chat
    if (!bridge) return
    const disposers = [
      bridge.onDelta((event) => useAppStore.getState().appendDelta(event)),
      bridge.onCompleted((event) => useAppStore.getState().completeChat(event)),
      bridge.onError((event) => useAppStore.getState().failChat(event)),
      bridge.onStopped((event) => useAppStore.getState().stopChat(event))
    ]
    return () => disposers.forEach((dispose) => dispose())
  }, [])

  const meta = PAGE_META[view] ?? PAGE_META.chat

  return (
    <>
      <Starfield />
      <div className="app-shell">
        <SideRail view={view} onChange={(next) => setView(next as AppView)} items={RAIL_ITEMS} />
        <div className="main">
          <header className="topbar">
            <div>
              <h1 className="page-title">{meta.title}</h1>
              <p className="page-sub">{meta.subtitle}</p>
            </div>
          </header>

          <main className="viewport" data-view={view}>
            {loading ? (
              <div aria-busy="true" aria-label="加载中">
                <div className="loading-skeleton" />
                <div className="loading-skeleton" />
                <div className="loading-skeleton" />
              </div>
            ) : (
              <>
                {error ? (
                  <div className="status-banner" role="alert">
                    {error}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => useAppStore.getState().clearError()}
                    >
                      关闭
                    </button>
                  </div>
                ) : null}
                {view === 'chat' ? (
                  <div className="chat-layout view-enter">
                    <ConversationSidebar />
                    <ChatPanel />
                  </div>
                ) : null}
                {view === 'shelf' ? <ReaderPage /> : null}
                {view === 'reading' ? <ReadingView /> : null}
                {view === 'passwords' ? <PasswordBoxPage /> : null}
                {view === 'notes' ? <NotesPage /> : null}
                {view === 'settings' ? <SettingsPage /> : null}
              </>
            )}
          </main>
        </div>
      </div>
    </>
  )
}
