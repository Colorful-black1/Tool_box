/**
 * 密码批量导入文本解析器（移植自 novel_read services/password_text_parser.dart）。
 *
 * 规则：
 * - 条目之间空行分隔（\n\s*\n）
 * - 行内「标签: 值」，冒号全半角均可，大小写不敏感
 * - 标签集顺序敏感：长标签在前，避免「网站名」被「网站」截断
 * - 名称缺失时依次回退 account → 「未命名条目」
 * - 无法识别的行累加到 skipped
 */

export interface ParsedPasswordEntry {
  title: string
  url: string
  account: string
  password: string
  remark: string
}

export interface ParseOutcome {
  entries: ParsedPasswordEntry[]
  skipped: number
}

/** 顺序敏感：同一目标字段的标签按长度降序排列 */
const LABEL_MAP: Array<{ labels: string[]; field: keyof ParsedPasswordEntry }> = [
  { labels: ['网站名', '网站名称', 'name', 'title', '名称', '标题', '网站'], field: 'title' },
  { labels: ['网址', 'url', 'website', 'site', '链接', '地址'], field: 'url' },
  { labels: ['用户名', '账号', '账户', 'username', 'account', 'user', 'login'], field: 'account' },
  { labels: ['password', 'passwd', 'password', '密码'], field: 'password' },
  { labels: ['remark', 'note', '备注', '说明', '描述'], field: 'remark' }
]

export function parsePasswordText(text: string): ParseOutcome {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)

  const entries: ParsedPasswordEntry[] = []
  let skipped = 0

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const entry = emptyEntry()
    let recognized = false
    let bareTitle = ''

    for (const line of lines) {
      const parsed = parseKeyValue(line)
      if (!parsed) {
        // 无标签的单行块 → 视为条目名称（兼容「淘宝」这种纯标题格式）
        if (lines.length === 1 && !recognized) {
          bareTitle = line
          continue
        }
        skipped += 1
        continue
      }

      const field = resolveField(parsed.label)
      if (!field) {
        skipped += 1
        continue
      }

      entry[field] = parsed.value
      recognized = true
    }

    if (!entry.title) entry.title = bareTitle
    if (!entry.title) entry.title = entry.account
    if (!entry.title) entry.title = '未命名条目'

    const hasAnyValue = Boolean(entry.account || entry.password || entry.url || entry.remark)
    if (recognized || bareTitle) {
      if (hasAnyValue || bareTitle) {
        entries.push(entry)
      } else {
        skipped += 1
      }
    } else {
      skipped += 1
    }
  }

  return { entries, skipped }
}

function parseKeyValue(line: string): { label: string; value: string } | null {
  const idx = findSeparator(line)
  if (idx <= 0) return null
  const label = line.slice(0, idx).trim().toLowerCase()
  if (!label) return null
  return { label, value: line.slice(idx + 1).trim() }
}

function findSeparator(line: string): number {
  const ascii = line.indexOf(':')
  const full = line.indexOf('：')
  if (ascii < 0) return full
  if (full < 0) return ascii
  return Math.min(ascii, full)
}

function resolveField(label: string): keyof ParsedPasswordEntry | null {
  const normalized = label.toLowerCase().replace(/[\s_-]/g, '')
  for (const group of LABEL_MAP) {
    for (const candidate of group.labels) {
      if (candidate.toLowerCase().replace(/[\s_-]/g, '') === normalized) {
        return group.field
      }
    }
  }
  return null
}

function emptyEntry(): ParsedPasswordEntry {
  return { title: '', url: '', account: '', password: '', remark: '' }
}