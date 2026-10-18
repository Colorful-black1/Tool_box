interface PendingApproval {
  conversationId: string
  resolve: (approved: boolean) => void
}

/**
 * 写工具的审批门（人在环）—— 语义与桌面端 `services/agent/approval-gate.ts` 一致。
 *
 * 工具执行前调用 `request(callId, conversationId)` 挂起，等界面以同一个 callId 回执；
 * 用户停止生成、离开会话或组件卸载时用 `rejectConversation()` 一次性拒绝全部挂起项，
 * 否则 Promise 永远不 settle，该会话的流也永远不结束。
 *
 * 不 import 任何 RN / Node 模块，可在 vitest 中直接测。
 */
export class ApprovalGate {
  private readonly pending = new Map<string, PendingApproval>()

  request(callId: string, conversationId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pending.set(callId, { conversationId, resolve })
    })
  }

  /** @returns 是否命中了挂起项（未命中说明已被拒绝或已过期） */
  settle(callId: string, approved: boolean): boolean {
    const item = this.pending.get(callId)
    if (!item) return false
    this.pending.delete(callId)
    item.resolve(approved)
    return true
  }

  /** 拒绝某会话的全部挂起审批（停止生成 / 离开会话 / 组件卸载时调用） */
  rejectConversation(conversationId: string): void {
    for (const [callId, item] of this.pending) {
      if (item.conversationId === conversationId) {
        this.pending.delete(callId)
        item.resolve(false)
      }
    }
  }

  get size(): number {
    return this.pending.size
  }
}
