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

/** 管理全局快捷键，使系统注册状态与已保存配置在更新失败时保持一致。 */
export class ShortcutManager {
  /** 当前已注册的 accelerator，空串表示没注册 */
  private registered = ''

  constructor(
    private readonly store: Pick<ToolboxStore, 'configGet' | 'configSet'>,
    /** 快捷键被按下时的动作（通常是显示窗口） */
    private readonly onTrigger: () => void
  ) {}

  /** 返回实际生效状态；启动注册失败时不把保存的启用偏好当作成功。 */
  read(): ShortcutConfig {
    const saved = this.readSaved()
    return {
      enabled: this.registered !== '',
      accelerator: this.registered || saved.accelerator
    }
  }

  /** 保存偏好与运行状态分开，保留启动注册失败后的重试机会。 */
  private readSaved(): ShortcutConfig {
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
    const config = this.readSaved()
    if (!config.enabled) return
    if (this.register(config.accelerator)) {
      this.registered = config.accelerator
    } else {
      console.warn('启动时未能注册全局快捷键，可在设置中重新启用')
    }
  }

  /** 修改配置并立刻生效 */
  set(input: ShortcutConfig): ShortcutSetResult {
    if (!isSupportedAccelerator(input.accelerator)) {
      return { ok: false, error: '不支持的快捷键组合', config: this.read() }
    }
    const needsRegistration = input.enabled && input.accelerator !== this.registered
    if (needsRegistration && !this.register(input.accelerator)) {
      // 注册失败：保持原状，不落盘
      return {
        ok: false,
        error: '无法注册该快捷键，可能已被其它程序占用',
        config: this.read()
      }
    }
    // 先取得新组合并保存，全部成功后再释放旧组合，避免失败时丢失原快捷键。
    const config = { enabled: input.enabled, accelerator: input.accelerator }
    try {
      this.write(config)
    } catch {
      // 保存失败只释放本次取得的新组合，旧组合与旧配置继续生效。
      if (needsRegistration) globalShortcut.unregister(input.accelerator)
      return { ok: false, error: '无法保存快捷键配置，请稍后重试', config: this.read() }
    }
    if (!input.enabled || input.accelerator !== this.registered) this.unregister()
    this.registered = input.enabled ? input.accelerator : ''
    return { ok: true, config }
  }

  /** 退出前清理：把系统级快捷键还给系统 */
  dispose(): void {
    this.unregister()
    globalShortcut.unregisterAll()
  }

  private register(accelerator: string): boolean {
    if (this.registered === accelerator) return true
    try {
      return globalShortcut.register(accelerator, () => this.onTrigger())
    } catch {
      // 原生注册异常统一转成可恢复的失败结果，不透传系统异常细节。
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
