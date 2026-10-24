import { USAGE_CLIENTS } from '../../../shared/agent-usage'
import type {
  UsageClient,
  UsageQuery,
  UsageReport,
  UsageSourceView
} from '../../../shared/agent-usage'
import type { UsageRecord } from './normalize'
import { USAGE_CACHE_VERSION } from './cache'
import type { UsageCache } from './cache'
import { UsageScanner } from './scanner'
import { sourcePaths } from './sources'
import { usageReport } from './report'

/** 缓存读写注入；测试与首次运行可以完全不落盘。 */
export interface UsageCacheStore {
  load(): Promise<UsageCache | null>
  save(cache: UsageCache): Promise<void>
}

const noCache: UsageCacheStore = {
  load: async () => null,
  save: async () => undefined
}

/** 超过这个时间就重新扫描；页面隐藏时不会触发。 */
const SCAN_TTL = 60_000

/** 用量全局串行刷新，多个窗口 / 连续点击共用一次扫描，无后台常驻计时器。 */
export class AgentUsageService {
  private scanner = new UsageScanner()
  private records = new Map<UsageClient, UsageRecord[]>()
  private sources = new Map<UsageClient, UsageSourceView>()
  private scannedAt = 0
  private pending: Promise<void> | null = null
  private configuring: Promise<void> = Promise.resolve()
  private ready: Promise<void>

  constructor(
    private roots: Partial<Record<UsageClient, string>> = {},
    private saveRoots: (roots: Partial<Record<UsageClient, string>>) => Promise<void> = async () =>
      undefined,
    private cache: UsageCacheStore = noCache
  ) {
    this.ready = this.hydrate()
  }

  /** 先展示上次结果，再按需扫描；缓存损坏时静默回退到全量扫描。 */
  private async hydrate(): Promise<void> {
    try {
      const cached = await this.cache.load()
      if (!cached) return
      this.scanner.seed(cached.files)
      this.scannedAt = cached.scannedAt
      for (const source of cached.sources) this.sources.set(source.client, source)
      for (const file of cached.files) {
        const list = this.records.get(file.client) ?? []
        for (const record of file.records) list.push(record)
        this.records.set(file.client, list)
      }
      console.info('[AgentUsage] 已加载本地统计缓存', {
        sources: cached.sources.length,
        records: this.recordCount()
      })
    } catch (error) {
      // 缓存只是加速手段，读取异常不能阻塞统计。
      console.warn('[AgentUsage] 统计缓存不可用，改为重新扫描', {
        error: error instanceof Error ? error.name : 'unknown'
      })
    }
  }

  async chooseSource(client: UsageClient, path: string | null): Promise<void> {
    const update = this.configuring.then(async () => {
      await this.ready
      if (this.pending) await this.pending
      const roots = { ...this.roots }
      if (path) roots[client] = path
      else delete roots[client]
      await this.saveRoots(roots)
      this.roots = roots
      this.records.delete(client)
      this.sources.delete(client)
      this.scannedAt = 0
    })
    // 失败需传回调用者，队列自身保持可继续处理下一次来源选择。
    this.configuring = update.catch(() => undefined)
    return update
  }

  async query(query: UsageQuery): Promise<UsageReport> {
    await this.ready
    await this.configuring
    const stale = !this.scannedAt || query.refresh || Date.now() - this.scannedAt > SCAN_TTL
    if (this.pending) {
      // 手动刷新或还没有任何数据时等待扫描；普通筛选变化直接用已有缓存。
      if (query.refresh || !this.hasData()) await this.pending
    } else if (stale) {
      const run = this.scan(query.refresh && query.client ? query.client : undefined)
      this.pending = run
      const clear = (): void => {
        if (this.pending === run) this.pending = null
      }
      if (query.refresh || !this.hasData()) await run.finally(clear)
      else void run.finally(clear).catch(() => undefined)
    }
    return usageReport(this.allRecords(), [...this.sources.values()], this.scannedAt, query)
  }

  private hasData(): boolean {
    return this.scannedAt > 0 || this.records.size > 0
  }

  private allRecords(): UsageRecord[] {
    return [...this.records.values()].flat()
  }

  private recordCount(): number {
    let count = 0
    for (const list of this.records.values()) count += list.length
    return count
  }

  private async scan(only?: UsageClient): Promise<void> {
    const clients = only ? [only] : (Object.keys(USAGE_CLIENTS) as UsageClient[])
    try {
      for (const client of clients) {
        const custom = this.roots[client]
        try {
          const result = await this.scanner.scan(
            client,
            custom ? [custom] : sourcePaths(client),
            Boolean(custom)
          )
          this.records.set(client, result.records)
          this.sources.set(client, result.source)
        } catch (error) {
          // 单个来源失败保留上次快照；其他来源继续。
          console.warn('[AgentUsage] 来源扫描失败', {
            client,
            error: error instanceof Error ? error.name : 'unknown'
          })
        }
      }
    } catch (error) {
      // 兜底：扫描异常不能让刷新请求一直悬着。
      console.warn('[AgentUsage] 统计扫描中断', {
        error: error instanceof Error ? error.name : 'unknown'
      })
    } finally {
      this.scannedAt = Date.now()
      await this.save()
    }
  }

  private async save(): Promise<void> {
    try {
      await this.cache.save({
        version: USAGE_CACHE_VERSION,
        scannedAt: this.scannedAt,
        sources: [...this.sources.values()],
        files: this.scanner.snapshot()
      })
    } catch (error) {
      // 缓存写入失败不影响本次统计结果，只是下次启动需要重扫。
      console.warn('[AgentUsage] 统计缓存写入失败', {
        error: error instanceof Error ? error.name : 'unknown'
      })
    }
  }
}
