/** 合成统计桥接，不读取真实会话、不启动原生 Agent。 */
const { setTimeout } = require('node:timers')
module.exports = function usageFixture() {
  const clients = {
    codex: 'Codex',
    opencode: 'OpenCode',
    claude: 'Claude Code',
    kimi: 'Kimi Code',
    pi: 'Pi',
    workbuddy: 'WorkBuddy',
    dsh: 'DeepSeek Harness',
    zcode: 'ZCode',
    gemini: 'Gemini CLI',
    copilot: 'GitHub Copilot',
    grok: 'Grok CLI',
    mimocode: 'MiMoCode',
    mcode: 'MCode',
    cline: 'Cline'
  }
  const calls = []
  const custom = new Set()
  let fail = false
  let delay = 0
  const day = (offset) => {
    const d = new Date()
    d.setDate(d.getDate() - offset)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const today = () => day(0)
  const project = 'E:\\合成项目\\很长的工程目录\\子模块'
  const stacked = (keys, total) => ({
    date: today(),
    total,
    clients: keys.map((client) => ({ client, total: Math.round(total / keys.length) }))
  })
  return {
    bridge: {
      async query(input) {
        calls.push({ ...input })
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
        if (fail) {
          fail = false
          throw new Error('fixture failure')
        }
        const scanKeys = Object.keys(clients).slice(0, 8)
        const keys = input.client ? [input.client] : scanKeys
        const empty = input.model === 'empty-model'
        const rows = empty
          ? []
          : keys.flatMap((client) =>
              Array.from({ length: 8 }, (_, i) => ({
                client,
                sessionId: `synthetic-${client}-${i}`,
                project,
                model: 'fixture-model',
                time: Date.now() - i * 1000,
                tokens: {
                  input: 100,
                  output: 50,
                  cacheRead: 500,
                  cacheWrite: null,
                  reasoning: 10,
                  total: 650
                },
                requests: 1,
                costUsd: client === 'opencode' ? 0.02 : null,
                costPartial: false,
                partial: false
              }))
            )
        const tokens = {
          input: rows.length * 100,
          output: rows.length * 50,
          cacheRead: rows.length * 500,
          cacheWrite: null,
          reasoning: rows.length * 10,
          total: rows.length * 650
        }
        const limit = input.limit ?? 50
        const offset = input.offset ?? 0
        return {
          scannedAt: Date.now(),
          tokens,
          cost: rows.length
            ? { usd: 0.16, reported: 8, total: rows.length }
            : { usd: null, reported: 0, total: 0 },
          requests: rows.length,
          sessions: rows.length,
          partial: false,
          unknownTime: 1,
          sources: Object.keys(clients).map((client) => ({
            client,
            paths: [
              custom.has(client) ? 'E:\\自定义会话目录' : `C:\\Users\\fixture\\.${client}\\sessions`
            ],
            custom: custom.has(client),
            status: scanKeys.includes(client) ? 'ready' : 'missing',
            detail: scanKeys.includes(client) ? '已读取本地用量' : '未找到本地记录',
            records: scanKeys.includes(client) ? 8 : 0,
            durationMs: 12
          })),
          projects: [project],
          models: ['fixture-model', 'empty-model'],
          byClient: empty
            ? []
            : keys.map((client) => ({
                client,
                tokens: { ...tokens, total: 5200 },
                costUsd: client === 'opencode' ? 0.16 : null
              })),
          byModel: empty
            ? []
            : [
                {
                  key: 'fixture-model',
                  tokens,
                  costUsd: 0.16,
                  costPartial: true,
                  requests: rows.length,
                  sessions: rows.length
                }
              ],
          byProject: empty
            ? []
            : [
                {
                  key: project,
                  tokens,
                  costUsd: 0.16,
                  costPartial: true,
                  requests: rows.length,
                  sessions: rows.length
                }
              ],
          daily: empty ? [] : [stacked(keys, tokens.total)],
          trend: empty
            ? []
            : [
                { ...stacked(keys, tokens.total / 2), date: day(2) },
                { ...stacked(keys, tokens.total / 3), date: day(1) },
                stacked(keys, tokens.total)
              ],
          rows: rows.slice(offset, offset + limit),
          rowCount: rows.length
        }
      },
      async chooseSource(client) {
        custom.add(client)
        return true
      },
      async resetSource(client) {
        custom.delete(client)
      }
    },
    controls: {
      usageCalls: () => calls,
      usageFailNext: () => {
        fail = true
      },
      usageDelay: (value) => {
        delay = value
      }
    }
  }
}
