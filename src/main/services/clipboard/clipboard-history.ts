import { createHash, randomUUID } from 'node:crypto'
import type {
  ClipboardHistoryConfig,
  ClipboardHistoryEntry,
  ClipboardHistorySnapshot
} from '../../../shared/clipboard'

export const CLIPBOARD_POLL_MS = 700
export const CLIPBOARD_MAX_ENTRIES = 200
export const CLIPBOARD_MAX_TEXT = 10_000
const PAUSE_MS = 30 * 60_000
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')

/** 仅内存采集；关闭时不启动轮询，全部异常使用固定文案且不包含剪贴板内容。 */
export class ClipboardHistoryService {
  private entries: ClipboardHistoryEntry[] = []
  private config: ClipboardHistoryConfig = { enabled: false, keywords: [], prefixes: [] }
  private pausedUntilMs = 0
  private revision = 0
  private lastHash = ''
  private excluded = new Set<string>()
  private timer: ReturnType<typeof setInterval> | undefined
  private error = ''
  // 配置版本与样本失效分开：自身复制或清空不能取消开启时的轮询初始化。
  private epoch = 0
  private captureEpoch = 0
  private reading = false

  constructor(
    private readonly readText: () => string | Promise<string>,
    private readonly canCollect: () => boolean,
    private readonly changed: (snapshot: ClipboardHistorySnapshot) => void,
    private readonly now: () => number = Date.now
  ) {}

  snapshot(): ClipboardHistorySnapshot {
    return {
      ...this.config,
      keywords: [...this.config.keywords],
      prefixes: [...this.config.prefixes],
      entries: this.entries
        .map((item) => ({ ...item }))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.capturedAtMs - a.capturedAtMs),
      pausedUntilMs: this.pausedUntilMs,
      revision: this.revision,
      error: this.error
    }
  }

  async configure(config: ClipboardHistoryConfig): Promise<ClipboardHistorySnapshot> {
    const epoch = ++this.epoch
    const captureEpoch = ++this.captureEpoch
    const newlyEnabled = !this.config.enabled && config.enabled
    this.config = { ...config, keywords: [...config.keywords], prefixes: [...config.prefixes] }
    if (newlyEnabled) {
      // 不追溯开启前已经在剪贴板中的敏感内容。
      try {
        const text = await this.readText()
        if (epoch !== this.epoch) return this.snapshot()
        if (captureEpoch === this.captureEpoch) this.lastHash = hash(text)
      } catch {
        this.error = '无法读取系统剪贴板，请稍后重试'
      }
    }
    if (epoch !== this.epoch) return this.snapshot()
    if (config.enabled && !this.timer) {
      this.timer = setInterval(() => {
        void this.poll()
      }, CLIPBOARD_POLL_MS)
      this.timer.unref?.()
    } else if (!config.enabled && this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    if (!config.enabled) this.pausedUntilMs = 0
    return this.emit()
  }

  /** 既有应用复制统一排除；仅存哈希，清空历史也不清除此隐私保护。 */
  excludeCopy(text: string): void {
    this.captureEpoch += 1
    const digest = hash(text)
    this.excluded.add(digest)
    this.lastHash = digest
  }

  async poll(): Promise<void> {
    if (!this.config.enabled || !this.canCollect() || this.reading) return
    this.reading = true
    const epoch = this.epoch
    const captureEpoch = this.captureEpoch
    const now = this.now()
    try {
      const text = await this.readText()
      if (
        epoch !== this.epoch ||
        captureEpoch !== this.captureEpoch ||
        !this.config.enabled ||
        !this.canCollect()
      )
        return
      const digest = hash(text)
      const previous = this.lastHash
      this.lastHash = digest
      if (this.pausedUntilMs && now >= this.pausedUntilMs) {
        this.pausedUntilMs = 0
        this.emit()
      }
      if (this.error) {
        this.error = ''
        this.emit()
      }
      if (
        now < this.pausedUntilMs ||
        digest === previous ||
        !text.trim() ||
        this.excluded.has(digest)
      )
        return
      if (
        this.config.keywords.some((word) => text.includes(word)) ||
        this.config.prefixes.some((prefix) => text.startsWith(prefix))
      )
        return
      const truncated = text.length > CLIPBOARD_MAX_TEXT
      const value = text.slice(0, CLIPBOARD_MAX_TEXT)
      const item = {
        id: randomUUID(),
        text: value,
        preview: value.replace(/\s+/g, ' ').slice(0, 160),
        capturedAtMs: now,
        pinned: false,
        truncated
      }
      if (this.entries.length >= CLIPBOARD_MAX_ENTRIES) {
        let index = this.entries.length - 1
        while (index >= 0 && this.entries[index].pinned) index -= 1
        if (index < 0) return
        this.entries.splice(index, 1)
      }
      this.entries.unshift(item)
      this.emit()
    } catch {
      if (epoch === this.epoch) {
        this.error = '无法读取系统剪贴板，请稍后重试'
        this.emit()
      }
    } finally {
      this.reading = false
    }
  }

  pause(): ClipboardHistorySnapshot {
    this.captureEpoch += 1
    this.pausedUntilMs = this.config.enabled ? this.now() + PAUSE_MS : 0
    return this.emit()
  }

  clear(id?: string): ClipboardHistorySnapshot {
    this.captureEpoch += 1
    this.entries = id ? this.entries.filter((item) => item.id !== id) : []
    return this.emit()
  }

  pin(id: string, pinned: boolean): ClipboardHistorySnapshot {
    const item = this.entries.find((entry) => entry.id === id)
    if (!item) throw new Error('该剪贴板记录已不存在')
    item.pinned = pinned
    return this.emit()
  }

  dispose(): void {
    this.epoch += 1
    this.captureEpoch += 1
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.entries = []
    this.excluded.clear()
    this.config = { enabled: false, keywords: [], prefixes: [] }
  }

  private emit(): ClipboardHistorySnapshot {
    this.revision += 1
    const snapshot = this.snapshot()
    this.changed(snapshot)
    return snapshot
  }
}
