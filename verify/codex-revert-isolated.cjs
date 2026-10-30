/** 真实 CLI + 独立 CODEX_HOME + 本机确定性模型桩；不访问账号、外部模型或用户会话。 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { setTimeout: delay } = require('node:timers/promises')
const { Module } = require('node:module')
const { buildSync } = require('esbuild')

async function main() {
  const executable = process.argv[2]
  assert.ok(executable && path.isAbsolute(executable), '需要明确的本机原生 CLI 绝对路径')
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'toolbox-revert-isolated-'))
  const home = path.join(temporary, 'home')
  const project = path.join(temporary, 'project')
  await fs.mkdir(home)
  await fs.mkdir(project)
  await fs.writeFile(path.join(project, 'sentinel.txt'), '文件必须保留')
  const bodies = []
  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      if (request.url !== '/v1/responses') {
        response.writeHead(404).end()
        return
      }
      bodies.push(JSON.parse(body))
      const id = `fixture-${bodies.length}`
      const item = {
        id: `message-${bodies.length}`,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: '本机合成答复', annotations: [] }]
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' })
      for (const event of [
        { type: 'response.created', response: { id, status: 'in_progress', output: [] } },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { ...item, status: 'in_progress', content: [] }
        },
        {
          type: 'response.output_text.delta',
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: '本机合成答复'
        },
        { type: 'response.output_item.done', output_index: 0, item },
        {
          type: 'response.completed',
          response: {
            id,
            status: 'completed',
            output: [item],
            usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 }
          }
        }
      ])
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      response.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await fs.writeFile(
    path.join(home, 'config.toml'),
    `model = "gpt-5.2-codex"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`
  )
  process.env.CODEX_HOME = home
  for (const key of Object.keys(process.env))
    if (/API_KEY|TOKEN|SECRET|PASSWORD/.test(key)) delete process.env[key]
  const root = path.resolve(__dirname, '..')
  const bundle = buildSync({
    entryPoints: [path.join(root, 'src/main/services/coding-agents/codex-adapter.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false
  })
  const compiled = new Module(path.join(root, 'verify/isolated-codex-adapter.cjs'))
  compiled.paths = module.paths
  compiled._compile(bundle.outputFiles[0].text, compiled.id)
  let config = { codex: { executablePath: executable, directory: project } }
  const adapter = new compiled.exports.CodexAdapter({
    configGet: () => config,
    configSet: (patch) => {
      config = { ...config, ...patch }
    }
  })
  let latest
  adapter.subscribe((event) => {
    if (event.kind === 'session') latest = event.session
  })
  const send = async (id, text) => {
    await adapter.send(id, text)
    const deadline = Date.now() + 20000
    while ((!latest || latest.status === 'running') && Date.now() < deadline) await delay(30)
    assert.equal(latest.outcome, 'completed', latest.error || '隔离任务未完成')
  }
  try {
    const info = await adapter.connect(project)
    const session = await adapter.openSession()
    assert.equal(session.canRevert, true, '本机未提供分页回退能力')
    await send(session.id, 'RETAIN_FIRST_FIXTURE')
    await send(session.id, 'REMOVE_SECOND_FIXTURE')
    await fs.writeFile(path.join(project, 'sentinel.txt'), '第二轮结束后修改的文件必须保留')
    const user = latest.messages.filter((message) => message.role === 'user').at(-1)
    const preview = await adapter.previewRevert(session.id, user.id)
    assert.equal(preview.affectedTurns, 1)
    const reverted = await adapter.revert(session.id, preview)
    assert.equal(
      reverted.messages.some((message) => message.content.includes('REMOVE_SECOND_FIXTURE')),
      false
    )
    assert.equal(
      reverted.messages.some((message) => message.content.includes('RETAIN_FIRST_FIXTURE')),
      true
    )
    await send(session.id, 'NEW_AFTER_REVERT_FIXTURE')
    const context = JSON.stringify(bodies.at(-1).input)
    assert.equal(context.includes('REMOVE_SECOND_FIXTURE'), false)
    assert.equal(context.includes('RETAIN_FIRST_FIXTURE'), true)
    assert.equal(
      await fs.readFile(path.join(project, 'sentinel.txt'), 'utf8'),
      '第二轮结束后修改的文件必须保留'
    )
    const reloaded = await adapter.openSession(session.id)
    assert.equal(
      reloaded.messages.some((message) => message.content.includes('NEW_AFTER_REVERT_FIXTURE')),
      true
    )
    process.stdout.write(
      `PASS Codex ${info.version} 原生回退、模型上下文排除、文件保留和历史回读；仅本机模型桩\n`
    )
  } finally {
    adapter.disconnect()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    // 保留独立临时数据供排查；不删除用户文件，也不接触真实 CODEX_HOME。
  }
}
main().catch((error) => {
  process.stderr.write(`隔离原生回退检查失败：${error.message}\n`)
  process.exitCode = 1
})
