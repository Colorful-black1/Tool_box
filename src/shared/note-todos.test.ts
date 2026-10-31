import { describe, expect, it } from 'vitest'
import { planNoteTodos } from './note-todos'

describe('planNoteTodos', () => {
  it('按顺序取出未完成清单项，忽略已办与普通列表', () => {
    const content = [
      '# 下周计划',
      '- [ ] 修 ABI 构建',
      '- [x] 已经做完的',
      '- 普通列表项',
      '* [ ] 补单测',
      '+ [ ] 写周报'
    ].join('\n')
    expect(planNoteTodos(content)).toEqual({
      items: ['修 ABI 构建', '补单测', '写周报'],
      skipped: 0,
      overflow: 0
    })
  })

  it('缩进清单项同样生效，连续空白折叠成一个空格', () => {
    const content = '  - [ ]   去   银行\n\t- [ ] 取快递  '
    expect(planNoteTodos(content).items).toEqual(['去 银行', '取快递'])
  })

  it('同一段笔记里重复的清单项只算一次', () => {
    const content = '- [ ] 取快递\n- [ ] 取快递\n- [ ]  取快递 '
    expect(planNoteTodos(content).items).toEqual(['取快递'])
  })

  it('已有同名待办时跳过并计数，比较忽略大小写与首尾空白', () => {
    const content = '- [ ] 取快递\n- [ ] 修 ABI'
    expect(planNoteTodos(content, [' 取快递 ', 'Fix Build'])).toEqual({
      items: ['修 ABI'],
      skipped: 1,
      overflow: 0
    })
    expect(planNoteTodos('- [ ] Fix Build', ['fix build']).skipped).toBe(1)
  })

  it('超过单次上限的部分计入 overflow', () => {
    const content = Array.from({ length: 55 }, (_, index) => `- [ ] 事项 ${index + 1}`).join('\n')
    const plan = planNoteTodos(content)
    expect(plan.items).toHaveLength(50)
    expect(plan.items[49]).toBe('事项 50')
    expect(plan.overflow).toBe(5)
  })

  it('没有清单项时返回空计划', () => {
    expect(planNoteTodos('只有正文，没有清单')).toEqual({ items: [], skipped: 0, overflow: 0 })
  })
})
