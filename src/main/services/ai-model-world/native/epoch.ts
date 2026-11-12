import { unzipSync } from 'fflate'
import { parse } from 'csv-parse/sync'

import type {
  AiWorldAttribution,
  AiWorldBenchmarkScore,
  AiWorldScoreUnit
} from '../../../../shared/ai-model-world'
import { fetchBytes, NativeSourceError } from './http'
import type { FetchLike } from '../../github-trending/fetch'

export interface EpochModel {
  key: string
  name: string
  organization: string
  country: string
  releaseDate: string | null
  eci: number | null
  openWeights: boolean | null
  scores: AiWorldBenchmarkScore[]
  coding: AiWorldBenchmarkScore[]
}

export interface EpochData {
  models: EpochModel[]
}

interface Accumulator {
  model: EpochModel
  scores: Map<string, AiWorldBenchmarkScore>
  coding: Map<string, AiWorldBenchmarkScore>
}

interface CsvRow {
  [key: string]: string
}

const EPOCH_ZIP_URL = 'https://epoch.ai/data/benchmark_data.zip'

interface CoreSpec {
  file: string
  league: string
  column: string
  fraction: boolean
  unit?: AiWorldScoreUnit
  coding: boolean
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
}

function text(value: string | undefined): string | null {
  const result = value?.trim()
  return result ? result : null
}

function numeric(value: string | undefined): number | null {
  const result = Number(value?.trim())
  return Number.isFinite(result) ? result : null
}

function scoreValue(raw: string | undefined, fraction: boolean): number | null {
  const value = numeric(raw)
  if (value == null || value < 0) return null
  const scaled = fraction && value <= 1 ? value * 100 : value
  return Math.round(scaled * 100) / 100
}

/** Epoch 的 model_version 会带 reasoning / effort / 日期后缀；只用于匹配，不进入展示名。 */
export function cleanEpochModelName(value: string): string {
  let name = value.trim()
  for (let i = 0; i < 8; i += 1) {
    const next = name
      .replace(
        /_(max|high|medium|low|thinking|nothinking|nonreasoning|reasoning|xhigh|unknown|maxeffort)$/i,
        ''
      )
      .replace(/-(?:0?[1-9]|1[0-2])-20\d{2}$/i, '')
      .replace(/-(?:19|20)\d{2}-(?:0?[1-9]|1[0-2])-(?:0?[1-9]|[12]\d|3[01])$/i, '')
      .replace(/-(?:0?[1-9]|1[0-2])(?:0?[1-9]|[12]\d|3[01])$/i, '')
    if (next === name || next.length < 2) break
    name = next
  }
  return name
}

function findFile(files: Record<string, Uint8Array>, suffix: string): Uint8Array | null {
  const normalized = suffix.toLowerCase()
  const entry = Object.entries(files).find(([name]) => name.toLowerCase().endsWith(normalized))
  return entry?.[1] ?? null
}

function parseCsv(files: Record<string, Uint8Array>, suffix: string): CsvRow[] {
  const bytes = findFile(files, suffix)
  if (!bytes) return []
  try {
    return parse(Buffer.from(bytes).toString('utf8'), {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true
    }) as CsvRow[]
  } catch {
    return []
  }
}

