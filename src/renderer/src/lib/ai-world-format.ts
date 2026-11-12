import type {
  AiWorldBenchmarkScore,
  AiWorldDatePrecision,
  AiWorldScoreUnit
} from '@shared/ai-model-world'

export function formatCount(value: number | null): string {
  if (value == null) return '—'
  if (value >= 1_000_000) {
    const count = value / 1_000_000
    return `${count % 1 === 0 ? count : count.toFixed(1)}M`
  }
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

export function formatPrice(value: number | null, suffix = '/M'): string {
  if (value == null) return '—'
  if (value < 0.01) return `$${value.toFixed(3)}${suffix}`
  if (value < 1) return `$${value.toFixed(2)}${suffix}`
  if (value < 10) return `$${value.toFixed(1)}${suffix}`
  return `$${Math.round(value)}${suffix}`
}

export function formatDate(
  value: string | null,
  precision: AiWorldDatePrecision | null = 'day'
): string {
  if (!value) return '未知'
  if (precision === 'year') return value.slice(0, 4)
  if (precision === 'month') return value.slice(0, 7)
  return value
}

export function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function formatScore(score: AiWorldBenchmarkScore): string {
  return formatScoreValue(score.score, score.unit)
}

export function formatScoreValue(value: number, unit: AiWorldScoreUnit): string {
  if (unit === 'pct') return `${value.toFixed(value >= 100 ? 0 : 1)}%`
  if (unit === 'elo') return `Elo ${Math.round(value)}`
  if (unit === 'minutes') return `${value.toFixed(value >= 100 ? 0 : 1)} 分钟`
  if (unit === 'usd') return `$${value.toFixed(2)}`
  return value.toFixed(value >= 100 ? 1 : 2)
}

export function formatRankPercentile(score: number): string {
  return `前 ${Math.max(1, Math.round((1 - score) * 100))}%`
}

export const AI_WORLD_SOURCE_LABELS: Record<string, string> = {
  'models.dev': 'models.dev',
  'epoch.ai': 'Epoch AI',
  huggingface: 'Hugging Face',
  openrouter: 'OpenRouter',
  'vercel-gateway': 'Vercel AI Gateway',
  litellm: 'LiteLLM',
  livebench: 'LiveBench',
  lmarena: 'LMArena',
  derived: '数据推导',
  override: '官方补充'
}

export function sourceLabel(source: string): string {
  return AI_WORLD_SOURCE_LABELS[source] ?? source
}

export function attributionLabel(attribution: 'third-party' | 'vendor-self-reported'): string {
  return attribution === 'third-party' ? '第三方' : '厂商自报'
}
