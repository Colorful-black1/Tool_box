/**
 * 全局快捷键：唤起百宝箱窗口。
 *
 * 设计要点：
 * - **默认关闭**：全局占用快捷键容易和别的程序打架，该由用户自己开；
 * - 配置存在 kv 的 `shortcut` 字段里（与阅读配置同一个 blob，但互不干扰）；
 * - 注册失败（被别的程序占用）时**不落盘**，把原因回给界面。
 */
import { globalShortcut } from 'electron'

import { DEFAULT_SHORTCUT_CONFIG, SHORTCUT_ACCELERATORS } from '../shared/types'
import type { ShortcutConfig, ShortcutSetResult } from '../shared/types'
import type { ToolboxStore } from './services/chat-store/chat-store'

/** 配置在 kv 里的字段名 */
const CONFIG_KEY = 'shortcut'

export class ShortcutManager {
  /** 当前已注册的 accelerator，空串表示没注册 */
  private registered = ''

  constructor(
    private readonly store: ToolboxStore,
    /** 快捷键被按下时的动作（通常是显示窗口） */
    private readonly onTrigger: () => void
  ) {}

  /** 读配置：字段缺失或非法时回落默认值，绝不抛错 */
  read(): ShortcutConfig {
    const raw = this.store.configGet()
    const value = raw?.[CONFIG_KEY]
    if (typeof value !== 'object' || value === null) return { ...DEFAULT_SHORTCUT_CONFIG }
    const record = value as Record<string, unknown>
    const accelerator =
      typeof record.accelerator === 'string' && isSupportedAccelerator(record.accelerator)
        ? record.accelerator
        : DEFAULT_SHORTCUT_CONFIG.accelerator
    return { enabled: record.enabled === true, accelerator }
  }

  /** 启动时应用已保存的配置 */
  init(): void {
    const config = this.read()
    if (config.enabled) this.register(config.accelerator)
  }

  /** 修改配置并立刻生效 */
  set(input: ShortcutConfig): ShortcutSetResult {
    if (!isSupportedAccelerator(input.accelerator)) {
      return { ok: false, error: '不支持的快捷键组合', config: this.read() }
    }
    if (!input.enabled) {
      this.unregister()
      this.write({ enabled: false, accelerator: input.accelerator })
      return { ok: true, config: { enabled: false, accelerator: input.accelerator } }
    }
    if (!this.register(input.accelerator)) {
      // 注册失败：保持原状，不落盘
      return {
        ok: false,
        error: `快捷键 ${input.accelerator} 已被其它程序占用`,
        config: this.read()
      }
    }
    this.write({ enabled: true, accelerator: input.accelerator })
    return { ok: true, config: { enabled: true, accelerator: input.accelerator } }
  }

  /** 退出前清理：把系统级快捷键还给系统 */
  dispose(): void {
    this.unregister()
    globalShortcut.unregisterAll()
  }

  private register(accelerator: string): boolean {
    this.unregister()
    try {
      const ok = globalShortcut.register(accelerator, () => this.onTrigger())
      if (ok) this.registered = accelerator
      return ok
    } catch {
      return false
    }
  }

  private unregister(): void {
    if (!this.registered) return
    globalShortcut.unregister(this.registered)
    this.registered = ''
  }

  private write(config: ShortcutConfig): void {
    this.store.configSet({ [CONFIG_KEY]: config })
  }
}

/** 只接受预设里的组合，避免用户手输拼错 */
function isSupportedAccelerator(value: string): boolean {
  return SHORTCUT_ACCELERATORS.includes(value)
}
