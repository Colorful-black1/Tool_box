import { describe, expect, it, vi } from 'vitest'

import { ExtensionError } from '../../../shared/extensions'
import { searchSkills } from './skill-search'

const body = {
  query: 'pdf',
  skills: [
    {
      id: 'anthropics/skills/pdf',
      source: 'anthropics/skills',
      skillId: 'pdf',
      name: 'pdf',
      installs: 228292
    },
    { id: 'broken', source: 'no-slash-here', skillId: '../evil', name: 'evil', installs: 1 }
  ],
  count: 2
}

const respond = (payload: unknown, status = 200): ReturnType<typeof vi.fn> =>
  vi.fn(async () => new Response(JSON.stringify(payload), { status }))

describe('searchSkills', () => {
  it('拼出可复制的安装命令，并丢弃来源非法的条目', async () => {
    const fetchImpl = respond(body)
    const result = await searchSkills(
      { query: ' pdf ', limit: 20 },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )

    const url = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(url.origin).toBe('https://skills.sh')
    expect(url.pathname).toBe('/api/search')
    expect(url.searchParams.get('q')).toBe('pdf')
    expect(url.searchParams.get('limit')).toBe('20')

    expect(result.items).toHaveLength(1)
    expect(result.items[0].installCommand).toBe('npx skills add anthropics/skills --skill pdf -g')
    expect(result.items[0].repositoryUrl).toBe('https://github.com/anthropics/skills')
    expect(result.hasMore).toBe(false)
  })

  it('关键词不足两个字符时直接报错，不发请求', async () => {
    const fetchImpl = respond(body)
    await expect(
      searchSkills({ query: 'p' }, { fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toBeInstanceOf(ExtensionError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('返回条数达到 limit 时认为还有下一页', async () => {
    const fetchImpl = respond(body)
    const result = await searchSkills(
      { query: 'pdf', limit: 2 },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )
    expect(result.hasMore).toBe(true)
  })

  it('限流与失败都转成可读文案', async () => {
    const limited = respond({}, 429)
    await expect(
      searchSkills({ query: 'pdf' }, { fetchImpl: limited as unknown as typeof fetch })
    ).rejects.toThrow('请求过于频繁')

    const broken = respond({}, 503)
    await expect(
      searchSkills({ query: 'pdf' }, { fetchImpl: broken as unknown as typeof fetch })
    ).rejects.toThrow('HTTP 503')
  })
})
