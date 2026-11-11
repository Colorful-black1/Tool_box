import type { AiProviderId } from './types'

/**
 * 模型窗口的目录兜底。
 *
 * 标准 OpenAI `/models` 不保证返回窗口；部分网关（如 OpenCode Go）也
 * 只返回模型 id。这里按 models.dev 2026-11-11 快照整理 ToolBox 内置
 * 预设里能确认的条目，只在「接口 / 手动 / 超长学习」都没有时使用。
 *
 * 不按模型名跨供应商套用：同一个模型在不同网关的窗口可能不同，
 * 所以表按 provider 分组；接口返回的值永远优先于这里。
 */
const MODEL_CONTEXT_CATALOG: Partial<Record<AiProviderId, Record<string, number>>> = {
  'opencode-go': {
    'deepseek-v4-pro': 1_000_000,
    'deepseek-v4.1-flash': 1_000_000,
    'glm-5.3': 1_000_000,
    'glm-5.3-flash': 1_000_000,
    'glm-5.2': 1_000_000,
    'gpt-6-luna': 1_050_000,
    'gpt-5.6-luna': 1_050_000,
    'claude-haiku-5-5': 1_000_000,
    'kimi-k3': 1_048_576,
    'kimi-k2.7-code': 262_144,
    'minimax-m3': 1_000_000,
    'minimax-m2.7': 204_800,
    'mimo-v2.6-pro': 1_048_576,
    'qwen3.8-max': 1_000_000,
    'grok-4.7': 500_000
  },
  deepseek: {
    'deepseek-v4-pro': 1_048_576,
    'deepseek-v4-flash': 1_048_576,
    'deepseek-v4.1-flash': 1_048_576
  }
}

/**
 * 按供应商 + 模型 id 查目录；找不到返回 null。
 *
 * 「自定义」供应商允许填 OpenAI 兼容端点，若地址是 OpenCode Go / DeepSeek
 * 官方，也按对应目录兜底，避免用户只是没选预设就被打回 128k。
 */
export function catalogContextWindow(
  provider: string,
  model: string,
  baseUrl = ''
): number | null {
  const normalized = model.trim()
  if (!normalized) return null

  const table = MODEL_CONTEXT_CATALOG[provider as AiProviderId] ?? tableForBaseUrl(baseUrl)
  if (!table) return null
  const tokens = table[normalized]
  return typeof tokens === 'number' && Number.isInteger(tokens) && tokens > 0 ? tokens : null
}

function tableForBaseUrl(baseUrl: string): Record<string, number> | undefined {
  const value = baseUrl.trim().toLowerCase()
  if (!value) return undefined
  if (value.includes('opencode.ai')) return MODEL_CONTEXT_CATALOG['opencode-go']
  if (value.includes('api.deepseek.com')) return MODEL_CONTEXT_CATALOG.deepseek
  return undefined
}
