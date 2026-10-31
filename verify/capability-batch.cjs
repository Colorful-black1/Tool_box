/* global window:readonly, global:readonly */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron } = require('playwright')

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'toolbox-capability-'))
  const env = { ...process.env, TOOLBOX_CAPABILITY_PROFILE: profile }
  if (process.argv.includes('--dialog-failure')) env.TOOLBOX_CAPABILITY_DIALOG_FAIL = '1'
  delete env.ELECTRON_RUN_AS_NODE
  let app
  const launch = () =>
    _electron.launch({ args: [path.join(__dirname, 'capability-batch-main.cjs')], env })
  try {
    app = await launch()
    app.process().stderr.on('data', (chunk) => process.stderr.write(chunk))
    let page = await app.firstWindow()
    await page.waitForFunction(() => Boolean(window.toolbox))
    const counts = await app.evaluate(() => global.capabilityVerification.counts())
    assert.deepEqual(counts, { books: 1, passwords: 1, decryptable: true, notes: 1, todos: 1 })
    await page.evaluate(() =>
      window.toolbox.clipboardHistory.setEnabled({ enabled: true, keywords: [], prefixes: [] })
    )
    for (const text of ['第一段', '第二段', '第三段', '第三段'])
      await app.evaluate(async (_, value) => global.capabilityVerification.poll(value), text)
    let snapshot = await page.evaluate(() => window.toolbox.clipboardHistory.list())
    assert.deepEqual(
      snapshot.entries.map((entry) => entry.text),
      ['第三段', '第二段', '第一段']
    )
    await page.evaluate(() => window.toolbox.system.copyText('synthetic-password-copy'))
    await app.evaluate(async () => global.capabilityVerification.poll('synthetic-password-copy'))
    await app.evaluate(async () =>
      global.capabilityVerification.poll('rich', ['text/html', 'text/plain'])
    )
    snapshot = await page.evaluate(() => window.toolbox.clipboardHistory.list())
    assert.equal(snapshot.entries.length, 3)
    await page.evaluate(async () => {
      await window.toolbox.clipboardHistory.pause()
      await window.toolbox.clipboardHistory.setEnabled({
        enabled: false,
        keywords: [],
        prefixes: []
      })
    })
    await app.evaluate(async () => global.capabilityVerification.poll('关闭不记录'))
    assert.equal(
      (await page.evaluate(() => window.toolbox.clipboardHistory.list())).entries.length,
      3
    )
    process.stdout.write(
      'PASS 真实 IPC 与预加载：剪贴板顺序、去重、应用复制排除、富文本忽略及关闭\n'
    )
    const files = path.join(profile, 'files')
    await fs.mkdir(files)
    await fs.writeFile(path.join(files, 'a'), 'same')
    await fs.writeFile(path.join(files, 'b'), 'same')
    await app.evaluate((_, folder) => global.capabilityVerification.choose(folder), files)
    const directory = await page.evaluate(() => window.toolbox.files.chooseDirectory())
    const result = await page.evaluate(
      (token) => window.toolbox.files.findDuplicates(token),
      directory.token
    )
    assert.equal(result.groups.length, 1)
    assert.equal(result.groups[0].paths.length, 2)
    const cancelled = await page.evaluate(async (token) => {
      const pending = window.toolbox.files.findDuplicates(token)
      await window.toolbox.files.cancelScan()
      return pending
    }, directory.token)
    assert.equal(cancelled.phase, 'cancelled')
    const rescanned = await page.evaluate(
      (token) => window.toolbox.files.findDuplicates(token),
      directory.token
    )
    assert.deepEqual(rescanned.groups, result.groups)
    await assert.rejects(page.evaluate(() => window.toolbox.files.findDuplicates('arbitrary-path')))
    process.stdout.write(
      'PASS 真实 IPC：系统选目录引用、只读查重、取消与再次扫描一致，拒绝伪造路径\n'
    )
    const documents = path.join(profile, 'documents')
    await app.evaluate((_, folder) => global.capabilityVerification.choose(folder), documents)
    const exportChoice = await page.evaluate(() => window.toolbox.backup.chooseFolder('export'))
    const exported = await page.evaluate(
      (token) => window.toolbox.backup.export(token),
      exportChoice.token
    )
    const manifest = JSON.parse(
      await fs.readFile(path.join(exported.path, 'manifest.json'), 'utf8')
    )
    assert.equal(manifest.schemaVersion, 5)
    assert.equal(manifest.localOnly, true)
    await app.evaluate(() => global.capabilityVerification.mutate())
    assert.equal((await app.evaluate(() => global.capabilityVerification.counts())).notes, 2)
    await app.evaluate((_, folder) => global.capabilityVerification.choose(folder), exported.path)
    await app.evaluate(() => global.capabilityVerification.allowRestore(false))
    const blocked = await page.evaluate(() => window.toolbox.backup.chooseFolder('restore'))
    await assert.rejects(
      page.evaluate((token) => window.toolbox.backup.restore(token), blocked.token),
      /停止/
    )
    await app.evaluate(() => global.capabilityVerification.allowRestore(true))
    const choice = await page.evaluate(() => window.toolbox.backup.chooseFolder('restore'))
    assert.equal(
      await page.evaluate((token) => window.toolbox.backup.restore(token), choice.token),
      null
    )
    assert.equal((await app.evaluate(() => global.capabilityVerification.counts())).notes, 2)
    const confirmed = await page.evaluate(() => window.toolbox.backup.chooseFolder('restore'))
    await app.evaluate(() => global.capabilityVerification.confirmRestore())
    const closed = app.waitForEvent('close')
    await page
      .evaluate((token) => window.toolbox.backup.restore(token), confirmed.token)
      .catch((error) => {
        assert.match(error.message, /closed|destroyed|exited/i)
      })
    await closed
    app = await launch()
    page = await app.firstWindow()
    await page.waitForFunction(() => Boolean(window.toolbox))
    assert.deepEqual(await app.evaluate(() => global.capabilityVerification.counts()), counts)
    assert.equal(
      (await page.evaluate(() => window.toolbox.clipboardHistory.list())).entries.length,
      0
    )
    assert.equal((await page.evaluate(() => window.toolbox.clipboardHistory.list())).enabled, false)
    const backups = await fs.readdir(path.join(profile, 'data', 'backups'))
    assert.ok(backups.some((name) => name.startsWith('before-restore-')))
    process.stdout.write(
      'PASS 真实 SQLite + DPAPI + IPC：导出、取消恢复、确认恢复退出、重启后四域数量和密码解密一致，剪贴板清空\n'
    )
  } finally {
    if (app) await app.close().catch(() => {})
    process.stdout.write(`隔离验收目录保留：${profile}\n`)
  }
}
main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})
