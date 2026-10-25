import { create } from 'zustand'
import { MAX_TOOL_FAVORITES, MAX_TOOL_RECENT, readToolIds } from '../../../shared/tool-shortcuts'

/** 收藏失败回退，最近使用失败保留内存；加载失败不能覆盖未知的旧配置。 */
interface ToolShortcutState {
  favorites: string[]
  recent: string[]
  loaded: boolean
  loading: boolean
  saving: boolean
  error: string
  load(): Promise<void>
  toggleFavorite(id: string, known: string[]): Promise<void>
  recordOpened(id: string): Promise<void>
}

export const useToolShortcutStore = create<ToolShortcutState>((set, get) => {
  let loading: Promise<void> | null = null
  let queue = Promise.resolve()
  let recentDirty = false
  const enqueue = (action: () => Promise<void>): Promise<void> => {
    const next = queue.then(action)
    // 各动作自行显示错误；队列意外失败也不能阻断之后的操作。
    queue = next.catch(() => {
      set({ error: '工具快捷入口保存失败，请重试。' })
    })
    return queue
  }
  return {
    favorites: [],
    recent: [],
    loaded: false,
    loading: false,
    saving: false,
    error: '',
    load: async () => {
      if (get().loaded) return
      if (loading) return loading
      if (!window.toolbox?.config) {
        set({ error: '桌面桥接尚未就绪，工具仍可使用；快捷入口暂时无法保存。' })
        return
      }
      set({ loading: true, error: '' })
      loading = (async () => {
        try {
          const config = await window.toolbox.config.get()
          recentDirty = false
          set({
            favorites: readToolIds(config?.toolFavorites, MAX_TOOL_FAVORITES),
            recent: readToolIds(config?.toolRecent, MAX_TOOL_RECENT),
            loaded: true
          })
        } catch {
          set({ error: '快捷入口读取失败，请重试读取；本次使用不会覆盖旧记录。' })
        } finally {
          set({ loading: false })
        }
      })()
      try {
        await loading
      } finally {
        loading = null
      }
    },
    toggleFavorite: (id, known) =>
      enqueue(async () => {
        await get().load()
        if (!get().loaded || !known.includes(id) || !window.toolbox?.config) return
        const valid = new Set(known)
        const previous = get().favorites
        const favorites = previous.filter((value) => valid.has(value))
        const next = favorites.includes(id)
          ? favorites.filter((value) => value !== id)
          : [...favorites, id]
        if (next.length > MAX_TOOL_FAVORITES) {
          set({ error: '最多收藏 30 个工具，请先取消部分收藏。' })
          return
        }
        set({ favorites: next, saving: true, error: '' })
        try {
          await window.toolbox.config.set({ toolFavorites: next })
        } catch {
          set({ favorites: previous, error: '收藏保存失败，已恢复；请再次点击收藏重试。' })
        } finally {
          set({ saving: false })
        }
      }),
    recordOpened: (id) =>
      enqueue(async () => {
        await get().load()
        if (!get().loaded || readToolIds([id], 1).length !== 1 || !window.toolbox?.config) return
        const recent = [id, ...get().recent.filter((value) => value !== id)].slice(
          0,
          MAX_TOOL_RECENT
        )
        if (!recentDirty && recent.join(',') === get().recent.join(',')) return
        set({ recent, saving: true })
        try {
          await window.toolbox.config.set({ toolRecent: recent })
          recentDirty = false
        if (get().error.startsWith('最近使用保存失败')) set({ error: '' })
        } catch {
          recentDirty = true
          set({ error: '最近使用保存失败，本次仍可使用工具；下次打开工具时会重试。' })
        } finally {
          set({ saving: false })
        }
      })
  }
})
