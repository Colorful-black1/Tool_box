const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { Module } = require('node:module')
const { buildSync } = require('esbuild')

// 必须由验收脚本传入临时配置目录，禁止回落到用户的日常数据目录。
if (!process.env.TOOLBOX_UI_VERIFY_PROFILE) throw new Error('缺少隔离验收目录')
app.setPath('userData', process.env.TOOLBOX_UI_VERIFY_PROFILE)
// 草稿使用真实 SQLite 与系统加密，始终限定在本次验收的临时目录。
const bundle = buildSync({
  stdin: {
    contents: `
  export { ToolboxStore } from './src/main/services/chat-store/chat-store'
  export { SafeStorageSecretBox } from './src/main/services/crypto/safe-storage-secret-box'
  export { AgentDraftService } from './src/main/services/coding-agents/agent-draft-service'
  export { AgentDraftQuitFlush, registerAgentDraftsIpc } from './src/main/ipc/agent-drafts-ipc'
`,
    resolveDir: path.resolve(__dirname, '../..'),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['electron', 'better-sqlite3']
})
const compiled = new Module(path.join(__dirname, 'draft-verification.cjs'))
compiled.paths = module.paths
compiled._compile(bundle.outputFiles[0].text, compiled.id)
// 外观验收独立保存合成配置，重载/重启后仍可验证；不接触真实 toolbox.db。
const configPath = path.join(process.env.TOOLBOX_UI_VERIFY_PROFILE, 'verify-config.json')
let config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
  : { fontSize: 23, themeIndex: 3, nightMode: false }
let failSave = false
ipcMain.handle('verify:config:get', () => config)
ipcMain.handle('verify:config:set', (_event, patch) => {
  if (failSave) {
    failSave = false
    throw new Error('合成保存失败')
  }
  config = { ...config, ...patch }
  fs.writeFileSync(configPath, JSON.stringify(config))
  return config
})
ipcMain.handle('verify:config:fail-save', () => {
  failSave = true
})
app.whenReady().then(() => {
  const { safeStorage } = require('electron')
  const {
    ToolboxStore,
    SafeStorageSecretBox,
    AgentDraftService,
    AgentDraftQuitFlush,
    registerAgentDraftsIpc
  } = compiled.exports
  const store = new ToolboxStore(
    path.join(process.env.TOOLBOX_UI_VERIFY_PROFILE, 'toolbox.db'),
    new SafeStorageSecretBox(process.env.TOOLBOX_UI_VERIFY_PROFILE, safeStorage)
  )
  const drafts = new AgentDraftService(
    store,
    new SafeStorageSecretBox(process.env.TOOLBOX_UI_VERIFY_PROFILE, safeStorage)
  )
  const quitFlush = new AgentDraftQuitFlush()
  let failRead = false,
    failDraftSave = false
  const read = drafts.read.bind(drafts),
    save = drafts.save.bind(drafts)
  drafts.read = () => {
    if (failRead) {
      failRead = false
      throw new Error('合成草稿读取失败')
    }
    return read()
  }
  drafts.save = (input) => {
    if (failDraftSave) {
      failDraftSave = false
      throw new Error('合成草稿保存失败')
    }
    return save(input)
  }
  registerAgentDraftsIpc(drafts, quitFlush)
  ipcMain.handle('verify:draft:flush', (event) => quitFlush.request(event.sender))
  ipcMain.handle('verify:draft:fail-read', () => {
    failRead = true
  })
  ipcMain.handle('verify:draft:fail-save', () => {
    failDraftSave = true
  })
  ipcMain.handle('verify:draft:encrypted', () => {
    const value = store.agentDraftCipherGet()
    if (!value) return false
    const envelope = JSON.parse(value)
    return envelope.v === 2 && envelope.purpose === 'agent-drafts' && !value.includes('合成草稿')
  })
  app.on('quit', () => store.close())
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    useContentSize: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      // 隐藏窗口仍需执行布局与动画帧，供 Playwright 检查滚动和焦点。
      backgroundThrottling: false
    }
  })
  void win.loadFile(path.join(__dirname, '../../out/renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
