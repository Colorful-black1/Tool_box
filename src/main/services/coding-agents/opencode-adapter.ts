import type { OpenCodeInfo } from '../../../shared/types'
import type { CodingAgentRuntimeView } from '../../../shared/coding-agents'
import type { OpenCodeService } from '../opencode/opencode-service'
import type { CodingAgentAdapter, NativeCodingEvent, NativeCodingSession } from './adapter'
import type { NativeSendContext } from './adapter'
import type { NativeAgentCatalog } from './agent-action-catalog'

/** 兼容包装：继续使用现有服务、子进程、Plan 和 Desktop 可见模型规则。 */
export class OpenCodeAdapter implements CodingAgentAdapter {
  readonly id = 'opencode' as const

  constructor(private readonly service: OpenCodeService) {}

  private view(info: OpenCodeInfo): Omit<CodingAgentRuntimeView, 'connectionId'> {
    return {
      ...info,
      runtimeId: this.id,
      name: 'OpenCode',
      available: true,
      detail: '复用 Desktop 内置运行时 · 登录与模型沿用 OpenCode 配置',
      capabilities: {
        history: 'supported',
        resume: info.connected ? (info.canLoadSession ? 'supported' : 'unsupported') : 'unknown',
        subagents: 'unknown',
        stopSubagent: 'unsupported',
        usage: 'unknown',
        desktopHistory: 'supported'
      }
    }
  }

  async inspect(): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>> {
    return this.view(await this.service.inspect())
  }

  async selectExecutable(path: string): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>> {
    return this.view(await this.service.selectExecutable(path))
  }

  async connect(directory: string): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>> {
    return this.view(await this.service.connect(directory))
  }

  disconnect(): void {
    this.service.disconnect()
  }

  listSessions() {
    return this.service.listSessions()
  }

  openSession(id?: string): Promise<NativeCodingSession> {
    return this.service.openSession(id)
  }

  setOption(id: string, optionId: string, value: string): Promise<NativeCodingSession> {
    return this.service.setOption(id, optionId, value)
  }

  async catalog(id?: string): Promise<NativeAgentCatalog> {
    return {
      commands: this.service.commands(id),
      skills: [],
      mcp: [],
      notices: [
        id
          ? '命令来自当前 ACP 会话；未公布的 Skill 不显示为可调用。ACP 未提供 MCP 状态查询。'
          : '原生命令在首次对话建立后读取；本次未创建会话。ACP 未提供 MCP 状态查询。'
      ]
    }
  }

  send(id: string, content: string, context?: NativeSendContext): void {
    this.service.send(id, content, context)
  }

  stop(id: string): void {
    this.service.stop(id)
  }

  approve(id: string, approvalId: string, approved: boolean): void {
    this.service.approve(id, approvalId, approved)
  }

  subscribe(listener: (event: NativeCodingEvent) => void): () => void {
    return this.service.subscribe(listener)
  }
}
