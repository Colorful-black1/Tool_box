import { useState } from 'react'
import type { JSX } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useToolTransferStore } from '../../stores/tool-transfer-store'
import { useCodingAgentStore as useOpenCodeStore } from '../../stores/coding-agent-store'

/** 所有外发/保存均由按钮触发；放入对话只填草稿，不调用发送接口。 */
export function ToolOutputActions({
  text,
  title,
  offerRedaction = true,
  offerPrompt = true,
  processingHint = '本机处理；由你点击发送 AI'
}: {
  text: string
  title: string
  offerRedaction?: boolean
  offerPrompt?: boolean
  processingHint?: string
}): JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; message: string } | null>(null)
  const status = feedback?.text === text ? feedback.message : ''
  const setStatus = (message: string): void => setFeedback({ text, message })
  const [savedText, setSavedText] = useState<string | null>(null)
  const transfer = useToolTransferStore((state) => state.send)
  if (!text) return null
  const canLeave = (): boolean =>
    !useAppStore.getState().hasUnsavedChanges ||
    window.confirm('当前模板有未保存的修改，是否放弃模板修改并继续？')
  const saveNote = async (): Promise<void> => {
    if (busy || !window.toolbox) {
      if (!window.toolbox) setStatus('桌面桥接未就绪，暂时无法保存笔记')
      return
    }
    setBusy(true)
    setStatus('')
    try {
      await useAppStore.getState().saveNote({ title: `${title}结果`.slice(0, 60), content: text })
      setSavedText(text)
      setStatus('已保存为新笔记')
    } catch {
      setStatus('保存笔记失败，请重试')
    } finally {
      setBusy(false)
    }
  }
  const fillChat = async (): Promise<void> => {
    if (busy || !canLeave()) return
    const state = useAppStore.getState()
    if (
      state.chatDraft.trim() &&
      state.chatDraft !== text &&
      !window.confirm('对话中已有未发送草稿，是否替换？')
    )
      return
    if (!window.toolbox) {
      setStatus('桌面桥接未就绪，暂时无法打开对话')
      return
    }
    setBusy(true)
    setStatus('')
    try {
      if (!state.activeConversationId) await state.createConversation()
      useAppStore.getState().setChatDraft(text)
      useAppStore.getState().setView('chat')
    } catch {
      setStatus('无法准备对话草稿，请重试')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="tool-result-actions">
      <div className="tool-controls">
        {offerRedaction ? (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => {
              if (canLeave()) transfer('redact', text)
            }}
          >
            用于脱敏
          </button>
        ) : null}
        {offerPrompt ? (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => {
              if (canLeave()) transfer('prompt', text)
            }}
          >
            填入 Prompt
          </button>
        ) : null}
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || savedText === text}
          onClick={() => void saveNote()}
        >
          {savedText === text ? '已保存笔记' : '保存为笔记'}
        </button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void fillChat()}>
          放入对话草稿
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={() => {
            if (!canLeave()) return
            const draft = useOpenCodeStore.getState().draft
            if (
              draft.trim() &&
              draft !== text &&
              !window.confirm('编程 Agent 中已有未发送草稿，是否替换？')
            )
              return
            useOpenCodeStore.getState().setDraft(text)
            useAppStore.getState().setView('opencode')
          }}
        >
          用于编程 Agent
        </button>
        <span className="field-hint">{processingHint}</span>
      </div>
      {status ? (
        <p className="field-hint" role="status">
          {status}
        </p>
      ) : null}
    </div>
  )
}
