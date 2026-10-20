/**
 * 对话历史裁剪（两端共用）。
 *
 * 背景：两端此前都把**整段历史**原样发给模型，聊到几百轮必然撑爆上下文
 * （请求被服务端拒绝，用户只看到一句「AI 请求失败」）。
 *
 * 策略刻意选「只裁剪、不摘要」：
 * - 摘要要额外调一次模型，成本与延迟都不划算；
 * - 裁掉的部分在提示词里**明说**没带上，而不是假装还在上下文里，
 *   免得模型以为自己记得。
 */
import type { ChatMessage } from './types'

/** 裁剪结果 */
export interface TrimHistoryResult {
  /** 保留下来的消息（保持原顺序，且是连续的一段） */
  kept: ChatMessage[]
  /** 被丢弃的消息条数 */
  dropped: number
}

/**
 * 按字符预算保留最近的若干轮对话。
 *
 * 规则：
 * 1. 以「轮」为单位保留（一轮 = 一条 user 消息 + 其后的 assistant 消息），
 *    不允许只留半轮；
 * 2. 从最新一轮往回累加字符数，超出预算就停 —— 保留的是**连续**的一段，
 *    避免模型看到「中间凭空少了几轮」；
 * 3. 最新一轮（用户刚发的那条）**永远保留**，哪怕它自己就超预算。
 */
export function trimHistory(
  messages: ChatMessage[],
  budget: number
): TrimHistoryResult {
  if (messages.length === 0) return { kept: [], dropped: 0 }

  const turns = splitTurns(messages)
  const keptTurns: ChatMessage[][] = []
  let used = 0
  let dropped = 0

  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]
    const size = turn.reduce((sum, message) => sum + message.content.length, 0)
    const isNewest = index === turns.length - 1

    if (!isNewest && used + size > budget) {
      // 更早的轮次一并丢弃，保持连续
      for (let older = 0; older <= index; older++) {
        dropped += turns[older].length
      }
      break
    }

    keptTurns.unshift(turn)
    used += size
  }

  return { kept: keptTurns.flat(), dropped }
}

/** 把消息切成「轮」：一条 user 消息开启一轮，其后的 assistant 消息归入同一轮 */
function splitTurns(messages: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = []
  let current: ChatMessage[] = []

  for (const message of messages) {
    if (message.role === 'user' && current.length > 0) {
      turns.push(current)
      current = []
    }
    current.push(message)
  }
  if (current.length > 0) turns.push(current)

  return turns
}

/**
 * 裁剪后追加到系统提示词的说明。
 *
 * 关键点：**明说**更早的对话没带上。模型如果以为自己还记得，
 * 就会编出「你上次说过的那件事」——那比直接承认失忆危险得多。
 */
export function trimmedHistoryNotice(dropped: number): string {
  return `（本次只携带了最近的部分对话，更早的 ${dropped} 条消息因超出上下文长度未包含。）`
}
