import { randomUUID } from 'node:crypto'
import type {
  AgentQuestion,
  AgentQuestionAnswer,
  AgentQuestionRequest
} from '../../../shared/agent-session'
import type { NativeCodingSession } from './adapter'
import { CodingAgentError } from './adapter'
import { acpObject } from './stdio-rpc-connection'
import { validateQuestionValues } from './agent-elicitation'

/** 仅接受已知的小型问答结构，原生对象和回调留在主进程。 */
export function nativeQuestions(
  value: unknown,
  flavor: 'claude' | 'codex'
): { questions: AgentQuestion[]; keys: string[] } {
  if (!Array.isArray(value) || !value.length || value.length > 4)
    throw new CodingAgentError('原生问题格式暂不支持，请在原生客户端继续')
  const keys: string[] = []
  const questions = value.map((raw, index): AgentQuestion => {
    const item = acpObject(raw)
    const text = item?.question
    const key = flavor === 'claude' ? text : item?.id
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 4000 ||
      typeof key !== 'string' ||
      !key ||
      key.length > 4000 ||
      item?.isSecret === true
    )
      throw new CodingAgentError('原生问题格式暂不支持，或需要在原生客户端输入秘密信息')
    if (keys.includes(key)) throw new CodingAgentError('原生问题标识重复，请在原生客户端继续')
    keys.push(key)
    const options: AgentQuestion['options'] = []
    if (item?.options !== undefined) {
      if (!Array.isArray(item.options) || item.options.length > 12)
        throw new CodingAgentError('原生问题选项过多或格式无效')
      for (const rawOption of item.options) {
        const option = acpObject(rawOption)
        if (
          typeof option?.label !== 'string' ||
          !option.label.trim() ||
          option.label.length > 500 ||
          options.some((old) => old.label === option.label)
        )
          throw new CodingAgentError('原生问题选项无效')
        options.push({
          label: option.label,
          description:
            typeof option.description === 'string' ? option.description.slice(0, 1000) : ''
        })
      }
    }
    return {
      id: `q${index}`,
      title: typeof item?.header === 'string' ? item.header.slice(0, 100) : `问题 ${index + 1}`,
      text,
      multiple: flavor === 'claude' && item?.multiSelect === true,
      allowText: flavor === 'claude' || !options.length || item?.isOther === true,
      options
    }
  })
  return { questions, keys }
}

/** 问答回调绑定原会话，取消、超时和原生结算都会释放它。 */
export class AgentQuestions {
  private pending = new Map<
    string,
    {
      session: NativeCodingSession
      request: AgentQuestionRequest
      settle(answer: AgentQuestionAnswer): void
    }
  >()
  constructor(private readonly publish: (session: NativeCodingSession) => void) {}

  ask(
    session: NativeCodingSession,
    request: Omit<AgentQuestionRequest, 'id'>,
    signal?: AbortSignal
  ): Promise<AgentQuestionAnswer> {
    if (this.pending.size >= 8) throw new CodingAgentError('待回答请求过多，请先处理已有问题')
    const id = randomUUID()
    return new Promise((resolve) => {
      const cancel = (): void => settle({ requestId: id, cancelled: true, answers: [] })
      const timer = setTimeout(cancel, 5 * 60_000)
      timer.unref()
      const settle = (answer: AgentQuestionAnswer): void => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        session.questions = session.questions?.filter((item) => item.id !== id)
        this.publish(session)
        resolve(answer)
      }
      const view = { ...request, id }
      this.pending.set(id, { session, request: view, settle })
      session.questions = [...(session.questions ?? []), view]
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) cancel()
      else this.publish(session)
    })
  }

  answer(sessionId: string, answer: AgentQuestionAnswer): void {
    const entry = this.pending.get(answer.requestId)
    if (!entry || entry.session.id !== sessionId)
      throw new CodingAgentError('问题已失效或不属于当前会话')
    if (!answer.cancelled) {
      if (answer.answers.length !== entry.request.questions.length)
        throw new CodingAgentError('请回答全部问题')
      for (const question of entry.request.questions) {
        const item = answer.answers.filter((item) => item.questionId === question.id)
        const values = item[0]?.values
        if (item.length !== 1 || !values)
          throw new CodingAgentError('答案不符合原生问题要求，请重新选择')
        validateQuestionValues(question, values)
      }
    }
    entry.settle(answer)
  }

  cancel(sessionId?: string): void {
    for (const [id, entry] of this.pending)
      if (!sessionId || entry.session.id === sessionId)
        entry.settle({ requestId: id, cancelled: true, answers: [] })
  }

  cancelRequest(id: string): void {
    this.pending.get(id)?.settle({ requestId: id, cancelled: true, answers: [] })
  }
}
