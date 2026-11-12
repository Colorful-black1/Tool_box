/** 原生采集用的厂商归一表；只保存展示所需的稳定元数据，不依赖任何上游快照。 */

export interface NativeVendorSeed {
  id: string
  name: string
  nameZh: string
  country: string
  continent: 'west' | 'east'
}

interface VendorMeta {
  nameZh: string
  country: string
  continent: 'west' | 'east'
}

const META: Record<string, VendorMeta> = {
  anthropic: { nameZh: 'Anthropic', country: 'US', continent: 'west' },
  openai: { nameZh: 'OpenAI', country: 'US', continent: 'west' },
  google: { nameZh: 'Google', country: 'US', continent: 'west' },
  meta: { nameZh: 'Meta', country: 'US', continent: 'west' },
  mistral: { nameZh: 'Mistral', country: 'FR', continent: 'west' },
  cohere: { nameZh: 'Cohere', country: 'CA', continent: 'west' },
  ai21: { nameZh: 'AI21 Labs', country: 'IL', continent: 'west' },
  xai: { nameZh: 'xAI', country: 'US', continent: 'west' },
  nvidia: { nameZh: 'NVIDIA', country: 'US', continent: 'west' },
  microsoft: { nameZh: 'Microsoft', country: 'US', continent: 'west' },
  amazon: { nameZh: 'Amazon', country: 'US', continent: 'west' },
  perplexity: { nameZh: 'Perplexity', country: 'US', continent: 'west' },
  reka: { nameZh: 'Reka', country: 'US', continent: 'west' },
  liquid: { nameZh: 'Liquid AI', country: 'US', continent: 'west' },
  deepseek: { nameZh: '深度求索', country: 'CN', continent: 'east' },
  alibaba: { nameZh: '阿里云', country: 'CN', continent: 'east' },
  zhipuai: { nameZh: '智谱', country: 'CN', continent: 'east' },
  moonshotai: { nameZh: '月之暗面', country: 'CN', continent: 'east' },
  minimax: { nameZh: 'MiniMax', country: 'CN', continent: 'east' },
  bytedance: { nameZh: '字节跳动', country: 'CN', continent: 'east' },
  baidu: { nameZh: '百度', country: 'CN', continent: 'east' },
  tencent: { nameZh: '腾讯', country: 'CN', continent: 'east' },
  xiaomi: { nameZh: '小米', country: 'CN', continent: 'east' },
  stepfun: { nameZh: '阶跃星辰', country: 'CN', continent: 'east' },
  '01-ai': { nameZh: '零一万物', country: 'CN', continent: 'east' },
  baichuan: { nameZh: '百川智能', country: 'CN', continent: 'east' },
  sensetime: { nameZh: '商汤', country: 'CN', continent: 'east' },
  iflytek: { nameZh: '科大讯飞', country: 'CN', continent: 'east' },
  thudm: { nameZh: '智谱 / 清华', country: 'CN', continent: 'east' },
  qwen: { nameZh: '通义千问', country: 'CN', continent: 'east' },
  'google-deepmind': { nameZh: 'Google DeepMind', country: 'US', continent: 'west' },
  'z-ai': { nameZh: '智谱', country: 'CN', continent: 'east' },
  'x-ai': { nameZh: 'xAI', country: 'US', continent: 'west' },
  'meta-llama': { nameZh: 'Meta', country: 'US', continent: 'west' }
}

const ALIASES: Record<string, string> = {
  'google-deepmind': 'google',
  'z-ai': 'zhipuai',
  zai: 'zhipuai',
  zhipu: 'zhipuai',
  'x-ai': 'xai',
  'meta-llama': 'meta',
  qwen: 'alibaba',
  'alibaba-cloud': 'alibaba',
  moonshot: 'moonshotai',
  'moonshot-ai': 'moonshotai',
  '01ai': '01-ai',
  '01.ai': '01-ai'
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}

function countryFromText(value: string | undefined): string {
  if (!value) return 'ZZ'
  const text = value.toLowerCase()
  if (text.includes('china') || text.includes('中国')) return 'CN'
  if (text.includes('united states') || text.includes('usa')) return 'US'
  if (text.includes('united kingdom')) return 'GB'
  if (text.includes('france')) return 'FR'
  if (text.includes('germany')) return 'DE'
  if (text.includes('canada')) return 'CA'
  if (text.includes('israel')) return 'IL'
  if (text.includes('japan')) return 'JP'
  if (text.includes('korea')) return 'KR'
  return 'ZZ'
}

export function normalizeVendorId(raw: string): string {
  const id = normalize(raw)
  return ALIASES[id] ?? id
}

export function vendorFromOrganization(org: string | undefined): string {
  const text = (org ?? '').toLowerCase()
  if (text.includes('deepseek')) return 'deepseek'
  if (text.includes('alibaba') || text.includes('qwen')) return 'alibaba'
  if (text.includes('zhipu') || text.includes('z.ai') || text.includes('z-ai')) return 'zhipuai'
  if (text.includes('moonshot') || text.includes('kimi')) return 'moonshotai'
  if (text.includes('minimax')) return 'minimax'
  if (text.includes('bytedance') || text.includes('doubao')) return 'bytedance'
  if (text.includes('baidu')) return 'baidu'
  if (text.includes('tencent')) return 'tencent'
  if (text.includes('xiaomi')) return 'xiaomi'
  if (text.includes('stepfun')) return 'stepfun'
  if (text.includes('baichuan')) return 'baichuan'
  if (text.includes('sensetime')) return 'sensetime'
  if (text.includes('iflytek')) return 'iflytek'
  if (text.includes('01.ai') || text.includes('01-ai')) return '01-ai'
  if (text.includes('anthropic')) return 'anthropic'
  if (text.includes('openai')) return 'openai'
  if (text.includes('google')) return 'google'
  if (text.includes('meta')) return 'meta'
  if (text.includes('mistral')) return 'mistral'
  if (text.includes('cohere')) return 'cohere'
  if (text.includes('ai21')) return 'ai21'
  if (text.includes('nvidia')) return 'nvidia'
  if (text.includes('microsoft')) return 'microsoft'
  if (text.includes('amazon')) return 'amazon'
  return normalizeVendorId(org ?? 'unknown')
}

export function vendorSeed(
  id: string,
  providerName: string | undefined,
  epochCountry: string | undefined
): NativeVendorSeed {
  const normalized = normalizeVendorId(id)
  const meta = META[normalized]
  const country =
    countryFromText(epochCountry) !== 'ZZ' ? countryFromText(epochCountry) : (meta?.country ?? 'ZZ')
  return {
    id: normalized,
    name: providerName || meta?.nameZh || normalized,
    nameZh: meta?.nameZh || providerName || normalized,
    country,
    continent: meta?.continent ?? (country === 'CN' ? 'east' : 'west')
  }
}
