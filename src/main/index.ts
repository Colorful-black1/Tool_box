import { join } from 'node:path'

import { BrowserWindow, Menu, app, safeStorage } from 'electron'

import { DB_FILE_NAME } from '../shared/constants'
import { registerIpcHandlers } from './ipc/register-ipc'
import { AiGateway } from './services/ai-gateway/ai-gateway'
import { ToolboxStore } from './services/chat-store/chat-store'
import { ImportService } from './services/library/import-service'
import { SafeStorageSecretBox } from './services/crypto/safe-storage-secret-box'
import { SettingsService } from './services/settings/settings-service'
import type { SafeStorageAdapter } from '../shared/safe-storage'

const safeStorageAdapter = safeStorage as SafeStorageAdapter

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#080b16',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function initializeServices(): void {
  const userDataDir = app.getPath('userData')
  const settings = new SettingsService(userDataDir, safeStorageAdapter)
  const secretBox = new SafeStorageSecretBox(userDataDir, safeStorageAdapter)
  const store = new ToolboxStore(join(userDataDir, DB_FILE_NAME), secretBox)
  const aiGateway = new AiGateway(settings, store)
  const importService = new ImportService()

  registerIpcHandlers({ settings, store, aiGateway, importService })

  app.on('quit', () => {
    store.close()
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  initializeServices()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
