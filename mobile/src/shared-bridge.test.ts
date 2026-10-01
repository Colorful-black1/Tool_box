import { describe, expect, it } from 'vitest'

import {
  AI_PROVIDER_PRESETS,
  describeAiError,
  findAiProvider,
  isAiProviderId,
  matchProviderByBaseUrl,
  normalizeOpenAiBaseUrl,
  parseChapters,
  parsePasswordText,
  pinyinFirstLetter
} from './shared-bridge'

/**
 * 验证手机端能直接复用桌面端的纯逻辑：这些断言同时保护 shared-bridge 的导出面，
 * 桌面端若删改某个导出，这里会立刻失败，而不是等到真机运行时才发现。
 */
describe('shared-bridge 复用桌面端纯逻辑', () => {
  it('能读到供应商预设表', () => {
    expect(AI_PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(9)
    expect(findAiProvider('deepseek').baseUrl).toBe('https://api.deepseek.com/v1')
    expect(findAiProvider('opencode-go').baseUrl).toBe('https://opencode.ai/zen/go/v1')
  })

  it('供应商 id 校验与 baseUrl 反查与桌面端一致', () => {
    expect(isAiProviderId('glm')).toBe(true)
    expect(isAiProviderId('unknown-provider')).toBe(false)
    expect(matchProviderByBaseUrl('https://open.bigmodel.cn/api/paas/v4')).toBe('glm')
    expect(matchProviderByBaseUrl('https://self.hosted/v1')).toBe('custom')
  })

  it('端点规范化不会给已带版本号的路径乱加 /v1', () => {
    expect(normalizeOpenAiBaseUrl('https://api.example.com')).toBe('https://api.example.com/v1')
    expect(normalizeOpenAiBaseUrl('https://open.bigmodel.cn/api/paas/v4')).toBe(
      'https://open.bigmodel.cn/api/paas/v4'
    )
  })

  it('错误文案映射可复用', () => {
    expect(describeAiError(new Error('HTTP 401 invalid api key'))).toContain('API Key')
  })

  it('章节解析器可复用', () => {
    const first = '星穹列车驶出最后一个跃迁点，舷窗外的星光忽然安静了下来。'
    const second = '他把日志翻到最后一页，墨迹还没有干透。'
    const text = ['第一章 起点', first, '第二章 后续', second].join('\n')
    const chapters = parseChapters(text)

    expect(chapters).toHaveLength(2)
    expect(chapters[1].title).toContain('第二章')
    expect(text.slice(chapters[1].start, chapters[1].end)).toContain(second)
  })

  it('正文过短的章节会被合并（与桌面端同一套阈值）', () => {
    // 复用 parseChapters 时必须沿用既有合并规则，否则手机端会切出大量空章
    const text = ['第一章 甲', '正文一', '第二章 乙', '正文二'].join('\n')
    expect(parseChapters(text)).toHaveLength(1)
  })

  it('密码文本解析器可复用', () => {
    const { entries } = parsePasswordText('名称: 测试站\n账号: me@example.com\n密码: s3cret')
    expect(entries[0]).toMatchObject({ title: '测试站', account: 'me@example.com' })
  })

  it('拼音首字母可复用', () => {
    expect(pinyinFirstLetter('测试')).toBe('C')
  })
})
