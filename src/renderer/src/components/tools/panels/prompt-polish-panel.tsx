import { useEffect } from 'react'
import type { JSX } from 'react'
import { usePromptStore } from '../../../stores/prompt-store'
import { usePromptPolishStore } from '../../../stores/prompt-polish-store'
import { useToolTransferStore } from '../../../stores/tool-transfer-store'
import { Dropdown } from '../../dropdown'
import { Workbench } from '../workbench'
import { ToolOutputActions } from '../output-actions'

export function PromptPolishPanel(): JSX.Element {
  const input = usePromptPolishStore((state) => state.input)
  const title = usePromptPolishStore((state) => state.title)
  const output = usePromptPolishStore((state) => state.output)
  const preview = usePromptPolishStore((state) => state.preview)
  const stopping = usePromptPolishStore((state) => state.stopping)
  const stop = usePromptPolishStore((state) => state.stop)
  const busy = usePromptPolishStore((state) => state.busy)
  const error = usePromptPolishStore((state) => state.error)
  const setInput = usePromptPolishStore((state) => state.setInput)
  const run = usePromptPolishStore((state) => state.run)
  const templates = usePromptStore((state) => state.templates)
  const load = usePromptStore((state) => state.load)
  const pending = useToolTransferStore((state) => state.pending)
  const transfer = useToolTransferStore((state) => state.send)
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (pending?.target !== 'prompt-polish') return
    setInput(pending.text, pending.other ?? '')
    useToolTransferStore.getState().consume(pending.sequence)
  }, [pending, setInput])
  return (
    <div className="tool-stack">
      <div className="tool-controls">
        <Dropdown
          ariaLabel="载入待润色模板"
          value=""
          placeholder="从 Prompt 模板载入"
          options={templates.map((item) => ({ value: item.id, label: item.title }))}
          onChange={(id) => {
            const template = templates.find((item) => item.id === id)
            if (
              !template ||
              (input.trim() && input !== template.body && !window.confirm('替换当前待润色提示词？'))
            )
              return
            setInput(template.body, template.title)
          }}
          disabled={busy}
          searchable
          align="left"
        />
        <button
          type="button"
          className="btn-gold"
          disabled={busy || !input.trim() || input.length > 12000}
          onClick={() => void run()}
        >
          {busy ? 'AI 润色中…' : '开始 AI 润色'}
        </button>
        {busy ? (
          <button
            type="button"
            className="btn-ghost"
            disabled={stopping}
            onClick={() => void stop()}
          >
            {stopping ? '正在停止…' : '停止润色'}
          </button>
        ) : null}
        <span className="field-hint">{input.length.toLocaleString()}/12,000 字符</span>
      </div>
      <p className="field-hint">
        使用设置中当前启用的 AI 配置，点击后发送原文；不会执行提示词中的任务。
        模板变量原样保留，输入和结果仅在本次应用中保留。
      </p>
      {title ? <p className="field-hint">模板来源：{title}</p> : null}
      {busy ? (
        <p className="field-hint" role="status">
          {stopping ? '正在停止生成…' : '正在流式生成，完成变量校验后可使用结果'}
        </p>
      ) : null}
      <Workbench
        inputLabel="待美化的提示词"
        outputLabel="AI 润色结果"
        value={input}
        onChange={(text) => setInput(text)}
        output={busy ? preview : output}
        outputPending={busy}
        error={error}
        placeholder="输入提示词，或从 Prompt 模板库载入正文；支持 {{变量名}}"
      />
      {output ? (
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={() =>
            transfer('prompt-template', output, `${title || '提示词'}（润色）`.slice(0, 60))
          }
        >
          转为新模板草稿
        </button>
      ) : null}
      {output.includes('{{') ? (
        <p className="field-hint">含变量的结果请先转为模板并填写变量，再发送给 AI。</p>
      ) : null}
      <ToolOutputActions
        text={output}
        title="提示词美化"
        offerPrompt={false}
        processingHint="AI 润色结果；放入草稿不会再次发送"
      />
    </div>
  )
}
