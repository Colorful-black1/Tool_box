import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { sourcePaths } from './sources'
import { USAGE_CLIENTS } from '../../../shared/agent-usage'
import type { UsageClient } from '../../../shared/agent-usage'

describe('已知数据目录发现', () => {
  it('每个来源有自己的统计目录，不复用聊天枚举', () => {
    for (const client of Object.keys(USAGE_CLIENTS) as UsageClient[])
      expect(sourcePaths(client, '/fixture', {})).not.toHaveLength(0)
  })
  it('尊重公开目录覆盖，并保留历史默认目录回退', () => {
    expect(sourcePaths('codex', '/fixture', { CODEX_HOME: '/custom' })).toEqual([
      join('/custom', 'sessions'),
      join('/custom', 'archived_sessions')
    ])
    expect(sourcePaths('opencode', '/fixture', { OPENCODE_DB: '/custom/opencode.db' })).toEqual([
      '/custom/opencode.db'
    ])
    expect(sourcePaths('gemini', '/fixture', { GEMINI_CLI_HOME: '/custom' })).toEqual([
      join('/custom', '.gemini/tmp')
    ])
    expect(sourcePaths('kimi', '/fixture', {})).toHaveLength(2)
    expect(sourcePaths('pi', '/fixture', {})).toHaveLength(2)
  })
})
