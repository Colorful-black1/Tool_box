import { describe, expect, it } from 'vitest'
import {
  defaultPromptTemplates,
  fillPrompt,
  promptVariables,
  savePromptRevision,
  validatePromptLibrary
} from './prompt-tools'

describe('Prompt 模板定义与版本', () => {
  it('内置模板可填充，不递归执行变量内容', () => {
    const template = defaultPromptTemplates()[0]
    expect(fillPrompt(template.body, { context: '{{other}}' })).toContain('{{other}}')
    expect(promptVariables('{{内容}} {{context}} {{内容}}')).toEqual(['内容', 'context'])
    expect(() => fillPrompt(template.body, {})).toThrow('context')
  })
  it('不会读取原型上的变量', () => {
    expect(() => fillPrompt('{{toString}}', {})).toThrow('toString')
  })
  it('新增不产生历史，修改保存旧版本，最多保留六份', () => {
    let template = savePromptRevision(
      undefined,
      { id: 'test', title: ' 测试 ', body: '{{context}}' },
      1
    )
    expect(template.versions).toEqual([])
    expect(savePromptRevision(template, template, 2)).toBe(template)
    for (let i = 0; i < 8; i++)
      template = savePromptRevision(template, { ...template, body: 'version ' + i }, i + 2)
    expect(template.versions).toHaveLength(6)
    expect(template.versions[0].body).toBe('version 6')
  })
  it('只保留已知字段，不持久化变量值', () => {
    const template = { ...defaultPromptTemplates()[0], values: { context: 'fixture-content' } }
    expect(validatePromptLibrary([template])[0]).not.toHaveProperty('values')
  })
  it.each([
    null,
    {},
    [null],
    [{ ...defaultPromptTemplates()[0], id: '__proto__', versions: 'bad' }],
    [{ ...defaultPromptTemplates()[0], body: 'x'.repeat(12001) }]
  ])('拒绝损坏的库 %j', (raw) => {
    expect(() => validatePromptLibrary(raw)).toThrow()
  })
  it('拒绝稀疏数组，避免保存后出现无法加载的空版本', () => {
    expect(() => validatePromptLibrary(Array(1))).toThrow()
    expect(() =>
      validatePromptLibrary([{ ...defaultPromptTemplates()[0], versions: Array(1) }])
    ).toThrow()
  })
  it('限制模板数量、标识唯一性、版本时间和总量', () => {
    const template = defaultPromptTemplates()[0]
    expect(() => validatePromptLibrary(Array(21).fill(template))).toThrow()
    expect(() => validatePromptLibrary([template, template])).toThrow('重复')
    expect(() => validatePromptLibrary([{ ...template, updatedAtMs: NaN }])).toThrow()
    expect(() =>
      validatePromptLibrary(
        Array.from({ length: 20 }, (_, i) => ({
          ...template,
          id: String(i),
          body: 'x'.repeat(10000)
        }))
      )
    ).toThrow('总量')
  })
  it('限制变量数与填充后的长度', () => {
    expect(() =>
      promptVariables(Array.from({ length: 13 }, (_, i) => '{{v' + i + '}}').join(''))
    ).toThrow('12')
    expect(() => fillPrompt('{{context}}', { context: 'x'.repeat(200001) })).toThrow('过长')
  })
})
