import { useEffect } from 'react'
import type { JSX } from 'react'
import { TodosPage } from './components/todos/todos-page'
import { useTodoStore } from './stores/todo-store'
import { AppDialog } from './components/app-dialog'

import { BookshelfPage } from './components/bookshelf/bookshelf-page'
import { ChatPanel } from './components/chat-panel'
import { ConversationSidebar } from './components/conversation-sidebar'
import { NotesPage } from './components/notes/notes-page'
import { PasswordBoxPage } from './components/password/password-box-page'
import { Reader } from './components/reader/reader'
import { CommandPalette } from './components/search/command-palette'
import { SideRail, TopBar } from './components/shell'
import type { RailNode } from './components/shell'
import { StatsPage } from './components/stats/stats-page'
import { Starfield } from './components/starfield'
import { ToolsPage } from './components/tools/tools-page'
import { OpenCodeWorkbench } from './components/opencode/opencode-workbench'
import { AgentUsagePage } from './components/agent-usage/agent-usage-page'
import { useCodingAgentStore } from './stores/coding-agent-store'
import { codingAgentClient } from './lib/coding-agent-client'
import { startAgentDraftSync, flushAgentDrafts } from './lib/agent-draft-sync'
import { SettingsPage } from './routes/settings-page'
import { applyAppAppearance } from './lib/app-appearance'
import { useAppearanceStore } from './stores/appearance-store'
import type { AppView } from './stores/app-store'
import { useAppStore } from './stores/app-store'
import { useConfigStore } from './stores/config-store'
import { useRailStore } from './stores/rail-store'
import { usePromptPolishStore } from './stores/prompt-polish-store'
import { usePasswordAiStore } from './stores/password-ai-store'

const PAGE_META: Record<AppView, { title: string; subtitle: string }> = {
  'agent-usage': { title: 'Token 统计', subtitle: 'USAGE · 本机 Agent 用量' },
  opencode: { title: '编程 Agent', subtitle: 'AGENTS · 原生会话与消息转用' },
  chat: { title: '星轨对话', subtitle: 'AI CHAT · 与群星同行' },
  shelf: { title: '星轨书架', subtitle: 'BOOKSHELF · 愿此行，终抵群星' },
  reading: { title: '沉浸阅读', subtitle: 'READING · 与群星同行' },
  stats: { title: '阅读统计', subtitle: 'STATS · 旅程的刻度' },
  passwords: { title: '密码宝匣', subtitle: 'PASSWORD VAULT · 秘语封存于此' },
  notes: { title: '星笺手记', subtitle: 'NOTES · 星语落笔成笺' },
  todos: { title: '待办清单', subtitle: 'TODO · 安排下一件事' },
  tools: { title: '开发者工具', subtitle: 'DEV TOOLS · 本机离线小工具' },
  settings: { title: '星轨链路', subtitle: 'SETTINGS · 连接你的模型星域' }
}

const RAIL_ITEMS: RailNode[] = [
  { view: 'chat', label: '对话', icon: 'chat' },
  {
    id: 'development',
    label: '开发工作台',
    children: [
      { view: 'opencode', label: '编程 Agent', icon: 'code' },
      { view: 'agent-usage', label: 'Token 统计', icon: 'stats' },
      { view: 'tools', label: '工具', icon: 'tool' }
    ]
  },
  {
    id: 'reading',
    label: '阅读空间',
    children: [
      { view: 'shelf', label: '书架', icon: 'book' },
      { view: 'stats', label: '统计', icon: 'stats' }
    ]
  },
  {
    id: 'personal',
    label: '个人管理',
    children: [
      { view: 'passwords', label: '密码箱', icon: 'lock' },
      { view: 'notes', label: '记事本', icon: 'note' },
      { view: 'todos', label: '待办清单', icon: 'todo' }
    ]
  },
  {
    id: 'system',
    label: '系统',
    children: [{ view: 'settings', label: '设置', icon: 'settings' }]
  }
]

