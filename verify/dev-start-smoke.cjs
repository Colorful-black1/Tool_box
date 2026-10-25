/** 用原开发配置启动主进程，包装入口只隔离测试数据并在桥接就绪后退出。 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const artifactRoot = path.join(root, '.playwright-mcp')
fs.mkdirSync(artifactRoot, { recursive: true })
const workspace = fs.mkdtempSync(path.join(artifactRoot, 'dev-start-'))
const tempRoot = path.resolve(os.tmpdir())
const profile = fs.mkdtempSync(path.join(tempRoot, 'toolbox-dev-check-'))
const slash = (file) => file.replace(/\\/g, '/')
const entry = path.join(workspace, 'dev-entry.ts')
const config = path.join(workspace, 'dev.config.mjs')
fs.writeFileSync(
  entry,
  `
import { app } from 'electron'
app.setPath('userData', ${JSON.stringify(profile)})
const watchdog = setTimeout(() => app.exit(2), 30000)
app.on('browser-window-created', (_event, win) => {
  win.show = () => undefined
  win.webContents.once('did-finish-load', () => setTimeout(async () => {
    try {
      const ready = await win.webContents.executeJavaScript('Boolean(window.toolbox?.agentDrafts && window.toolbox?.codingAgents)')
      process.stdout.write('DEV_BRIDGE_READY=' + ready + '\\n')
      clearTimeout(watchdog)
      app.quit()
    } catch { app.exit(2) }
  }, 500))
})
void import(${JSON.stringify(slash(path.join(root, 'src/main/index.ts')))})
`
)
fs.writeFileSync(
  config,
  `
import base from '../../electron.vite.config.ts'
export default { ...base, main: { ...base.main, build: { rollupOptions: { input: ${JSON.stringify(slash(entry))}, output: { entryFileNames: 'index.js', chunkFileNames: '[name]-[hash].js' } } } } }
`
)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
let ready = false
const child = spawn(
  process.env.ComSpec || 'cmd.exe',
  ['/d', '/s', '/c', `npm run dev -- --config ${path.relative(root, config)}`],
  { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
)
child.stdout.on('data', (chunk) => {
  if (String(chunk).includes('DEV_BRIDGE_READY=true')) ready = true
  process.stdout.write(chunk)
})
child.stderr.on('data', (chunk) => process.stderr.write(chunk))
child.on('exit', (code) => {
  for (const [directory, parent, prefix] of [
    [workspace, artifactRoot, 'dev-start-'],
    [profile, tempRoot, 'toolbox-dev-check-']
  ]) {
    if (
      path.dirname(path.resolve(directory)) === parent &&
      path.basename(directory).startsWith(prefix)
    )
      fs.rmSync(directory, { recursive: true, force: true })
  }
  // 临时开发入口写进 out/main；结束后恢复正式构建，不能留下隔离目录引用。
  const restore = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run build'], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: 'inherit'
  })
  process.exitCode = ready && code === 0 && restore.status === 0 ? 0 : 1
})
