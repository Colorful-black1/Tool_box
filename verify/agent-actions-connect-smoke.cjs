/** 无模型探针：仅连接和读取目录，不创建 / 恢复会话，不加载新增扩展配置。 */
const { Module } = require('node:module')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')

async function main() {
  const root = path.resolve(__dirname, '..')
  const source = buildSync({
    stdin: {
      contents: `
        export { CodexAdapter } from './src/main/services/coding-agents/codex-adapter'
        export { ClaudeAdapter } from './src/main/services/coding-agents/claude-adapter'
        export { DshAdapter } from './src/main/services/coding-agents/dsh-adapter'
        export { OpenCodeService } from './src/main/services/opencode/opencode-service'
        export { OpenCodeAdapter } from './src/main/services/coding-agents/opencode-adapter'
        export { OpenCodeError } from './src/main/services/opencode/opencode-error'
        export { CodingAgentError } from './src/main/services/coding-agents/adapter'
      `,
      resolveDir: root
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['@anthropic-ai/claude-agent-sdk']
  })
  const compiled = new Module(path.join(root, 'verify/agent-actions-probe.cjs'))
  compiled.paths = module.paths
  compiled._compile(source.outputFiles[0].text, compiled.id)
  const api = compiled.exports
  const names = process.argv.slice(2)
  const runtimes = names.length ? names : ['opencode', 'codex', 'claude', 'dsh']
  for (const name of runtimes) {
    let config = {}
    const store = {
      configGet: () => config,
      configSet: (patch) => {
        config = { ...config, ...patch }
      }
    }
    const adapter =
      name === 'opencode'
        ? new api.OpenCodeAdapter(new api.OpenCodeService(store))
        : name === 'codex'
          ? new api.CodexAdapter(store)
          : name === 'claude'
            ? new api.ClaudeAdapter(store)
            : new api.DshAdapter(store)
    let sessions = 0
    adapter.subscribe((event) => {
      if (event.kind === 'session') sessions++
    })
    try {
      const info = await adapter.connect(root)
      const before = await adapter.listSessions()
      const catalog = await adapter.catalog()
      assert.equal(sessions, 0)
      assert.deepEqual(
        (await adapter.listSessions()).map((item) => item.id).sort(),
        before.map((item) => item.id).sort()
      )
      process.stdout.write(
        JSON.stringify({
          runtime: name,
          version: info.version,
          commands: catalog.commands.length,
          compact: catalog.commands.some((item) => item.name === 'compact'),
          init: catalog.commands.some((item) => item.name === 'init'),
          skills: catalog.skills.length,
          mcp: catalog.mcp.length,
          notices: catalog.notices.length,
          sessionEvents: sessions,
          modelTasks: 0
        }) + '\n'
      )
    } catch (error) {
      // 不透传原生错误或配置内容；失败项目独立记录，继续检查其他运行时。
      process.stdout.write(
        JSON.stringify({
          runtime: name,
          result:
            error instanceof api.CodingAgentError || error instanceof api.OpenCodeError
              ? error.message
              : '连接或能力读取未通过',
          modelTasks: 0
        }) + '\n'
      )
      process.exitCode = 1
    } finally {
      adapter.disconnect()
    }
  }
}
main().catch(() => {
  process.stderr.write('能力探针未完成，未发送模型任务\n')
  process.exitCode = 1
})
