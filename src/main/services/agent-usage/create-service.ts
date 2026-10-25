import { readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { USAGE_CLIENTS } from '../../../shared/agent-usage'
import type { UsageClient } from '../../../shared/agent-usage'
import { AgentUsageService } from './usage-service'
import { readUsageCache, writeUsageCache } from './cache'
import { object } from './normalize'

/** 同一启动上下文只创建一次，统计页和对话共享来源选择、扫描队列与缓存。 */
export async function createAgentUsageService(userDataDir: string): Promise<AgentUsageService> {
  const settingsFile = join(userDataDir, 'agent-usage-sources.json')
  const cacheFile = join(userDataDir, 'agent-usage-cache.json')
  const roots: Partial<Record<UsageClient, string>> = {}
  try {
    const data = object(JSON.parse(await readFile(settingsFile, 'utf8')) as unknown)
    for (const id of Object.keys(USAGE_CLIENTS) as UsageClient[]) {
      const path = data[id]
      if (typeof path === 'string' && path.length <= 4096 && isAbsolute(path)) roots[id] = path
    }
  } catch (error) {
    // 首次启动没有设置；损坏文件保留，回退自动发现，不回显路径或内容。
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn('[AgentUsage] 来源设置不可读，使用自动发现')
  }
  return new AgentUsageService(
    roots,
    async (value) => {
      await writeFile(settingsFile + '.tmp', JSON.stringify(value), {
        encoding: 'utf8',
        mode: 0o600
      })
      await rename(settingsFile + '.tmp', settingsFile)
    },
    {
      load: () => readUsageCache(cacheFile),
      save: async (value) => {
        await writeUsageCache(cacheFile, value)
      }
    }
  )
}
