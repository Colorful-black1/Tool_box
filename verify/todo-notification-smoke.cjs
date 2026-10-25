/* 只显示一条合成通知，不打开用户数据库或启动主应用。 */
/* global __filename:readonly */
const { setTimeout, clearTimeout } = require('node:timers')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-notification-'))
  try {
    const env = { ...process.env, TOOLBOX_NOTIFICATION_PROFILE: root }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [__filename], {
      env,
      stdio: 'inherit',
      timeout: 20000
    })
    process.exitCode = result.status ?? 1
  } finally {
    if (
      path.dirname(path.resolve(root)) === path.resolve(os.tmpdir()) &&
      path.basename(root).startsWith('toolbox-notification-')
    )
      fs.rmSync(root, { recursive: true, force: true })
  }
} else {
  const { app, Notification } = require('electron')
  if (!process.env.TOOLBOX_NOTIFICATION_PROFILE) throw new Error('缺少隔离通知验收目录')
  app.setPath('userData', process.env.TOOLBOX_NOTIFICATION_PROFILE)
  app.whenReady().then(() => {
    app.setAppUserModelId('com.toolbox.app')
    if (!Notification.isSupported()) {
      process.stderr.write('当前系统不支持通知\n')
      app.exit(1)
      return
    }
    const notification = new Notification({
      title: '私人百宝箱 · 测试提醒',
      body: '这是一条待办功能验收通知，没有创建真实待办。'
    })
    const timer = setTimeout(() => {
      notification.close()
      process.stderr.write('系统未确认显示通知\n')
      app.exit(1)
    }, 10000)
    notification.once('show', () => {
      clearTimeout(timer)
      process.stdout.write('PASS Windows 通知接口确认显示合成提醒；最终可见性受免打扰设置影响\n')
      setTimeout(() => {
        notification.close()
        app.quit()
      }, 1500)
    })
    notification.once('failed', () => {
      clearTimeout(timer)
      process.stderr.write('系统通知显示失败，请在正式安装环境验收\n')
      app.exit(1)
    })
    notification.show()
  })
}
