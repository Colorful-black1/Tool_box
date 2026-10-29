import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { AGENT_CONFIG_KEYS, agentPreferences } from '../../../shared/agent-projects'
import type { CodingAgentId } from '../../../shared/coding-agents'
import type { ToolboxStore } from '../chat-store/chat-store'
import { CodingAgentError } from './adapter'

/** 项目选择独立于实际连接，只复用既有运行时配置，不启动原生程序。 */
export class AgentProjectMemory {
  constructor(private readonly store: Pick<ToolboxStore, 'configGet' | 'configSet'>) {}

  async inspect(id: CodingAgentId): Promise<{ projectDirectory: string; projectError?: string }> {
    const value = agentPreferences(this.store.configGet(), id).directory
    if (typeof value !== 'string' || !value) return { projectDirectory: '' }
    if (value.length > 4096 || value.includes('\0') || !isAbsolute(value))
      return { projectDirectory: '', projectError: '上次保存的项目路径无效，请重新选择项目' }
    try {
      await this.resolve(value)
      return { projectDirectory: value }
    } catch {
      return {
        projectDirectory: value,
        projectError: '上次选择的项目不存在或不可访问，请重新选择项目'
      }
    }
  }

  async select(id: CodingAgentId, directory: string): Promise<string> {
    const path = await this.resolve(directory)
    try {
      this.store.configSet({
        [AGENT_CONFIG_KEYS[id]]: {
          ...agentPreferences(this.store.configGet(), id),
          directory: path
        }
      })
    } catch {
      throw new CodingAgentError('项目选择保存失败，请检查本地数据目录后重试')
    }
    return path
  }

  private async resolve(directory: string): Promise<string> {
    if (directory.length > 4096 || directory.includes('\0') || !isAbsolute(directory))
      throw new CodingAgentError('请选择有效的项目绝对目录')
    try {
      const path = await realpath(directory)
      if (!(await stat(path)).isDirectory()) throw new Error('不是目录')
      await access(path, constants.R_OK)
      return path
    } catch {
      throw new CodingAgentError('项目目录不存在或不可访问，请重新选择项目')
    }
  }
}
