import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AiAgentArenaService } from './service'
import { AI_AGENT_ARENA_TTL_MS } from '../../../shared/ai-agent-arena'
import type { FetchLike } from '../github-trending/fetch'

const codeHtml = `<table><tbody><tr data-agent="opencode" data-agent-label="OpenCode"
  data-agent-version="1.0" data-rank="1" data-model-name="GLM" data-model-dir="glm"
  data-final-score="37.5" data-pass-at-3-rate="0.4" data-pass-3-rate="0.25"
  data-attempt-score="0.3" data-total-tokens="100" data-exported-at="2026-06-18"></tr></tbody></table>`

const terminalHtml = `<script>self.__next_f.push([1,${JSON.stringify(
  `Terminal-Bench 4.1 {"rows":[{"id":"r1","rank":1,"metadata":{"date":"2026-11-17","agent_display":{"label":"Codex"},"model_display":{"label":"GPT"},"reasoning_effort":"max"},"metrics":{"accuracy":62,"n_trials":10,"pass_at_3":0.7,"pass_at_5":0.8,"total_cost_usd":1,"total_tokens":100}}]}`
)}])</script>`

const frontierFeed = {
  version: 'feed-v1',
  end_ms: Date.UTC(2026, 10, 18, 12),
  tasks: [{ name: 't1' }],
  harnesses: [{ id: 'h1', label: 'Harness', version: '1.0' }],
  models: [{ id: 'm1', label: 'Model', effort: 'max' }],
  outcomes: ['pass', 'fail', 'timeout', 'infra'],
  attempts: 2,
  finished_fields: [
    'task',
    'harness',
    'model',
    'outcome',
    'cost_usd',
    'run_seconds',
    'input_tokens',
    'output_tokens',
    'lookup'
  ],
  finished: [
    [0, 0, 0, 0, 1, 10, 60, 40, 0],
    [0, 0, 0, 1, 1, 10, 60, 40, 0]
  ]
}

function response(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { etag: 'v1' }
  })
}

function fixture(options: { failFrontier?: boolean; notModified?: boolean } = {}) {
  const calls: string[] = []
  let failFrontier = options.failFrontier === true
  const fetchImpl: FetchLike = async (input) => {
    calls.push(input)
    if (input.includes('code-agent-bench')) {
      return options.notModified ? response('', 304) : response(codeHtml)
    }
    if (input.includes('tbench.ai')) {
      return options.notModified ? response('', 304) : response(terminalHtml)
    }
    if (input.includes('frontierharness.org/api/live')) {
      if (failFrontier) throw new Error('frontier unavailable')
      return response(JSON.stringify(frontierFeed))
    }
    throw new Error(`unexpected URL ${input}`)
  }
  const dir = mkdtempSync(join(tmpdir(), 'toolbox-agent-arena-'))
  let now = Date.UTC(2026, 10, 18, 12)
  const service = new AiAgentArenaService({
    fetchImpl,
    cacheFile: join(dir, 'cache.json'),
    now: () => now
  })
  return {
    service,
    calls,
    dir,
    advance: (ms: number) => {
      now += ms
    },
    setFailFrontier: (value: boolean) => {
      failFrontier = value
    }
  }
}

const created: string[] = []
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Agent 排行服务', () => {
  it('首次采集三个来源，第二次优先使用缓存', async () => {
    const f = fixture()
    created.push(f.dir)
    const first = await f.service.get({ force: true })
    expect(first.source).toBe('network')
    expect(first.snapshot.boards).toHaveLength(3)
    expect(first.snapshot.sources.codeagentbench.ok).toBe(true)
    expect(first.snapshot.sources.frontierharness.ok).toBe(true)
    expect(f.calls).toHaveLength(3)

    const second = await f.service.get({ allowStale: true })
    expect(second.source).toBe('cache')
    expect(second.snapshot.boards).toHaveLength(3)
    expect(f.calls).toHaveLength(3)
  })

  it('只刷新超过各自 TTL 的来源', async () => {
    const f = fixture()
    created.push(f.dir)
    await f.service.get({ force: true })
    expect(f.calls).toHaveLength(3)
    f.advance(AI_AGENT_ARENA_TTL_MS.frontierharness + 1)
    await f.service.get({})
    expect(f.calls).toHaveLength(4)
    expect(f.calls.at(-1)).toContain('frontierharness.org/api/live')
  })

  it('单个来源失败保留旧榜并给出警告', async () => {
    const f = fixture()
    created.push(f.dir)
    await f.service.get({ force: true })
    f.setFailFrontier(true)
    const result = await f.service.get({ force: true })
    expect(result.snapshot.boards).toHaveLength(3)
    expect(result.snapshot.sources.frontierharness.ok).toBe(false)
    expect(result.warning).toContain('FrontierHarness')
    expect(
      result.snapshot.boards.find((board) => board.id === 'frontierharness')
    ).toBeTruthy()
  })

  it('没有缓存且全部失败时返回可读错误', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'toolbox-agent-arena-empty-'))
    created.push(dir)
    const service = new AiAgentArenaService({
      fetchImpl: async () => {
        throw new Error('network down')
      },
      cacheFile: join(dir, 'cache.json')
    })
    await expect(service.get({ force: true })).rejects.toThrow('Agent 排行数据读取失败')
  })
})