export async function fetchEpoch(fetchImpl: FetchLike): Promise<EpochData> {
  const bytes = await fetchBytes(fetchImpl, EPOCH_ZIP_URL, 'Epoch AI 评测数据', 24 * 1024 * 1024)
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (error) {
    throw new NativeSourceError('Epoch AI 评测数据无法解压', { cause: error })
  }

  const byKey = new Map<string, Accumulator>()
  const ensure = (
    rawName: string,
    providerName: string | undefined,
    country: string | undefined,
    releaseDate: string | null,
    eci: number | null = null,
    openWeights: boolean | null = null
  ): Accumulator => {
    const cleaned = cleanEpochModelName(rawName)
    const key = normalize(cleaned)
    let item = byKey.get(key)
    if (!item) {
      item = {
        model: {
          key,
          name: text(cleaned) ?? cleaned,
          organization: providerName ?? '',
          country: country ?? '',
          releaseDate,
          eci,
          openWeights,
          scores: [],
          coding: []
        },
        scores: new Map(),
        coding: new Map()
      }
      byKey.set(key, item)
    }
    if (eci != null) item.model.eci = eci
    if (providerName) item.model.organization = providerName
    if (country) item.model.country = country
    if (releaseDate && (!item.model.releaseDate || releaseDate > item.model.releaseDate))
      item.model.releaseDate = releaseDate
    if (openWeights != null) item.model.openWeights = openWeights
    return item
  }

  const addScore = (
    item: Accumulator,
    league: string,
    value: number,
    unit: AiWorldScoreUnit,
    attribution: AiWorldAttribution,
    sourceUrl: string | null,
    coding = false
  ): void => {
    const score: AiWorldBenchmarkScore = {
      league,
      score: value,
      unit,
      attribution,
      source: 'epoch.ai',
      sourceUrl
    }
    const current = item.scores.get(league)
    if (!current || value > current.score) item.scores.set(league, score)
    if (coding) {
      const currentCoding = item.coding.get(league)
      if (!currentCoding || value > currentCoding.score) item.coding.set(league, score)
    }
  }

  const sourceUrl = (row: CsvRow): string | null => {
    const value =
      row['Source Link'] ?? row['Source link'] ?? row['Source link (site from table)'] ?? row.Source
    return value?.startsWith('https://') ? value : null
  }

  const eciRows = parseCsv(files, 'epoch_capabilities_index/eci_scores.csv')
  for (const row of eciRows) {
    const name = text(row.Model) ?? text(row['Display name'])
    if (!name) continue
    const eci = scoreValue(row.eci, false)
    if (eci == null) continue
    const openWeights = /open weights/i.test(row['Accessibility group'] ?? '')
    const item = ensure(
      name,
      text(row.Organization) ?? undefined,
      text(row['Country (of organization)']) ?? undefined,
      text(row.date),
      eci,
      openWeights
    )
    addScore(item, 'eci', eci, 'index', 'third-party', 'https://epoch.ai/benchmarks')
  }

  const core: CoreSpec[] = [
    {
      file: 'otis_mock_aime_2024_2025.csv',
      league: 'aime',
      column: 'mean_score',
      fraction: true,
      coding: false
    },
    {
      file: 'gpqa_diamond.csv',
      league: 'gpqa_diamond',
      column: 'mean_score',
      fraction: true,
      coding: false
    },
    {
      file: 'arc_agi_2_external.csv',
      league: 'arc_agi_2',
      column: 'Score',
      fraction: true,
      coding: false
    },
    {
      file: 'fictionlivebench_external.csv',
      league: 'fiction_live',
      column: '120k token score',
      fraction: true,
      coding: false
    },
    {
      file: 'webdev_arena_external.csv',
      league: 'webdev_arena_elo',
      column: 'Arena Score',
      fraction: false,
      unit: 'elo' as const,
      coding: false
    },
    {
      file: 'swe_bench_verified.csv',
      league: 'swe_bench_verified',
      column: 'mean_score',
      fraction: true,
      coding: true
    },
    {
      file: 'terminalbench_external.csv',
      league: 'terminal_bench',
      column: 'Accuracy mean',
      fraction: true,
      coding: true
    },
    {
      file: 'aider_polyglot_external.csv',
      league: 'aider_polyglot',
      column: 'Percent correct',
      fraction: false,
      coding: true
    },
    {
      file: 'cursorbench_external.csv',
      league: 'cursorbench',
      column: 'Score',
      fraction: true,
      coding: true
    },
    {
      file: 'deepswe_external.csv',
      league: 'deepswe',
      column: 'Pass@1',
      fraction: true,
      coding: true
    },
    {
      file: 'frontiercode_external.csv',
      league: 'frontier_code',
      column: 'Main score',
      fraction: true,
      coding: true
    },
    {
      file: 'frontierswe_external.csv',
      league: 'frontier_swe',
      column: 'Score',
      fraction: true,
      coding: true
    },
    {
      file: 'live_bench_external.csv',
      league: 'livebench_coding',
      column: 'Coding average',
      fraction: false,
      coding: true
    }
  ]

  for (const spec of core) {
    for (const row of parseCsv(files, spec.file)) {
      const name = text(row['Name']) ?? text(row['Model version']) ?? text(row.Model)
      if (!name) continue
      const value = scoreValue(row[spec.column], spec.fraction)
      if (value == null) continue
      const item = ensure(
        name,
        text(row.Organization) ?? undefined,
        text(row.Country) ?? undefined,
        text(row['Release date'])
      )
      addScore(
        item,
        spec.league,
        value,
        spec.unit ?? 'pct',
        'third-party',
        sourceUrl(row),
        spec.coding
      )
    }
  }

  const models = [...byKey.values()].map((item) => {
    item.model.scores = [...item.scores.values()]
    item.model.coding = [...item.coding.values()]
    return item.model
  })
  return { models }
}
