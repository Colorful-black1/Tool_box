import { create } from 'zustand'
import { EMPTY_COMMAND_LIBRARY } from '../../../shared/developer-commands'
import type {
  CommandFilters,
  DeveloperCommandInput,
  DeveloperCommandSnapshot
} from '@shared/developer-commands'

/** 只保存筛选和已确认的快照；未保存编辑由模态表单持有。 */
interface DeveloperCommandState {
  snapshot: DeveloperCommandSnapshot
  filters: CommandFilters
  ready: boolean
  loading: boolean
  saving: boolean
  error: string
  filter(patch: Partial<CommandFilters>): void
  load(): Promise<void>
  save(input: DeveloperCommandInput): Promise<boolean>
  favorite(id: string, value: boolean): Promise<boolean>
  archive(id: string, value: boolean): Promise<boolean>
}
const errorText = (error: unknown): string =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
    : '命令库操作失败，请重试'

export const useDeveloperCommandStore = create<DeveloperCommandState>((set, get) => {
  const write = async (action: () => Promise<DeveloperCommandSnapshot>): Promise<boolean> => {
    if (get().saving || get().loading || !get().ready) return false
    set({ saving: true, error: '' })
    try {
      set({ snapshot: await action() })
      return true
    } catch (error) {
      set({ error: errorText(error) })
      return false
    } finally {
      set({ saving: false })
    }
  }
  return {
    snapshot: structuredClone(EMPTY_COMMAND_LIBRARY),
    filters: { query: '', category: '', shell: '', view: 'all' },
    ready: false,
    loading: false,
    saving: false,
    error: '',
    filter: (patch) => set({ filters: { ...get().filters, ...patch } }),
    load: async () => {
      if (get().loading || get().saving) return
      if (!window.toolbox?.developerCommands) {
        set({ ready: false, error: '桌面桥接尚未就绪，可查看内置命令，暂时无法保存。' })
        return
      }
      set({ loading: true, error: '' })
      try {
        set({ snapshot: await window.toolbox.developerCommands.read(), ready: true })
      } catch (error) {
        set({ ready: false, error: errorText(error) })
      } finally {
        set({ loading: false })
      }
    },
    save: (input) => write(() => window.toolbox.developerCommands.save(input)),
    favorite: (id, value) =>
      write(() =>
        window.toolbox.developerCommands.setFavorite({
          id,
          value,
          expectedRevision: get().snapshot.revision
        })
      ),
    archive: (id, value) =>
      write(() =>
        window.toolbox.developerCommands.setArchived({
          id,
          value,
          expectedRevision: get().snapshot.revision
        })
      )
  }
})
