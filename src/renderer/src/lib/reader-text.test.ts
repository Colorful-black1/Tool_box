import { describe, expect, it } from 'vitest'

import { splitReaderParagraphs } from './reader-text'

describe('splitReaderParagraphs', () => {
  it('按换行拆段并去掉 TXT 自带的全角缩进', () => {
    expect(splitReaderParagraphs('第一段。\n\u3000\u3000第二段。\n\n\u3000\u3000第三段。')).toEqual(
      ['第一段。', '第二段。', '第三段。']
    )
  })

  it('合并被硬换行拆开的段落', () => {
    expect(splitReaderParagraphs('第一行没有结束\n接着第二行。\n下一段。')).toEqual([
      '第一行没有结束接着第二行。',
      '下一段。'
    ])
  })

  it('保留对话结尾的引号，不把两段并成一段', () => {
    expect(splitReaderParagraphs('\u3000\u3000“该你了。”\n\u3000\u3000“好。”')).toEqual([
      '“该你了。”',
      '“好。”'
    ])
  })

  it('空行始终切断段落，即使上一行没有句末标点', () => {
    expect(splitReaderParagraphs('前半句\n\n后半句。')).toEqual(['前半句', '后半句。'])
  })

  it('兼容 CRLF 与英文硬换行', () => {
    expect(splitReaderParagraphs('hello\r\nworld.\r\n\r\nnext line.')).toEqual([
      'hello world.',
      'next line.'
    ])
  })

  it('没有正文时返回空数组', () => {
    expect(splitReaderParagraphs(' \n\u3000\u3000\n')).toEqual([])
  })
})
