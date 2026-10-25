/** 只初始化和列摘要，不创建/恢复会话，不向任何模型发送任务。 */
const assert = require('node:assert/strict')
const { Module } = require('node:module')
const path = require('node:path')
const { buildSync } = require('esbuild')

async function check(name, file, exportName) {
  const root = path.resolve(__dirname, '..')
  const bundle = buildSync({
    entryPoints: [path.join(root, `src/main/services/coding-agents/${file}.ts`)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['@anthropic-ai/claude-agent-sdk']
  })
  const compiled = new Module(path.join(root, `verify/${file}.cjs`))
  compiled.paths = module.paths
  compiled._compile(bundle.outputFiles[0].text, compiled.id)
  let config = {},
    sessions = 0
  const adapter = new compiled.exports[exportName]({
    configGet: () => config,
    configSet: (patch) => (config = { ...config, ...patch })
  })
  adapter.subscribe((event) => {
    if (event.kind === 'session') sessions++
  })
  try {
    const info = await adapter.connect(root)
    assert.equal(info.connected, true)
    const summaries = await adapter.listSessions()
    assert.equal(sessions, 0)
    process.stdout.write(
      `PASS ${name} ${info.version} 初始化与历史摘要（${summaries.length} 条）；未创建、恢复或发送会话\n`
    )
  } finally {
    adapter.disconnect()
  }
}

async function main() {
  if (!process.argv.includes('--dsh-only'))
    await check('Claude SDK', 'claude-adapter', 'ClaudeAdapter')
  if (!process.argv.includes('--claude-only')) await check('DSH ACP', 'dsh-adapter', 'DshAdapter')
}
main().catch((error) => {
  // 仅打印本项目定义的错误，不输出原生 stderr、堆栈或凭据。
  const message =
    error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
      ? error.message.slice(0, 200)
      : '原生连接探针未通过'
  process.stderr.write(message + '\n')
  process.exitCode = 1
})
