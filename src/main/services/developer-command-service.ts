import { randomUUID } from 'node:crypto'
import { EMPTY_COMMAND_LIBRARY } from '../../shared/developer-commands'
import type {
  DeveloperCommandInput,
  DeveloperCommandSnapshot,
  DeveloperCommandToggle
} from '../../shared/developer-commands'
import { DEVELOPER_COMMAND_PRESETS } from '../../shared/developer-command-presets'
import { parseDeveloperCommandSnapshot } from '../../shared/developer-command-validation'
import type { ToolboxStore } from './chat-store/chat-store'

/** 同步读改写在主进程串行执行，独立 kv 与配置／密码无耦合。 */
export class DeveloperCommandService {
  constructor(
    private readonly store: Pick<ToolboxStore, 'commandLibraryGet' | 'commandLibrarySet'>
  ) {}

  read(): DeveloperCommandSnapshot {
    try {
      const raw = this.store.commandLibraryGet()
      if (raw === null) return structuredClone(EMPTY_COMMAND_LIBRARY)
      if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) throw new Error('文档过大')
      return parseDeveloperCommandSnapshot(JSON.parse(raw))
    } catch {
      // 不用空文档替代损坏内容，所有写入也必须先通过此读取。
      throw new Error('命令库读取失败或版本不兼容，原记录已保留，暂时无法保存')
    }
  }
  save(input: DeveloperCommandInput): DeveloperCommandSnapshot {
    return this.mutate(input.expectedRevision, (document) => {
      const previous = input.id
        ? document.entries.find((entry) => entry.id === input.id)
        : undefined
      if (input.id && !previous) throw new Error('命令不存在，请重新读取')
      if (previous && previous.archivedAtMs !== null) throw new Error('请先恢复已归档命令')
      if (!previous && document.entries.length >= 500) throw new Error('个人命令最多 500 条')
      const { expectedRevision: _revision, id: _id, ...fields } = input
      const entry = { ...fields, id: previous?.id ?? `user:${randomUUID()}`, archivedAtMs: null }
      document.entries = previous
        ? document.entries.map((item) => (item.id === entry.id ? entry : item))
        : [...document.entries, entry]
    })
  }
  setFavorite(input: DeveloperCommandToggle): DeveloperCommandSnapshot {
    return this.mutate(input.expectedRevision, (document) => {
      const entry = [...DEVELOPER_COMMAND_PRESETS, ...document.entries].find(
        (item) => item.id === input.id
      )
      if (!entry || entry.archivedAtMs !== null) throw new Error('命令不可用，请重新读取或先恢复')
      document.favoriteIds = document.favoriteIds.filter((id) => id !== input.id)
      if (input.value) document.favoriteIds.push(input.id)
    })
  }
  setArchived(input: DeveloperCommandToggle): DeveloperCommandSnapshot {
    return this.mutate(input.expectedRevision, (document) => {
      const entry = document.entries.find((item) => item.id === input.id)
      if (!entry) throw new Error('只能归档或恢复个人命令')
      entry.archivedAtMs = input.value ? (entry.archivedAtMs ?? Date.now()) : null
    })
  }
  private mutate(
    expected: number,
    apply: (document: DeveloperCommandSnapshot) => void
  ): DeveloperCommandSnapshot {
    const document = this.read()
    if (document.revision !== expected)
      throw new Error('命令库已变化，请刷新核对后再保存，当前输入已保留')
    if (document.revision >= Number.MAX_SAFE_INTEGER) throw new Error('命令库版本达到上限')
    apply(document)
    document.revision++
    const next = parseDeveloperCommandSnapshot(document)
    try {
      this.store.commandLibrarySet(JSON.stringify(next))
    } catch {
      throw new Error('命令保存失败，请重试，当前输入已保留')
    }
    return next
  }
}