export default function App(): JSX.Element {
  useEffect(() => window.toolbox?.todos?.onEvent((event) => {
    if (event.type === 'open') {
      useTodoStore.getState().open(event.id)
      useAppStore.getState().setView('todos')
    } else {
      void useTodoStore.getState().load()
    }
  }), [])
  const view = useAppStore((state) => state.view)
  const setView = useAppStore((state) => state.setView)
  const loading = useAppStore((state) => state.loading)
  const error = useAppStore((state) => state.error)
  const activeBookId = useAppStore((state) => state.activeBookId)
  const readerStartChapter = useAppStore((state) => state.readerStartChapter)
  const books = useAppStore((state) => state.books)
  const closeReader = useAppStore((state) => state.closeReader)
  const openReader = useAppStore((state) => state.openReader)
  const loadConfig = useConfigStore((state) => state.load)
  const railCollapsed = useRailStore((state) => state.collapsed || state.narrow)

  useEffect(() => {
    const bridge = window.toolbox?.tools
    if (!bridge?.onAiOutput) return
    return bridge.onAiOutput((event) => {
      usePromptPolishStore.getState().receive(event)
      usePasswordAiStore.getState().receive(event)
    })
  }, [])

  useEffect(() => {
    void loadConfig()
    void useAppStore.getState().bootstrap()
    void useAppStore.getState().loadAgentPermission()
  }, [loadConfig])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void =>
      applyAppAppearance(useAppearanceStore.getState().appearance, media.matches)
    const unsubscribe = useAppearanceStore.subscribe(apply)
    media.addEventListener('change', apply)
    apply()
    void useAppearanceStore.getState().load()
    return () => {
      unsubscribe()
      media.removeEventListener('change', apply)
    }
  }, [])

  // 窗口太窄时侧边栏自动收成只显示图标；变宽后恢复用户手动的那份偏好
  useEffect(() => {
    const onResize = (): void => useRailStore.getState().syncWidth(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const dispose = startAgentDraftSync()
    const unsubscribe = window.toolbox?.agentDrafts?.onFlush((requestId) => {
      void flushAgentDrafts()
        .then((saved) => window.toolbox.agentDrafts.flushed({ requestId, saved }))
        .catch(() => {
          // 主进程可能已超时或窗口正在关闭；刷新失败由退出对话框处理。
        })
    })
    return () => {
      unsubscribe?.()
      dispose()
    }
  }, [])

  useEffect(() => {
    if (!window.toolbox?.codingAgents && !window.toolbox?.opencode) return
    return codingAgentClient().onEvent((event) => useCodingAgentStore.getState().receive(event))
  }, [])

  useEffect(() => {
    const bridge = window.toolbox?.chat
    if (!bridge) return
    const disposers = [
      bridge.onDelta((event) => useAppStore.getState().appendDelta(event)),
      bridge.onCompleted((event) => useAppStore.getState().completeChat(event)),
      bridge.onError((event) => useAppStore.getState().failChat(event)),
      bridge.onStopped((event) => useAppStore.getState().stopChat(event)),
      bridge.onToolCall((event) => useAppStore.getState().appendToolCall(event)),
      bridge.onToolResult((event) => useAppStore.getState().completeToolResult(event)),
      bridge.onToolApprovalRequest((event) =>
        useAppStore.getState().requestToolApproval(event)
      )
    ]
    return () => disposers.forEach((dispose) => dispose())
  }, [])

  const meta = PAGE_META[view] ?? PAGE_META.chat
  const activeBook = books.find((item) => item.id === activeBookId)

  return (
    <>
      <Starfield />
      {/* 全局命令面板：⌘K / Ctrl+K 唤起，挂在壳层外，任何页面都能用 */}
      <CommandPalette />
      <AppDialog />
      <div className={`app-shell${railCollapsed ? ' rail-collapsed' : ' rail-expanded'}`}>
        <SideRail
          view={view}
          onChange={setView}
          items={RAIL_ITEMS}
        />
        <div className="main">
          <TopBar title={meta.title} subtitle={meta.subtitle} />

          <main className="viewport">
            {loading ? (
              <div aria-busy="true" aria-label="加载中">
                <div className="loading-skeleton" />
                <div className="loading-skeleton" />
                <div className="loading-skeleton" />
              </div>
            ) : view === 'reading' && activeBookId ? (
              <Reader
                bookId={activeBookId}
                initialChapterIdx={readerStartChapter ?? undefined}
                bookTitle={activeBook?.title ?? '阅读'}
                onBack={closeReader}
              />
            ) : (
              <>
                {error ? (
                  <div className="status-banner" role="alert">
                    <span>{error}</span>
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
                {view === 'shelf' ? <BookshelfPage /> : null}
                {view === 'stats' ? (
                  <StatsPage onOpenBook={(bookId) => openReader(bookId)} />
                ) : null}
                {view === 'passwords' ? <PasswordBoxPage /> : null}
                {view === 'notes' ? <NotesPage /> : null}
                {view === 'todos' ? <TodosPage /> : null}
                {view === 'tools' ? <ToolsPage /> : null}
                {view === 'opencode' ? <OpenCodeWorkbench /> : null}
                {view === 'agent-usage' ? <AgentUsagePage /> : null}
                {view === 'settings' ? <SettingsPage /> : null}
              </>
            )}
          </main>
        </div>
      </div>
    </>
  )
}
