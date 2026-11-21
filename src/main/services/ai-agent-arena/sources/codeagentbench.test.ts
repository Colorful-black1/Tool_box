import { describe, expect, it } from 'vitest'
import { parseCodeAgentBench } from './codeagentbench'

const html = `
<table><tbody>
  <tr data-agent="opencode" data-agent-label="OpenCode" data-agent-version="opencode-cli 1.17.8"
      data-rank="1" data-model-name="GLM 5.2" data-model-dir="opencode-glm52"
      data-final-score="37.587694782281474" data-pass-at-3-rate="0.37748344370860926"
      data-pass-3-rate="0.23841059602649006" data-attempt-score="0.3090507726269316"
      data-total-tokens="1400000" data-exported-at="2026-06-18T14:20:56.733872Z">
    <td>1</td>
  </tr>
  <tr data-agent="codex" data-agent-label="Codex &amp; CLI" data-agent-version="codex-cli 0.135.0"
      data-rank="2" data-model-name="GPT 5.5" data-model-dir="codex-gpt55"
      data-final-score="36.88" data-pass-at-3-rate="0.3377" data-pass-3-rate="0.2649"
      data-attempt-score="0.3002" data-total-tokens="1465217451" data-exported-at="2026-06-03T14:20:56.733872Z">
    <td>2</td>
  </tr>
</tbody></table>`

describe('CodeAgentBench 解析', () => {
  it('解析官方 data 属性并转换比例', () => {
    const board = parseCodeAgentBench(html)
    expect(board.entries).toHaveLength(2)
    expect(board.entries[0]).toMatchObject({
      agentName: 'OpenCode',
      agentVersion: 'opencode-cli 1.17.8',
      modelName: 'GLM 5.2',
      sourceRank: 1
    })
    expect(board.entries[0].values).toMatchObject({
      finalScore: 37.587694782281474,
      passAt3: 37.74834437086093,
      passHat3: 23.841059602649008,
      attemptScore: 30.90507726269316,
      tokens: 1400000
    })
    expect(board.entries[1].agentName).toBe('Codex & CLI')
    expect(board.capturedAt).toBe('2026-06-18T14:20:56.733872Z')
    expect(board.primaryMetric).toBe('finalScore')
  })

  it('空页面明确报错', () => {
    expect(() => parseCodeAgentBench('<table></table>')).toThrow('没有可解析')
  })
})
