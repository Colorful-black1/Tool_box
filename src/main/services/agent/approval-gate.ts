interface PendingApproval {
  conversationId: string
  resolve: (approved: boolean) => void
}

/**
 * 写 / 破坏性工具的审批门（人在环）。
 *
 * 工具 handler 调用 `request(callId, conversationId)` 后挂起，等待渲染层
 * 通过 IPC 以同一个 callId 回执；用户停止生成或会话结束时用
 * `rejectConversation()` 一次性拒绝全部挂起项，避免 Promise 永不 resolve。
 */
export class ApprovalGate {
  private readonly pending = new Map<string, PendingApproval>()

  request(callId: string, conversationId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pending.set(callId, { conversationId, resolve })
    })
  }

  /** @returns 是否命中了挂起项（未命中说明已超时 / 已取消） */
  settle(callId: string, approved: boolean): boolean {
    const item = this.pending.get(callId)
    if (!item) return false
    this.pending.delete(callId)
    item.resolve(approved)
    return true
  }

  rejectConversation(conversationId: string): void {
    for (const [callId, item] of this.pending) {
      if (item.conversationId === conversationId) {
        this.pending.delete(callId)
        item.resolve(false)
      }
    }
  }
}
