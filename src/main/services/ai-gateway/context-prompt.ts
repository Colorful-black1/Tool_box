import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 与 assets/prompts/agent_system.txt 同目录 */
const SUMMARY_PROMPT_FILE = 'context_summary.txt'

/**
 * 检查点前缀：明确告诉模型这是已发生的背景，不是新的用户指令。
 * 用 HumanMessage 而不是 SystemMessage，避免摘要获得系统级指令权。
 */
export const CHECKPOINT_PREAMBLE =
  '这是系统自动生成的对话检查点，用于在释放上下文空间的同时保留此前进展。' +
  '请把它当作已经发生的背景，不要复述或确认这份摘要，直接继续后续对话。'

const FALLBACK_SUMMARY_PROMPT =
  '把上面的对话压缩成结构化检查点，覆盖用户目标、已完成事项、关键事实、' +
  '涉及的对象与标识、未完成事项和重要约束。只输出检查点正文。'

const promptCache = new Map<string, string>()

/** 读取摘要提示词；文件缺失时退回内置版本，不让阅读失败阻断压缩 */
export function loadSummaryPrompt(promptDir: string): string {
  const cached = promptCache.get(promptDir)
  if (cached !== undefined) return cached

  let prompt = FALLBACK_SUMMARY_PROMPT
  try {
    const text = readFileSync(join(promptDir, SUMMARY_PROMPT_FILE), 'utf8').trim()
    if (text) prompt = text
  } catch {
    // 资源缺失只影响摘要质量，不影响本次压缩流程
  }
  promptCache.set(promptDir, prompt)
  return prompt
}

/** 把检查点摘要包成发给对话模型的 HumanMessage 正文 */
export function checkpointContent(summary: string): string {
  return `${CHECKPOINT_PREAMBLE}\n\n<compacted-summary>\n${summary.trim()}\n</compacted-summary>`
}

/** 去掉模型可能回显的标签 / 代码围栏，只保留摘要正文 */
export function sanitizeSummary(text: string): string {
  let value = text.trim()
  const wrapped = value.match(/<compacted-summary>([\s\S]*?)<\/compacted-summary>/i)
  if (wrapped) value = wrapped[1].trim()

  if (value.startsWith('```') && value.endsWith('```')) {
    value = value
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
  }
  return value
}
