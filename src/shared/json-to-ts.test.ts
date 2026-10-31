import { describe, expect, it } from 'vitest'

import { generateTypeScriptTypes } from './json-to-ts'

describe('generateTypeScriptTypes', () => {
  it('对象生成 interface，嵌套对象与数组合并到同一份输出', () => {
    expect(
      generateTypeScriptTypes(
        '{"id": 1, "name": "星轨", "tags": ["a", "b"], "owner": {"id": 2, "email": "x@y.z"}, "deletedAt": null}'
      )
    ).toBe(
      [
        'export interface Root {',
        '  id: number',
        '  name: string',
        '  tags: string[]',
        '  owner: Owner',
        '  deletedAt: null',
        '}',
        '',
        'export interface Owner {',
        '  id: number',
        '  email: string',
        '}'
      ].join('\n')
    )
  })

  it('根是数组时输出 type 与元素接口', () => {
    expect(generateTypeScriptTypes('[{"id": 1, "ok": true}, {"id": 2, "ok": false}]')).toBe(
      [
        'export type Root = RootItem[]',
        '',
        'export interface RootItem {',
        '  id: number',
        '  ok: boolean',
        '}'
      ].join('\n')
    )
  })

  it('数组里字段不一致的对象合并成一个接口，缺失字段标可选', () => {
    expect(generateTypeScriptTypes('[{"id": 1}, {"id": 2, "ok": true}]')).toBe(
      [
        'export type Root = RootItem[]',
        '',
        'export interface RootItem {',
        '  id: number',
        '  ok?: boolean',
        '}'
      ].join('\n')
    )
    expect(generateTypeScriptTypes('[{"v": 1}, {"v": "a"}]')).toBe(
      [
        'export type Root = RootItem[]',
        '',
        'export interface RootItem {',
        '  v: (number | string)',
        '}'
      ].join('\n')
    )
    // 空数组不该把已知的 string[] 冲淡成 unknown[]
    expect(generateTypeScriptTypes('[{"tags": ["a"]}, {"tags": []}]')).toBe(
      [
        'export type Root = RootItem[]',
        '',
        'export interface RootItem {',
        '  tags: string[]',
        '}'
      ].join('\n')
    )
  })

  it('同形状的对象复用同一个接口', () => {
    const output = generateTypeScriptTypes(
      '{"first": {"id": 1}, "second": {"id": 2}, "list": [{"id": 3}]}'
    )
    expect(output.match(/export interface/g)).toHaveLength(2)
    expect(output).toContain('  first: First')
    expect(output).toContain('  second: First')
    expect(output).toContain('  list: First[]')
  })

  it('空对象与空数组用宽松类型，混合数组用联合类型', () => {
    expect(generateTypeScriptTypes('{"meta": {}, "rows": [], "mixed": [1, "a"]}')).toBe(
      [
        'export interface Root {',
        '  meta: Record<string, unknown>',
        '  rows: unknown[]',
        '  mixed: (number | string)[]',
        '}'
      ].join('\n')
    )
  })

  it('非法标识符字段加引号，数字键名不会生成非法接口名', () => {
    expect(generateTypeScriptTypes('{"x-id": 1, "2fa": {"enabled": true}}')).toBe(
      [
        'export interface Root {',
        '  "x-id": number',
        '  "2fa": T2fa',
        '}',
        '',
        'export interface T2fa {',
        '  enabled: boolean',
        '}'
      ].join('\n')
    )
  })

  it('大整数仍按 number 输出，非法 JSON 抛出带位置的错误', () => {
    expect(generateTypeScriptTypes('{"id": 12345678901234567890}')).toBe(
      ['export interface Root {', '  id: number', '}'].join('\n')
    )
    expect(() => generateTypeScriptTypes('{"id": }')).toThrow(/第 1 行/)
  })
})
