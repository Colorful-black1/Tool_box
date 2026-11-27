/**
 * AI 对话附件：限制、允许的扩展名与展示辅助。
 *
 * 主进程与渲染层共用这些常量，界面提示与主进程校验不能各写一套。
 * 实际字节校验、文本解码和图片转码仍在主进程完成。
 */

export const MAX_CHAT_ATTACHMENTS = 3
/** 单条消息所有附件原始字节合计上限。 */
export const MAX_CHAT_ATTACHMENT_TOTAL_BYTES = 30 * 1024 * 1024
export const MAX_CHAT_TEXT_ATTACHMENT_BYTES = 2 * 1024 * 1024
export const MAX_CHAT_TEXT_ATTACHMENT_CHARS = 20_000
/** 单条消息所有文本附件的内容合计上限。 */
export const MAX_CHAT_TEXT_ATTACHMENT_TOTAL_CHARS = 40_000
export const MAX_CHAT_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** 图片长边上限；超出后等比缩小。 */
export const MAX_CHAT_IMAGE_EDGE = 1600
/** 图片转码后落库上限。 */
export const MAX_CHAT_IMAGE_STORED_BYTES = 2 * 1024 * 1024
export const MAX_CHAT_ATTACHMENT_NAME_CHARS = 120
export const MAX_CHAT_ATTACHMENT_PATH_CHARS = 1024

export const CHAT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'] as const

/** 允许作为文本读取的扩展名，不在此列表的文件按二进制拒绝。 */
export const CHAT_TEXT_ATTACHMENT_EXTENSIONS = [
  'txt',
  'text',
  'md',
  'markdown',
  'mdx',
  'json',
  'jsonc',
  'json5',
  'csv',
  'tsv',
  'log',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'properties',
  'env',
  'sql',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'java',
  'go',
  'rs',
  'c',
  'h',
  'cpp',
  'cc',
  'hpp',
  'cs',
  'php',
  'rb',
  'swift',
  'kt',
  'kts',
  'sh',
  'bash',
  'zsh',
  'fish',
  'bat',
  'cmd',
  'ps1',
  'css',
  'scss',
  'less',
  'html',
  'htm',
  'vue',
  'svelte',
  'gradle',
  'groovy',
  'lua',
  'r',
  'dart',
  'ex',
  'exs',
  'erl',
  'hrl',
  'scala',
  'clj',
  'cljs',
  'tex',
  'diff',
  'patch'
] as const

/** 没有扩展名但也应允许读取的常见开发文件。 */
export const CHAT_TEXT_ATTACHMENT_NAMES = [
  'dockerfile',
  'makefile',
  'procfile',
  'gemfile',
  'rakefile',
  'vagrantfile',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.prettierrc',
  '.eslintrc',
  '.env'
] as const

export const CHAT_ATTACHMENT_ACCEPT = [
  ...CHAT_IMAGE_MIME_TYPES,
  ...CHAT_TEXT_ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`),
  ...CHAT_TEXT_ATTACHMENT_NAMES.filter((name) => name.startsWith('.')),
  'text/*'
].join(',')

/** 按名称判断文本附件；MIME 只作兜底，不能只信渲染层传来的类型。 */
export function isChatTextAttachment(name: string, mime = ''): boolean {
  const lower = name.trim().toLowerCase()
  if (CHAT_TEXT_ATTACHMENT_NAMES.includes(lower as (typeof CHAT_TEXT_ATTACHMENT_NAMES)[number])) {
    return true
  }
  const dot = lower.lastIndexOf('.')
  if (dot > 0 && dot < lower.length - 1) {
    // 有扩展名时只信白名单；application/pdf 或未知扩展名不能被 text/* 放行。
    const extension = lower.slice(dot + 1)
    return CHAT_TEXT_ATTACHMENT_EXTENSIONS.includes(
      extension as (typeof CHAT_TEXT_ATTACHMENT_EXTENSIONS)[number]
    )
  }
  return mime.toLowerCase().startsWith('text/')
}

export function isChatImageMime(mime: string): boolean {
  return CHAT_IMAGE_MIME_TYPES.includes(
    mime.toLowerCase() as (typeof CHAT_IMAGE_MIME_TYPES)[number]
  )
}

/** 浏览器有些文件类型为空；按扩展名补出受支持的图片 MIME。 */
export function guessChatImageMime(name: string, mime = ''): string | null {
  const lowerMime = mime.trim().toLowerCase()
  if (isChatImageMime(lowerMime)) return lowerMime
  const lower = name.trim().toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  return null
}

/** 界面展示用；主进程只信任自己计算出的字节数。 */
export function formatChatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
