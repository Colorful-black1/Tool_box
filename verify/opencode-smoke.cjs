/** 复用桌面内置运行时；--connect-only 不创建会话，--prompt 才发送合成短消息。 */
const assert = require('node:assert/strict')
const { Module } = require('node:module')
const path = require('node:path')
const { buildSync } = require('esbuild')
const { setTimeout, clearTimeout } = require('node:timers')

async function main() {
  const root = path.resolve(__dirname, '..')
  const bundle = buildSync({
    entryPoints: [path.join(root, 'src/main/services/opencode/opencode-service.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['better-sqlite3'],
    write: false
  })
  const compiled = new Module(path.join(root, 'verify/opencode-service.cjs'))
  compiled.paths = module.paths
  compiled._compile(bundle.outputFiles[0].text, compiled.id)
  let config = {}
  const store = {
    configGet: () => config,
    configSet: (patch) => (config = { ...config, ...patch })
  }
  const service = new compiled.exports.OpenCodeService(store)
  let timer
  try {
    const installation = await service.inspect()
    assert.ok(installation.executablePath, '未检测到标准安装位置的 OpenCode Desktop')
    const info = await service.connect(root)
    process.stdout.write(`PASS 桌面内置运行时握手 ${info.version}\n`)
    assert.ok(info.visibleModelIds.length > 0, '当前项目没有可见模型')
    process.stdout.write(`PASS 同步 Desktop 可见模型 ${info.visibleModelIds.length} 项\n`)
    if (process.argv.includes('--connect-only')) {
      const before = await service.listSessions()
      let sessionEvents = 0
      service.subscribe((event) => {
        if (event.kind === 'session') sessionEvents++
      })
      service.disconnect()
      await service.connect(root)
      const refreshed = await service.inspect()
      assert.deepEqual(new Set(refreshed.visibleModelIds), new Set(info.visibleModelIds))
      assert.deepEqual(
        (await service.listSessions()).map((item) => item.id),
        before.map((item) => item.id)
      )
      assert.equal(sessionEvents, 0)
      process.stdout.write('PASS 重连与模型同步不创建或恢复会话，原生列表保持不变\n')
      return
    }
    const session = await service.openSession()
    assert.equal(session.options.find((item) => item.category === 'mode')?.currentValue, 'plan')
    process.stdout.write('PASS 创建会话并默认 Plan\n')
    assert.ok((await service.listSessions()).some((item) => item.id === session.id))
    process.stdout.write('PASS 读取当前项目原生会话列表\n')
    if (process.argv.includes('--prompt')) {
      const completed = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('合成消息验证超时')), 90_000)
        service.subscribe((event) => {
          if (event.kind !== 'session' || event.session.id !== session.id) return
          for (const approval of event.session.approvals)
            service.approve(session.id, approval.id, false)
          if (event.session.status === 'error') reject(new Error('OpenCode 模型请求未成功'))
          if (event.session.status === 'ready' && event.session.messages.length > 1) resolve()
        })
      })
      service.send(
        session.id,
        '这是 Tool_box 的连接验证。不要读取或修改文件，不调用任何工具，只回复：TOOLBOX_OPENCODE_OK'
      )
      await completed
      assert.ok(
        session.messages.some(
          (message) =>
            message.role === 'assistant' && message.content.includes('TOOLBOX_OPENCODE_OK')
        )
      )
      process.stdout.write('PASS 真实合成消息回复与任务结算\n')
    }
    const savedId = session.id
    service.disconnect()
    await service.connect(root)
    const restored = await service.openSession(savedId)
    assert.equal(restored.id, savedId)
    if (process.argv.includes('--prompt'))
      assert.ok(
        restored.messages.some((message) => message.content.includes('TOOLBOX_OPENCODE_OK'))
      )
    process.stdout.write('PASS 重连后恢复原生会话\n')
  } finally {
    clearTimeout(timer)
    service.disconnect()
  }
}

main().catch(() => {
  // 不回显第三方异常，避免把凭据、用户路径或模型返回内容写入终端。
  process.stderr.write('OpenCode 实机验证未通过，请检查登录、模型、项目与连接状态\n')
  process.exitCode = 1
})
