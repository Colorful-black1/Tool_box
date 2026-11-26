import { create } from 'zustand'
import {
  defaultPromptTemplates,
  savePromptRevision,
  validatePromptLibrary
} from '../../../shared/prompt-tools'
import type { PromptTemplate } from '../../../shared/prompt-tools'

/** 仅保存模板定义及历史版本；变量填充值由面板在内存中管理。 */
interface PromptState {
  templates: PromptTemplate[]
  loaded: boolean
  loading: boolean
  saving: boolean
  error: string
  load(force?: boolean): Promise<void>
  save(draft: Pick<PromptTemplate, 'id' | 'title' | 'body'>): Promise<PromptTemplate | null>
}

export const usePromptStore = create<PromptState>((set, get) => ({
  templates: defaultPromptTemplates(),
  loaded: false,
  loading: false,
  saving: false,
  error: '',
  load: async (force = false) => {
    if (get().loading || (get().loaded && !force)) return
    if (!window.toolbox) {
      set({ error: '桌面桥接尚未就绪，可使用内置模板，暂时无法保存。' })
      return
    }
    set({ loading: true, error: '' })
    try {
      const config = await window.toolbox.config.get()
      const templates =
        config?.promptTemplates === undefined
          ? defaultPromptTemplates()
          : validatePromptLibrary(config.promptTemplates)
      set({ templates, loaded: true })
    } catch {
      set({ error: '模板库读取失败，可使用内置模板；请重试读取后再保存。' })
    } finally {
      set({ loading: false })
    }
  },
  save: async (draft) => {
    if (!get().loaded || get().saving) return null
    if (get().loading) {
      set({ error: '模板库正在刷新，请稍后重试。' })
      return null
    }
    const bridge = window.toolbox
    if (!bridge) {
      set({ error: '桌面桥接尚未就绪，模板尚未保存。' })
      return null
    }
    set({ saving: true, error: '' })
    try {
      // 保存前取最新配置：AI 工具可能刚写入模板，不能用页面缓存覆盖。
      let raw: unknown
      try {
        raw = (await bridge.config.get())?.promptTemplates
      } catch {
        set({ error: '模板库读取失败，未保存；请重试。' })
        return null
      }
      let latest: PromptTemplate[]
      try {
        latest = raw === undefined ? defaultPromptTemplates() : validatePromptLibrary(raw)
      } catch {
        set({ error: '模板库数据无效，未保存；请到工具页检查或恢复备份。' })
        return null
      }
      const previous = latest.find((item) => item.id === draft.id)
      const template = savePromptRevision(previous, draft, Date.now())
      const templates = validatePromptLibrary(
        previous
          ? latest.map((item) => (item.id === draft.id ? template : item))
          : [...latest, template]
      )
      try {
        await bridge.config.set({ promptTemplates: templates })
      } catch {
        set({ error: '模板保存失败，已保留上次版本与当前草稿，请重试。' })
        return null
      }
      set({ templates })
      return template
    } catch (error) {
      // 此处仅处理本机纯函数的校验错误；主进程异常在上面的边界内收敛。
      set({ error: error instanceof Error ? error.message : '模板校验失败' })
      return null
    } finally {
      set({ saving: false })
    }
  }
}))
