/** 从流式 JSON 数组中提取已闭合的对象；只供预览，最终仍须完整解析校验。 */
export class JsonArrayObjectStream {
  private text = ''
  private depth = 0
  private start = -1
  private quoted = false
  private escaped = false
  private started = false
  private ended = false

  push(delta: string): string[] {
    if (this.text.length + delta.length > 200_000) throw new Error('AI 输出过长，请拆分后重试')
    const offset = this.text.length
    this.text += delta
    const objects: string[] = []
    for (let index = offset; index < this.text.length && !this.ended; index++) {
      const char = this.text[index]
      if (!this.started) {
        if (char === '[') this.started = true
        continue
      }
      if (this.quoted) {
        if (this.escaped) this.escaped = false
        else if (char === '\\') this.escaped = true
        else if (char === '"') this.quoted = false
        continue
      }
      if (char === '"') this.quoted = true
      else if (char === '{' || char === '[') {
        if (this.depth === 0 && char === '{') this.start = index
        this.depth++
      } else if (char === '}' || char === ']') {
        if (this.depth === 0) {
          this.ended = true
          continue
        }
        this.depth--
        if (this.depth === 0 && char === '}' && this.start >= 0) {
          objects.push(this.text.slice(this.start, index + 1))
          this.start = -1
        }
      }
    }
    return objects
  }
}

/** 原始密码只用于最终导入草稿；流式预览白名单不包含密码与备注。 */
export function passwordPreview(draft: {
  title: string
  account: string
  url: string
  password: string
}): { title: string; account: string; url: string; hasPassword: boolean } {
  return {
    title: draft.title,
    account: draft.account,
    url: draft.url,
    hasPassword: Boolean(draft.password)
  }
}
