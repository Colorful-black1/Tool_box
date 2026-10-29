import { useState } from 'react'
import type { JSX } from 'react'
import type { AgentQuestionRequest } from '@shared/agent-session'
import { useCodingAgentStore } from '../../stores/coding-agent-store'

/** 选项不自动提交；问题消失时此组件卸载，旧答案不进入下一次请求。 */
export function AgentQuestionCard({ request }: { request: AgentQuestionRequest }): JSX.Element {
  const answerQuestion = useCodingAgentStore((state) => state.answerQuestion)
  const [values, setValues] = useState<Record<string, string[]>>({})
  const [text, setText] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const answers = request.questions.map((question) => ({
    questionId: question.id,
    values: [
      ...(values[question.id] ?? []),
      ...(text[question.id]?.trim() ? [text[question.id].trim()] : [])
    ]
  }))
  const submit = async (cancelled: boolean): Promise<void> => {
    if (sending) return
    setSending(true)
    try {
      await answerQuestion({ requestId: request.id, cancelled, answers: cancelled ? [] : answers })
    } finally {
      setSending(false)
    }
  }
  return (
    <form
      className="opencode-approval agent-question-card"
      aria-label={request.title}
      onSubmit={(event) => {
        event.preventDefault()
        void submit(false)
      }}
    >
      <strong>{request.title}</strong>
      {request.questions.map((question) => (
        <fieldset key={question.id} disabled={sending}>
          <legend>
            {question.title}
            {question.multiple ? '（可多选）' : ''}
          </legend>
          <p>{question.text}</p>
          <div className="agent-question-options">
            {question.options.map((option) => {
              const selected = values[question.id]?.includes(option.label) ?? false
              return (
                <button
                  key={option.label}
                  type="button"
                  className="btn-ghost"
                  aria-pressed={selected}
                  onClick={() => {
                    setValues((old) => ({
                      ...old,
                      [question.id]: question.multiple
                        ? selected
                          ? (old[question.id] ?? []).filter((value) => value !== option.label)
                          : [...(old[question.id] ?? []), option.label]
                        : [option.label]
                    }))
                    if (!question.multiple) setText((old) => ({ ...old, [question.id]: '' }))
                  }}
                >
                  <span>{option.label}</span>
                  {option.description ? (
                    <span className="field-hint">{option.description}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
          {question.allowText ? (
            <label className="field-label">
              补充回答
              <input
                className="field-input"
                value={text[question.id] ?? ''}
                maxLength={4000}
                onChange={(event) => {
                  setText((old) => ({ ...old, [question.id]: event.target.value }))
                  if (!question.multiple) setValues((old) => ({ ...old, [question.id]: [] }))
                }}
              />
            </label>
          ) : null}
        </fieldset>
      ))}
      <div className="tool-controls">
        <button
          type="submit"
          className="btn-gold"
          disabled={sending || answers.some((answer) => !answer.values.length)}
        >
          提交回答
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={sending}
          onClick={() => void submit(true)}
        >
          取消本次请求
        </button>
      </div>
      <span className="field-hint">只回答这次原生请求，不批准后续工具操作。</span>
    </form>
  )
}
