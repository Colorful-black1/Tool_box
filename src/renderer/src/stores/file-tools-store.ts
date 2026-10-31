import { create } from 'zustand'
import type { FileDirectoryReference, FileScanSnapshot } from '../../../shared/file-tools'

/** 扫描切页继续，进度由 App 唯一订阅，启动锁在等待首个进度前就生效。 */
export const useFileToolsStore = create<{
  directory: FileDirectoryReference | null
  snapshot: FileScanSnapshot | null
  busy: boolean
  error: string
  receive(snapshot: FileScanSnapshot): void
  choose(): Promise<void>
  scan(): Promise<void>
  cancel(): Promise<void>
}>((set, get) => ({
  directory: null,
  snapshot: null,
  busy: false,
  error: '',
  receive: (snapshot) =>
    set((state) => {
      if (!state.busy && snapshot.phase !== 'enumerating') return {}
      if (
        state.snapshot &&
        state.snapshot.scanId !== snapshot.scanId &&
        snapshot.phase !== 'enumerating'
      )
        return {}
      return { snapshot }
    }),
  choose: async () => {
    if (get().busy) return
    set({ error: '' })
    try {
      const directory = await window.toolbox.files.chooseDirectory()
      if (directory) set({ directory, snapshot: null })
    } catch {
      set({ error: '无法选择目录，请重试' })
    }
  },
  scan: async () => {
    if (get().busy || !get().directory) return
    const token = get().directory!.token
    set({ busy: true, error: '', snapshot: null })
    try {
      set({ snapshot: await window.toolbox.files.findDuplicates(token) })
    } catch {
      set({ error: '扫描失败或目录引用已失效，请重新选择目录' })
    } finally {
      set({ busy: false })
    }
  },
  cancel: async () => {
    try {
      await window.toolbox.files.cancelScan()
    } catch {
      set({ error: '取消未完成，请稍后重试' })
    }
  }
}))
