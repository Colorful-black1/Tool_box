/* global global:readonly, Blob:readonly */
// 隔离真实服务验收入口。只接受脚本创建的临时目录，不读真实数据或系统剪贴板。
const { app, BrowserWindow, clipboard, dialog, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { Module } = require('node:module')
const { buildSync } = require('esbuild')
const profile = process.env.TOOLBOX_CAPABILITY_PROFILE
if (!profile || !path.basename(profile).startsWith('toolbox-capability-'))
  throw new Error('缺少隔离目录')
app.setPath('userData', path.join(profile, 'data'))
fs.mkdirSync(app.getPath('userData'), { recursive: true })
fs.mkdirSync(path.join(profile, 'documents'), { recursive: true })
app.setPath('documents', path.join(profile, 'documents'))
const bundle = buildSync({
  stdin: {
    contents: `
export { ToolboxStore } from './src/main/services/chat-store/chat-store'
export { SafeStorageSecretBox } from './src/main/services/crypto/safe-storage-secret-box'
export { registerClipboardIpc } from './src/main/ipc/clipboard-ipc'
export { registerFileToolsIpc } from './src/main/ipc/file-tools-ipc'
export { registerBackupIpc } from './src/main/ipc/backup-ipc'
export { recoverInterruptedRestore } from './src/main/services/backup/backup-service'
`,
    resolveDir: path.resolve(__dirname, '..'),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['electron', 'better-sqlite3']
})
const compiled = new Module(path.join(__dirname, 'capability-compiled.cjs'))
compiled.paths = module.paths
compiled._compile(bundle.outputFiles[0].text, compiled.id)
app
  .whenReady()
  .then(async () => {
    const api = compiled.exports
    const data = app.getPath('userData')
    api.recoverInterruptedRestore(data)
    const store = new api.ToolboxStore(
      path.join(data, 'toolbox.db'),
      new api.SafeStorageSecretBox(data, safeStorage)
    )
    if (!fs.existsSync(path.join(profile, 'seeded'))) {
      store.importBook({
        title: '合成书',
        author: '合成作者',
        chapters: [{ title: '一', body: '合成章节' }]
      })
      store.savePassword({
        title: '合成账号',
        url: '',
        account: 'fixture',
        password: 'OnlySynthetic#1234',
        remark: ''
      })
      store.saveNote({ title: '合成笔记', content: '合成正文' })
      store.saveTodo({
        title: '合成待办',
        details: '',
        priority: 'normal',
        startAtMs: null,
        dueAtMs: null,
        remind: false
      })
      fs.mkdirSync(path.join(data, 'covers'), { recursive: true })
      fs.writeFileSync(path.join(data, 'covers', 'synthetic-cover'), 'cover')
      fs.writeFileSync(
        path.join(data, 'ai-settings.json'),
        JSON.stringify({ version: 2, profiles: [] })
      )
      fs.writeFileSync(path.join(profile, 'seeded'), '1')
    }
    let text = '',
      formats = ['text/plain'],
      folder = profile,
      confirm = 0
    clipboard.read = async () => [{ types: formats, getType: async () => new Blob([text]) }]
    clipboard.writeText = async (value) => {
      text = value
    }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    dialog.showMessageBox = async () => ({ response: confirm })
    dialog.showMessageBoxSync = () => {
      if (process.env.TOOLBOX_CAPABILITY_DIALOG_FAIL === '1')
        throw new Error('synthetic-dialog-failure')
      return 0
    }
    const history = api.registerClipboardIpc()
    api.registerFileToolsIpc()
    let restoreAllowed = true
    api.registerBackupIpc(store, () => restoreAllowed)
    global.capabilityVerification = {
      allowRestore: (allowed) => {
        restoreAllowed = allowed
      },
      poll: async (value, types = ['text/plain']) => {
        text = value
        formats = types
        await history.poll()
      },
      choose: (value) => {
        folder = value
      },
      confirmRestore: () => {
        confirm = 1
      },
      counts: () => ({
        books: store.listBooks().length,
        passwords: store.listPasswords().length,
        decryptable: store.listPasswords().every((entry) => entry.isDecryptable),
        notes: store.listNotes().length,
        todos: store.listTodos({ filter: 'all', search: '', offset: 0, limit: 100 }).total
      }),
      mutate: () => {
        store.saveNote({ title: '恢复前新增', content: '应保留在前置快照' })
      }
    }
    app.on('quit', () => store.close())
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.resolve(__dirname, '../out/preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    await win.loadURL('data:text/html,<title>隔离能力验收</title>')
  })
  .catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`)
    app.exit(1)
  })
