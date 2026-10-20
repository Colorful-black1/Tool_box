/**
 * 记事本导入的纯逻辑（手机端）。
 *
 * 只放「文件名 → 笔记标题」这类能脱离 RN 测的部分；
 * 读文件那一步复用 `data/text-file.ts`。
 */

/** 去掉的扩展名（导入的笔记基本都是 Markdown） */
const NOTE_EXTENSIONS = ['.md', '.markdown', '.txt']

/**
 * 从文件名推出笔记标题。
 *
 * - `读书笔记.md` → `读书笔记`
 * - `2026-10-20 会议纪要.MARKDOWN` → `2026-10-20 会议纪要`
 * - 没有扩展名就原样返回；空名返回空串（由调用方决定兜底文案）
 */
export function noteTitleFromFileName(fileName: string): string {
  const trimmed = fileName.trim()
  if (!trimmed) return ''
  const lower = trimmed.toLowerCase()
  for (const extension of NOTE_EXTENSIONS) {
    if (lower.endsWith(extension)) return trimmed.slice(0, -extension.length).trim()
  }
  return trimmed
}
