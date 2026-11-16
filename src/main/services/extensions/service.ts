import { homedir } from 'node:os'

import type {
  McpScanResult,
  McpSearchInput,
  McpSearchResult,
  SkillRootsView,
  SkillScanResult,
  SkillSearchInput,
  SkillSearchResult
} from '../../../shared/extensions'
import { scanMcp } from './mcp-scan'
import { searchMcp } from './mcp-search'
import { SkillRootStore, expandRootPath, skillRootsView } from './skill-roots'
import { scanSkills } from './skill-scan'
import { searchSkills } from './skill-search'

/** 本机文件变动不频繁，扫描缓存一分钟；在线结果缓存十分钟。 */
const SCAN_TTL_MS = 60_000
const SEARCH_TTL_MS = 10 * 60_000

export interface ExtensionsServiceOptions {
  home?: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  /** 自定义技能扫描路径的落盘文件；不传时只在内存里生效（测试用）。 */
  rootsFile?: string
  now?: () => number
}

/**
 * 技能与 MCP 的只读服务。
 *
 * 本版本不写任何 Agent 目录：技能路径只写 Tool_box 自己的 `skill-roots.json`，
 * 扫描只读，检索只返回可复制的命令。
 */
export class ExtensionsService {
  private readonly options: ExtensionsServiceOptions
  private readonly store: SkillRootStore
  private readonly now: () => number
  private skills: { at: number; value: SkillScanResult } | null = null
  private servers: { at: number; value: McpScanResult } | null = null
  private readonly skillSearches = new Map<string, { at: number; value: SkillSearchResult }>()
  private readonly mcpSearches = new Map<string, { at: number; value: McpSearchResult }>()

  constructor(options: ExtensionsServiceOptions = {}) {
    this.options = options
    this.store = new SkillRootStore(options.rootsFile)
    this.now = options.now ?? Date.now
  }

  private home(): string {
    return this.options.home ?? homedir()
  }

  async skillRoots(): Promise<SkillRootsView> {
    return skillRootsView(this.store, this.home(), this.options.env)
  }

  async addSkillRoot(path: string): Promise<SkillRootsView> {
    await this.store.add(path, this.home())
    this.skills = null
    return this.skillRoots()
  }

  async removeSkillRoot(path: string): Promise<SkillRootsView> {
    await this.store.remove(path)
    this.skills = null
    return this.skillRoots()
  }

  async listSkills(refresh = false): Promise<SkillScanResult> {
    if (!refresh && this.skills && this.now() - this.skills.at < SCAN_TTL_MS) return this.skills.value
    const extraRoots = (await this.store.list()).map((path) =>
      expandRootPath(this.home(), path)
    )
    const value = await scanSkills({
      home: this.options.home,
      env: this.options.env,
      extraRoots
    })
    this.skills = { at: this.now(), value }
    return value
  }

  async listMcp(refresh = false): Promise<McpScanResult> {
    if (!refresh && this.servers && this.now() - this.servers.at < SCAN_TTL_MS)
      return this.servers.value
    const value = await scanMcp({ home: this.options.home, env: this.options.env })
    this.servers = { at: this.now(), value }
    return value
  }

  async searchSkills(input: SkillSearchInput): Promise<SkillSearchResult> {
    const key = [input.query.trim(), input.limit ?? '', input.offset ?? ''].join('|')
    const hit = this.skillSearches.get(key)
    if (hit && this.now() - hit.at < SEARCH_TTL_MS) return hit.value
    const value = await searchSkills(input, { fetchImpl: this.options.fetchImpl })
    this.trim(this.skillSearches)
    this.skillSearches.set(key, { at: this.now(), value })
    return value
  }

  async searchMcp(input: McpSearchInput): Promise<McpSearchResult> {
    const key = [input.query.trim(), input.limit ?? '', input.cursor ?? ''].join('|')
    const hit = this.mcpSearches.get(key)
    if (hit && this.now() - hit.at < SEARCH_TTL_MS) return hit.value
    const value = await searchMcp(input, { fetchImpl: this.options.fetchImpl })
    this.trim(this.mcpSearches)
    this.mcpSearches.set(key, { at: this.now(), value })
    return value
  }

  /** 缓存只保留最近 40 次检索，避免长会话里无限增长。 */
  private trim(cache: Map<string, { at: number }>): void {
    if (cache.size < 40) return
    const oldest = [...cache].sort((a, b) => a[1].at - b[1].at).slice(0, cache.size - 39)
    for (const [key] of oldest) cache.delete(key)
  }
}
