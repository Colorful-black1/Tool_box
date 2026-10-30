import { describe, expect, it } from 'vitest'
import { validateClipboardText } from './validation'

describe('剪贴板原文校验', () => {
  it('保留首尾空格、缩进、多行与空字符串', () => {
    const original = '  echo "中文"\n\tprintf \'\\n\'  \n'
    expect(validateClipboardText(original)).toBe(original)
    expect(validateClipboardText('')).toBe('')
  })
  it('拒绝非文本输入', () => {
    expect(() => validateClipboardText({ text: 'x' })).toThrow('字符串')
    expect(() => validateClipboardText(null)).toThrow('字符串')
  })
})
