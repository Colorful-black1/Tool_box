import { create } from 'zustand'
import { readToolOrder } from '../components/tools/tool-navigation'

/** 只保存工具顺序；搜索词和面板草稿均不写入配置。 */
interface ToolOrderState {
  order: string[]
  loaded: boolean
  loading: boolean
  saving: boolean
  error: string
  message: string
  load(): Promise<void>
  save(order: string[]): Promise<void>
}

export const useToolOrderStore = create<ToolOrderState>((set, get) => ({
  order: [],
  loaded: false,
  loading: false,
  saving: false,
  error: '',
  message: '',
  load: async () => {
    if (get().loaded || get().loading) return
    if (!window.toolbox) {
      set({ error: '桌面桥接尚未就绪，可搜索和使用工具，暂时无法保存排序。' })
      return
    }
    set({ loading: true, error: '' })
    try {
      const config = await window.toolbox.config.get()
      set({ order: readToolOrder(config?.toolOrder), loaded: true })
    } catch {
      set({ error: '工具顺序读取失败，已显示默认顺序；请重试读取后再排序。' })
    } finally {
      set({ loading: false })
    }
  },
  save: async (value) => {
    if (!get().loaded || get().saving) return
    if (!window.toolbox) {
      set({ error: '桌面桥接尚未就绪，工具顺序尚未保存。' })
      return
    }
    const previous = get().order
    const order = readToolOrder(value)
    if (order.join(',') === previous.join(',')) return
    set({ order, saving: true, error: '', message: '' })
    try {
      await window.toolbox.config.set({ toolOrder: order })
      set({ message: '工具顺序已保存' })
    } catch {
      set({ order: previous, error: '工具顺序保存失败，已恢复原顺序；可重新拖动后重试。' })
    } finally {
      set({ saving: false })
    }
  }
}))
