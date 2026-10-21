const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

// 必须由验收脚本传入临时配置目录，禁止回落到用户的日常数据目录。
if (!process.env.TOOLBOX_UI_VERIFY_PROFILE) throw new Error('缺少隔离验收目录')
app.setPath('userData', process.env.TOOLBOX_UI_VERIFY_PROFILE)
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
