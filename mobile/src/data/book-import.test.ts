import { describe, expect, it } from 'vitest'

import { MAX_BOOK_BYTES, UnsupportedTextEncodingError } from './text-decoder'
import { buildImportedBook, extractTitle } from './book-import'

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * 正文必须够长：`parseChapters` 的 `mergeTinyChapters` 会把正文少于
 * 12 字的章节并进上一章，测试里用「雨下了整夜。」这种短句会被合并掉。
 */
const BODY_1 = '他推开门，风从走廊尽头灌进来，卷起地上的旧报纸。'
const BODY_2 = '雨下了整夜，屋檐的水线一直没有断过。'

const NOVEL = `第一章 起点
${BODY_1}

第二章 转折
${BODY_2}`

describe('extractTitle', () => {
  it('去掉目录与扩展名', () => {
    expect(extractTitle('/storage/emulated/0/Download/三体.txt')).toBe('三体')
    expect(extractTitle('C:\\books\\活着.txt')).toBe('活着')
  })

  it('无扩展名时整名保留', () => {
    expect(extractTitle('novel')).toBe('novel')
  })

  // 与桌面端 `ImportService.extractFileName` 同规则：dot > 0 才算扩展名分隔符，
  // 因此隐藏文件（点开头）会整名保留，这里刻意保持两端一致。
  it('点开头的隐藏文件名整名保留（与桌面端同规则）', () => {
    expect(extractTitle('.txt')).toBe('.txt')
  })

  it('空串给占位', () => {
    expect(extractTitle('')).toBe('未命名书籍')
    expect(extractTitle('   ')).toBe('未命名书籍')
  })
})

describe('buildImportedBook', () => {
  it('按章节标题切分并抽出正文', () => {
    const book = buildImportedBook('测试.txt', utf8(NOVEL))
    expect(book.title).toBe('测试')
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters[0]).toEqual({ title: '第一章 起点', body: BODY_1 })
    expect(book.chapters[1]).toEqual({ title: '第二章 转折', body: BODY_2 })
  })

  it('正文首尾空白被裁掉', () => {
    const book = buildImportedBook('t.txt', utf8(NOVEL))
    for (const chapter of book.chapters) {
      expect(chapter.body).toBe(chapter.body.trim())
    }
  })

  // 没有章节标题时由共享的 parseChapters 兜底成单章「全文」，
  // 手机端不自己再造一套命名规则
  it('没有章节标题时整篇作为单章', () => {
    const book = buildImportedBook('散记.txt', utf8('就一段没有标题的流水账文字，写完就散。'))
    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0]?.body).toBe('就一段没有标题的流水账文字，写完就散。')
  })

  it('空文件报错', () => {
    expect(() => buildImportedBook('空.txt', new Uint8Array(0))).toThrow(/文件为空/)
  })

  it('只有空白字符报错', () => {
    expect(() => buildImportedBook('空.txt', utf8('   \n\n  '))).toThrow(/没有可读文本/)
  })

  it('GBK 文件的编码错误向上冒泡，不被吞掉', () => {
    expect(() => buildImportedBook('gbk.txt', new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toThrow(
      UnsupportedTextEncodingError
    )
  })

  it('超大文件在解析前就被拦下', () => {
    expect(() => buildImportedBook('big.txt', new Uint8Array(MAX_BOOK_BYTES + 1))).toThrow(/MB/)
  })

  // 回归：parseChapters 的偏移属于它归一后那份文本，切片必须用同一份字符串。
  // 之前只断言章节数，正好放过了「正文吞掉标题尾部并被截断」这个 bug。
  it('Windows 换行下正文不因偏移错位而串行', () => {
    const book = buildImportedBook('crlf.txt', utf8(NOVEL.replace(/\n/g, '\r\n')))
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters[0]?.body).toBe(BODY_1)
    expect(book.chapters[1]?.body).toBe(BODY_2)
  })
})
