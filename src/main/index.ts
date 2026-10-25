import { join } from 'node:path'

import { BrowserWindow, Menu, Tray, app, safeStorage, dialog } from 'electron'

import { DB_FILE_NAME } from '../shared/constants'
import type { SafeStorageAdapter } from '../shared/safe-storage'
import { registerIpcHandlers } from './ipc/register-ipc'
import { AiGateway } from './services/ai-gateway/ai-gateway'
import { ToolboxStore } from './services/chat-store/chat-store'
import { SafeStorageSecretBox } from './services/crypto/safe-storage-secret-box'
import { ImportService } from './services/library/import-service'
import { PasswordAiService } from './services/password/password-ai-service'
import { SettingsService } from './services/settings/settings-service'
import { OpenCodeService } from './services/opencode/opencode-service'
import { AgentDraftService } from './services/coding-agents/agent-draft-service'
import { AgentDraftQuitFlush, registerAgentDraftsIpc } from './ipc/agent-drafts-ipc'
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
let checkingQuit = false
const draftQuitFlush = new AgentDraftQuitFlush()

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
    if (quitting) return
    event.preventDefault()
    if (tray) win.hide()
    else app.quit()
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
  registerAgentDraftsIpc(new AgentDraftService(store, secretBox), draftQuitFlush)
  const importService = new ImportService()
  const aiGateway = new AiGateway(settings, store, importService, promptDir)
  const passwordAi = new PasswordAiService(promptDir, (system, user, options) =>
    aiGateway.complete(system, user, options)
  )

  shortcuts = new ShortcutManager(store, () => showMainWindow(mainWindow))

  const opencode = new OpenCodeService(store)
  registerIpcHandlers({ settings, store, aiGateway, importService, passwordAi, shortcuts, opencode })

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

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  if (checkingQuit) return
  checkingQuit = true
  void (async () => {
    const saved =
      mainWindow && !mainWindow.isDestroyed()
        ? await draftQuitFlush.request(mainWindow.webContents)
        : false
    if (!saved) {
      const choice = await dialog.showMessageBox({
        type: 'warning',
        title: '草稿尚未保存',
        message: '未能确认最新草稿已保存',
        detail: '可以返回应用重试。仍然退出可能丢失最后一段尚未保存的文字，已保存记录会保留。',
        buttons: ['返回应用', '仍然退出'],
        defaultId: 0,
        cancelId: 0
      })
      if (choice.response === 0) {
        checkingQuit = false
        showMainWindow(mainWindow)
        return
      }
    }
    quitting = true
    app.quit()
  })().catch(() => {
    checkingQuit = false
    showMainWindow(mainWindow)
    console.warn('草稿退出确认未完成，已返回应用')
  })
})

app.on('will-quit', () => {
  shortcuts?.dispose()
})
