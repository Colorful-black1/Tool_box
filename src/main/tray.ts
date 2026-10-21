/**
 * 系统托盘：关窗后应用仍在后台待命，随时从托盘唤回。
 *
 * 托盘菜单只做两件事：显示窗口、退出。
 * 「新建对话」这类要驱动界面的动作需要主进程 → 渲染层的事件通道，
 * 属于协议改动，等授权后再加。
 */
import { Menu, Tray, app, nativeImage } from 'electron'
import type { BrowserWindow } from 'electron'

export interface TrayOptions {
  /** 托盘图标路径 */
  iconPath: string
  /** 取当前主窗口（可能已被销毁） */
  getWindow: () => BrowserWindow | null
}

/** 显示并聚焦主窗口（最小化时先还原） */
export function showMainWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * 托盘图标：应用图标是 512px 的大图，直接塞给托盘会被系统缩得很糊。
 * 这里先缩到 32px 再交给系统（Windows 托盘会再按 DPI 微调）。
 */
function loadTrayIcon(iconPath: string): Electron.NativeImage | string {
  try {
    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) return iconPath
    return image.resize({ width: 32, height: 32, quality: 'best' })
  } catch {
    return iconPath
  }
}

export function createTray(options: TrayOptions): Tray {
  const tray = new Tray(loadTrayIcon(options.iconPath))
  tray.setToolTip('私人百宝箱')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示百宝箱',
        click: () => showMainWindow(options.getWindow())
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.quit()
        }
      }
    ])
  )
  // Windows 上左键点托盘图标 = 显示窗口
  tray.on('click', () => showMainWindow(options.getWindow()))
  return tray
}
