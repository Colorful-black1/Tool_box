 /**
 * 密码批量导入文本解析器（移植自 novel_read 的固定格式解析）。
 * 规则：条目之间空行分隔；每行「标签: 值」；支持中英文标签与全半角冒号；
 * 无法识别的行计入 skipped。
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

const LABEL_MAP: Record<string, keyof ParsedPasswordEntry> = {
  '名称': 'title',
  '标题': 'title',
  '网站': 'url',
  '网址': 'url',
  '地址': 'url',
  '链接': 'url',
  'url': 'url',
  'site': 'url',
  '账号': 'account',
  '用户名': 'account',
  '用户': 'account',
  'account': 'account',
  'username': 'account',
  'user': 'account',
  '密码': 'password',
  'password': 'password',
  'pass': 'password',
  'pwd': 'password',
  '备注': 'remark',
  '说明': 'remark',
  'remark': 'remark',
  'note': 'remark'
}

export function parsePasswordText(text: string): ParseOutcome {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)

  const entries: ParsedPasswordEntry[] = []
  let skipped = 0

  for (const block of blocks) {
    const entry = emptyEntry()
    let recognizedAny = false

    for (const line of block.split('\n')) {
      const raw = line.trim()
      if (!raw) continue

      const parsed = parseKeyValue(raw)
      if (!parsed) {
        skipped += 1
        continue
      }

      const field = resolveField(parsed.label)
      if (!field) {
        skipped += 1
        continue
      }

      if (parsed.value || field === 'remark') {
        entry[field] = parsed.value
        recognizedAny = true
      }
    }

    if (recognizedAny && (entry.title || entry.account || entry.password)) {
      entries.push(entry)
    } else if (recognizedAny) {
      skipped += 1
    } else {
      skipped += 1
    }
  }

  return { entries, skipped }
}

function parseKeyValue(line: string): { label: string; value: string } | null {
  const separators = [':', '：']
  for (const sep of separators) {
    const idx = line.indexOf(sep)
    if (idx <= 0) continue
    const label = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + sep.length).trim()
    if (!label) continue
    return { label, value }
  }
  return null
}

function resolveField(label: string): keyof ParsedPasswordEntry | null {
  const normalized = label.toLowerCase().replace(/[\s_-]/g, '')
  const direct = LABEL_MAP[label]
  if (direct) return direct

  for (const key of Object.keys(LABEL_MAP)) {
    if (key.replace(/[\s_-]/g, '').toLowerCase() === normalized) return LABEL_MAP[key]
  }
  return null
}

function emptyEntry(): ParsedPasswordEntry {
  return { title: '', url: '', account: '', password: '', remark: '' }
}
