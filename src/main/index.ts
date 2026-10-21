import { join } from 'node:path'

import { BrowserWindow, Menu, Tray, app, safeStorage } from 'electron'

import { DB_FILE_NAME } from '../shared/constants'
import type { SafeStorageAdapter } from '../shared/safe-storage'
import { registerIpcHandlers } from './ipc/register-ipc'
import { AiGateway } from './services/ai-gateway/ai-gateway'
import { ToolboxStore } from './services/chat-store/chat-store'
import { SafeStorageSecretBox } from './services/crypto/safe-storage-secret-box'
import { ImportService } from './services/library/import-service'
import { PasswordAiService } from './services/password/password-ai-service'
import { SettingsService } from './services/settings/settings-service'
import { ShortcutManager } from './shortcuts'
import { createTray, showMainWindow } from './tray'

const safeStorageAdapter = safeStorage as SafeStorageAdapter

/** 主窗口引用：托盘与快捷键都要用它 */
let mainWindow: BrowserWindow | null = null
/** 系统托盘：关窗后应用仍在后台待命 */
let tray: Tray | null = null
/** 快捷键管理器 */
let shortcuts: ShortcutManager | null = null
/** 是否正在退出：退出流程里不该再拦截窗口关闭 */
let quitting = false

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#080b16',
    autoHideMenuBar: true,
    title: '私人百宝箱',
    icon: join(app.getAppPath(), 'assets/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // 关窗不退出：隐藏到托盘，等用户从托盘唤回或明确退出
  win.on('close', (event) => {
    if (quitting || !tray) return
    event.preventDefault()
    win.hide()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function initializeServices(): void {
  const userDataDir = app.getPath('userData')
  const promptDir = join(app.getAppPath(), 'assets/prompts')
  const settings = new SettingsService(userDataDir, safeStorageAdapter)
  const secretBox = new SafeStorageSecretBox(userDataDir, safeStorageAdapter)
  const store = new ToolboxStore(join(userDataDir, DB_FILE_NAME), secretBox)
  const importService = new ImportService()
  const aiGateway = new AiGateway(settings, store, importService, promptDir)
  const passwordAi = new PasswordAiService(promptDir, (system, user) =>
    aiGateway.complete(system, user)
  )

  shortcuts = new ShortcutManager(store, () => showMainWindow(mainWindow))

  registerIpcHandlers({ settings, store, aiGateway, importService, passwordAi, shortcuts })

  app.on('quit', () => {
    store.close()
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  initializeServices()
  mainWindow = createMainWindow()

  try {
    tray = createTray({
      iconPath: join(app.getAppPath(), 'assets/icon.png'),
      getWindow: () => mainWindow
    })
  } catch (error) {
    // 托盘建不起来（极少数环境）就退回「关窗即退出」，别让应用变成关不掉的僵尸
    console.error('创建系统托盘失败，改为关窗退出：', error)
    tray = null
  }

  shortcuts?.init()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
      return
    }
    showMainWindow(mainWindow)
  })
})

// 有托盘时不退出：关窗只是隐藏，退出走托盘菜单
app.on('window-all-closed', () => {
  if (!tray) app.quit()
})

app.on('before-quit', () => {
  quitting = true
  shortcuts?.dispose()
})
