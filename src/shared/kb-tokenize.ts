/**
 * 知识库分词：中文二元组 + 拉丁词。
 *
 * FTS5 的 unicode61 把连续中文当成一个 token，两字查询（"部署"）
 * 无法命中"部署失败"；因此写入时把中文切成相邻二字组合，
 * 查询走同一套规则。拉丁词按空白与标点切分、统一小写。
 *
 * 纯函数：主进程写入索引与检索共用，单测不需要 SQLite。
 */

const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3400, 0x4dbf], // 扩展 A
  [0x4e00, 0x9fff], // 基本区
  [0xf900, 0xfaff], // 兼容表意文字
  [0x3040, 0x30ff], // 日文假名
  [0xac00, 0xd7af] // 韩文音节
]

/** 单个查询最多展开的 token 数，防止一句话撑爆 FTS 表达式。 */
const MAX_QUERY_TOKENS = 48

export function isCjkCodePoint(code: number): boolean {
  return CJK_RANGES.some(([from, to]) => code >= from && code <= to)
}

function isWordCodePoint(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x5f ||
    (code >= 0x41 && code <= 0x5a)
  )
}

/** 索引字段：`heading + 正文` 一起分词，命中标题也能召回该块。 */
export function tokenizeForIndex(text: string): string {
  return tokenize(text, false).join(' ')
}

/**
 * 查询词：去重、保序，单字中文保留，单字符拉丁词丢弃（噪音太大）。
 */
export function tokenizeQuery(text: string): string[] {
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const token of tokenize(text, true)) {
    if (seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
    if (tokens.length >= MAX_QUERY_TOKENS) break
  }
  return tokens
}

/** 查询是单个中文汉字时，二元组索引无法覆盖，交给 LIKE 兜底。 */
export function isSingleCjkChar(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length === 1 && isCjkCodePoint(trimmed.codePointAt(0) ?? 0)
}

/**
 * FTS5 表达式：token 全部用双引号包裹，再以 OR 连接。
 *
 * OR 而非 AND：长问题里只要有一个二元组命中就应先召回，
 * 让 BM25 把命中更多词的块排前面，避免"少一个词就彻底没结果"。
 */
export function buildMatchExpression(tokens: readonly string[]): string {
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ')
}

function tokenize(text: string, forQuery: boolean): string[] {
  const tokens: string[] = []
  let latin = ''
  let cjk: string[] = []

  const flushLatin = (): void => {
    if (latin.length >= 2) tokens.push(latin)
    else if (!forQuery && latin.length === 1) tokens.push(latin)
    latin = ''
  }

  const flushCjk = (): void => {
    if (cjk.length === 1) tokens.push(cjk[0])
    else {
      for (let index = 0; index + 1 < cjk.length; index += 1) {
        tokens.push(`${cjk[index]}${cjk[index + 1]}`)
      }
    }
    cjk = []
  }

  for (const char of text.toLowerCase()) {
    const code = char.codePointAt(0) ?? 0
    if (isCjkCodePoint(code)) {
      flushLatin()
      cjk.push(char)
      continue
    }
    if (isWordCodePoint(code)) {
      flushCjk()
      latin += char
      continue
    }
    flushLatin()
    flushCjk()
  }
  flushLatin()
  flushCjk()
  return tokens
}
