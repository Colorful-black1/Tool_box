import { describe, expect, it } from 'vitest'
import type { ToolGroup } from './registry'
import { filterToolGroups, moveTool, orderToolGroups, readToolOrder } from './tool-navigation'

const render = (): never => {
  throw new Error('导航测试不渲染工具面板')
}
const groups: ToolGroup[] = [
  {
    id: 'dev',
    name: '开发者工具',
    description: '',
    tools: [
      { id: 'json', name: 'JSON 工具箱', description: '无损格式化与大整数', render },
      { id: 'diff', name: '差异比较', description: 'JSON 字段对比', render },
      { id: 'uuid', name: 'UUID 生成器', description: '批量生成', render }
    ]
  }
]

describe('工具搜索与顺序', () => {
  it('名称、描述、英文 id 均可匹配，忽略大小写与全半角', () => {
    expect(
      filterToolGroups(groups, 'ＪＳＯＮ')
        .flatMap((g) => g.tools)
        .map((t) => t.id)
    ).toEqual(['json', 'diff'])
    expect(filterToolGroups(groups, '大整数')[0].tools[0].id).toBe('json')
    expect(filterToolGroups(groups, 'diff')[0].tools[0].name).toBe('差异比较')
  })
  it('多词同时匹配；空白不筛选，无结果不会更改来源', () => {
    expect(filterToolGroups(groups, 'json 字段')[0].tools.map((t) => t.id)).toEqual(['diff'])
    expect(filterToolGroups(groups, '   ')).toBe(groups)
    expect(filterToolGroups(groups, '不存在')).toEqual([])
    expect(groups[0].tools).toHaveLength(3)
  })
  it('损坏、重复和过期 id 不影响目录，新增工具追加', () => {
    expect(readToolOrder(null)).toEqual([])
    expect(readToolOrder(['uuid', 1, 'uuid', '__proto__', 'gone'])).toEqual(['uuid', 'gone'])
    expect(orderToolGroups(groups, ['gone', 'uuid', 'uuid'])[0].tools.map((t) => t.id)).toEqual([
      'uuid',
      'json',
      'diff'
    ])
  })
  it('排序保留分组归属，并让搜索结果沿用顺序', () => {
    const ordered = orderToolGroups(groups, ['diff', 'json'])
    expect(filterToolGroups(ordered, 'json')[0].tools.map((t) => t.id)).toEqual(['diff', 'json'])
    const extra: ToolGroup = {
      id: 'other',
      name: '其他',
      description: '',
      tools: [groups[0].tools[2]]
    }
    expect(orderToolGroups([groups[0], extra], ['uuid'])[1].tools[0].id).toBe('uuid')
  })
  it('可在目标前后插入，来源数组不变，非法移动不改变顺序', () => {
    const order = ['json', 'diff', 'uuid']
    expect(moveTool(order, 'uuid', 'json', 'before')).toEqual(['uuid', 'json', 'diff'])
    expect(moveTool(order, 'json', 'diff', 'after')).toEqual(['diff', 'json', 'uuid'])
    expect(order).toEqual(['json', 'diff', 'uuid'])
    expect(moveTool(order, 'gone', 'json', 'before')).toBe(order)
    expect(moveTool(order, 'json', 'json', 'after')).toBe(order)
  })
})
