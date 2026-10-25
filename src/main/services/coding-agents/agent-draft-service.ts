import { emptyDraftDocument, parseAgentDraftDocument } from '../../../shared/agent-drafts'
import type { AgentDraftSnapshot, AgentDraftSaveInput } from '../../../shared/agent-drafts'
import type { DraftTextSecretBox } from '../crypto/secret-box'

/** 存储层只能接受密文；服务采用修订号检查，避免窗口间迟到写入。 */
interface DraftRepository {
  agentDraftCipherGet(): string | null
  agentDraftCipherSet(cipherText: string): void
}

/** 独立草稿记录，不改变 schema、密码数据或普通配置。 */
export class AgentDraftService {
  constructor(
    private readonly store: DraftRepository,
    private readonly secretBox: DraftTextSecretBox
  ) {}

  read(): AgentDraftSnapshot {
    try {
      const cipher = this.store.agentDraftCipherGet()
      if (cipher === null) return { revision: 0, document: emptyDraftDocument() }
      const stored = JSON.parse(this.secretBox.decryptText(cipher)) as Record<string, unknown>
      if (
        typeof stored.revision !== 'number' ||
        !Number.isSafeInteger(stored.revision) ||
        stored.revision < 1
      )
        throw new Error('修订号无效')
      return { revision: stored.revision, document: parseAgentDraftDocument(stored.document) }
    } catch {
      // 不输出原始异常或密文；保存前必读使损坏记录无法被空状态覆盖。
      throw new Error('草稿无法读取或解密，原记录已保留；请检查系统安全存储后重试')
    }
  }

  save(input: AgentDraftSaveInput): AgentDraftSnapshot {
    // 主进程同步校验、加密及单条写入构成顺序队列，中间没有异步让出。
    const current = this.read()
    if (current.revision !== input.revision)
      throw new Error('草稿已在其他窗口更新，请重新读取后重试')
    const next = { revision: current.revision + 1, document: input.document }
    try {
      this.store.agentDraftCipherSet(this.secretBox.encryptText(JSON.stringify(next)))
    } catch {
      throw new Error('草稿保存失败，请检查系统安全存储和磁盘；文字仍保留在当前窗口')
    }
    return next
  }
}
