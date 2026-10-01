import { describe, expect, it } from 'vitest'

import {
  MAX_RECOGNIZE_CHARS,
  RECOGNIZE_SYSTEM_PROMPT,
  buildRecognitionPrompt,
  extractJsonValue,
  parseRecognitionResult
} from './password-recognizer'

describe('buildRecognitionPrompt', () => {
  it('包进提示词并去掉首尾空白', () => {
    expect(buildRecognitionPrompt('  GitHub: a/b  ')).toContain('GitHub: a/b')
  })

  it('空文本报错', () => {
    expect(() => buildRecognitionPrompt('   ')).toThrow(/不能为空/)
  })

  it('超长文本截断并说明', () => {
    const prompt = buildRecognitionPrompt('x'.repeat(MAX_RECOGNIZE_CHARS + 500))
    expect(prompt).toContain('原文过长')
    expect(prompt.length).toBeLessThan(MAX_RECOGNIZE_CHARS + 200)
  })
})

describe('RECOGNIZE_SYSTEM_PROMPT', () => {
  it('要求只输出 JSON 数组并列出全部字段', () => {
    expect(RECOGNIZE_SYSTEM_PROMPT).toMatch(/JSON 数组/)
    for (const field of ['title', 'url', 'account', 'password', 'remark']) {
      expect(RECOGNIZE_SYSTEM_PROMPT).toContain(field)
    }
  })
})

describe('extractJsonValue', () => {
  it('裸 JSON 数组', () => {
    expect(extractJsonValue('[{"title":"a"}]')).toBe('[{"title":"a"}]')
  })

  it('剥掉 ```json 代码围栏', () => {
    expect(extractJsonValue('```json\n[{"title":"a"}]\n```')).toBe('[{"title":"a"}]')
  })

  it('剥掉无语言标注的围栏', () => {
    expect(extractJsonValue('```\n[1,2]\n```')).toBe('[1,2]')
  })

  it('前后有前言也能找到', () => {
    expect(extractJsonValue('识别结果如下：\n[{"title":"a"}]\n希望有用')).toBe('[{"title":"a"}]')
  })

  // 模型不按要求返回数组而返回单个对象时，也要能抠出来交给上层报「不是数组」，
  // 而不是含糊地说「没找到 JSON」
  it('顶层对象也能抠出', () => {
    expect(extractJsonValue('{"title":"a"}')).toBe('{"title":"a"}')
  })

  it('数组与对象混排时取更靠前的那个', () => {
    expect(extractJsonValue('说明 {x} 然后 [1]')).toBe('{x}')
  })

  // 关键回归：字符串里的 ']' 不能被当成数组结束
  it('字符串内的方括号不影响配对', () => {
    const json = '[{"title":"a]b","password":"p]"}]'
    expect(extractJsonValue(json)).toBe(json)
  })

  it('转义引号不破坏状态机', () => {
    const json = '[{"title":"say \\"hi\\""}]'
    expect(extractJsonValue(json)).toBe(json)
  })

  it('嵌套数组取最外层', () => {
    expect(extractJsonValue('[[1,2],[3]]')).toBe('[[1,2],[3]]')
  })

  it('嵌套对象取最外层', () => {
    expect(extractJsonValue('{"a":{"b":1}}')).toBe('{"a":{"b":1}}')
  })

  it('找不到括号返回 null', () => {
    expect(extractJsonValue('这里没有任何 JSON')).toBeNull()
  })

  it('未闭合返回 null', () => {
    expect(extractJsonValue('[{"title":"a"')).toBeNull()
    expect(extractJsonValue('{"title":"a"')).toBeNull()
  })
})

describe('parseRecognitionResult', () => {
  it('解析标准数组', () => {
    const drafts = parseRecognitionResult(
      JSON.stringify([
        { title: 'GitHub', url: 'https://github.com', account: 'octocat', password: 'p', remark: '' }
      ])
    )
    expect(drafts).toEqual([
      { title: 'GitHub', url: 'https://github.com', account: 'octocat', password: 'p', remark: '' }
    ])
  })

  it('剥围栏后再解析', () => {
    const drafts = parseRecognitionResult('```json\n[{"title":"A","password":"x"}]\n```')
    expect(drafts).toEqual([{ title: 'A', url: '', account: '', password: 'x', remark: '' }])
  })

  it('缺失字段补空串', () => {
    const drafts = parseRecognitionResult('[{"title":"A"}]')
    expect(drafts[0]).toEqual({ title: 'A', url: '', account: '', password: '', remark: '' })
  })

  it('字段值做 trim 且忽略非字符串', () => {
    const drafts = parseRecognitionResult('[{"title":"  A  ","account":123,"password":" p "}]')
    expect(drafts[0]?.title).toBe('A')
    expect(drafts[0]?.account).toBe('')
    expect(drafts[0]?.password).toBe('p')
  })

  it('只有密码没有名称时给占位名', () => {
    const drafts = parseRecognitionResult('[{"password":"p"}]')
    expect(drafts[0]?.title).toBe('未命名条目')
  })

  // 名称与密码都空的条目直接丢，避免污染密码箱
  it('名称与密码都空的条目被丢弃', () => {
    expect(parseRecognitionResult('[{"title":"","password":""},{"url":"x"}]')).toEqual([])
  })

  it('非对象元素被跳过', () => {
    expect(parseRecognitionResult('[null,"x",123,{"title":"A"}]')).toHaveLength(1)
  })

  it('空数组返回空结果（由调用方给出提示）', () => {
    expect(parseRecognitionResult('[]')).toEqual([])
  })

  it('没有 JSON 时报可读错误而不是静默返回空', () => {
    expect(() => parseRecognitionResult('模型拒绝回答了')).toThrow(/没找到 JSON/)
  })

  it('JSON 语法错误时提示重试', () => {
    expect(() => parseRecognitionResult('[{title:}]')).toThrow(/无法解析/)
  })

  it('顶层不是数组时报错', () => {
    expect(() => parseRecognitionResult('{"title":"A"}')).toThrow(/不是数组/)
  })
})
