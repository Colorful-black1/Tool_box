/** 只握手、列模型与项目会话；配置留在内存，不创建 thread 或发送 turn。 */
const assert = require('node:assert/strict')
const { Module } = require('node:module')
const path = require('node:path')
const { buildSync } = require('esbuild')

async function main() {
  const root = path.resolve(__dirname, '..')
  const bundle = buildSync({
    entryPoints: [path.join(root, 'src/main/services/coding-agents/codex-adapter.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false
  })
  const compiled = new Module(path.join(root, 'verify/codex-adapter.cjs'))
  compiled.paths = module.paths
  compiled._compile(bundle.outputFiles[0].text, compiled.id)
  let config = {},
    sessionEvents = 0
  const adapter = new compiled.exports.CodexAdapter({
    configGet: () => config,
    configSet: (patch) => (config = { ...config, ...patch })
  })
  adapter.subscribe((event) => {
    if (event.kind === 'session') ++sessionEvents
  })
  try {
    const info = await adapter.connect(root)
    assert.equal(info.connected, true)
    assert.ok(info.visibleModelIds.length > 0)
    process.stdout.write(
      `PASS Codex App Server ${info.version}，原生模型 ${info.visibleModelIds.length} 项\n`
    )
    const before = await adapter.listSessions()
    await adapter.inspect()
    adapter.disconnect()
    await adapter.connect(root)
    assert.deepEqual(
      (await adapter.listSessions()).map((item) => item.id).sort(),
      before.map((item) => item.id).sort()
    )
    assert.equal(sessionEvents, 0)
    process.stdout.write('PASS 项目历史、模型同步与重连；未创建、恢复或发送会话\n')
  } finally {
    adapter.disconnect()
  }
}

main().catch(() => {
  process.stderr.write('Codex 连接探针未通过，请检查本机原生程序、登录与项目配置\n')
  process.exitCode = 1
})
