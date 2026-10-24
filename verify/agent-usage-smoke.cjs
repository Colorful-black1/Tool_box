/** 只读采集本机真实来源，仅输出来源状态和记录数量，不输出项目、模型、Token 数值或正文。 */
const { buildSync } = require('esbuild')
const { mkdtempSync, unlinkSync, rmdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const temporary = mkdtempSync(path.join(tmpdir(), 'toolbox-usage-smoke-'))
const output = path.join(temporary, 'usage.cjs')
const sqlite = require.resolve('better-sqlite3')
buildSync({
  entryPoints: [path.join(root, 'src/main/services/agent-usage/usage-service.ts')],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias: { 'better-sqlite3': sqlite },
  external: [sqlite]
})
const { AgentUsageService } = require(output)
async function main() {
  const service = new AgentUsageService()
  const before = Date.now()
  const report = await service.query({ refresh: true })
  for (const source of report.sources)
    process.stdout.write(`${source.client}: ${source.status}, records=${source.records}\n`)
  const cached = await service.query({})
  assert.deepEqual(cached.tokens, report.tokens)
  assert.equal(cached.rowCount, report.rowCount)
  process.stdout.write(`PASS read-only source scan and cached query (${Date.now() - before}ms)\n`)
}
main()
  .catch(() => {
    process.stderr.write('FAIL local usage scan; no source contents were printed\n')
    process.exitCode = 1
  })
  .finally(() => {
    unlinkSync(output)
    rmdirSync(temporary)
  })
