import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { DEFAULT_REDACTION_RULES, redactData, REDACTION_LABELS } from '@shared/redaction-tools'
import type { RedactionKind } from '@shared/redaction-tools'
import { Dropdown } from '../../dropdown'
import { useToolTransferStore } from '../../../stores/tool-transfer-store'
import { Workbench } from '../workbench'
import { ToolOutputActions } from '../output-actions'

export function RedactionPanel(): JSX.Element {
  const [input, setInput] = useState('')
  const [rules, setRules] = useState({ ...DEFAULT_REDACTION_RULES })
  const [mode, setMode] = useState<'auto' | 'text' | 'json'>('auto')
  const pending = useToolTransferStore((state) => state.pending)
  useEffect(() => {
    if (pending?.target !== 'redact') return
    setInput(pending.text)
    useToolTransferStore.getState().consume(pending.sequence)
  }, [pending])
  const result = useMemo(() => {
    try {
      return { data: redactData(input, rules, mode) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '脱敏失败' }
    }
  }, [input, rules, mode])
  return (
    <div className="tool-stack">
      <div className="tool-controls">
        <Dropdown
          ariaLabel="脱敏输入类型"
          value={mode}
          options={[
            { value: 'auto', label: '自动识别' },
            { value: 'json', label: 'JSON 结构' },
            { value: 'text', label: '普通文本' }
          ]}
          onChange={(value) => setMode(value as typeof mode)}
        />
        {(Object.keys(REDACTION_LABELS) as RedactionKind[]).map((kind) => (
          <label className="tool-check" key={kind}>
            <input
              type="checkbox"
              checked={rules[kind]}
              onChange={(event) =>
                setRules((current) => ({ ...current, [kind]: event.target.checked }))
              }
            />
            {REDACTION_LABELS[kind]}
          </label>
        ))}
      </div>
      <p className="field-hint">
        本机规则识别，复制或发送前请检查结果。输入与替身映射不保存；数字候选可能需要关闭对应规则。
      </p>
      <div className="tool-controls">
        {(Object.keys(REDACTION_LABELS) as RedactionKind[]).map((kind) => (
          <span key={kind} className="field-hint">
            {REDACTION_LABELS[kind]} {result.data?.counts[kind] ?? 0} 处
          </span>
        ))}
      </div>
      <Workbench
        inputLabel="待脱敏内容"
        outputLabel="脱敏预览"
        value={input}
        onChange={setInput}
        output={result.data?.output ?? ''}
        error={result.error}
        placeholder="粘贴 JSON、日志或请求头"
      />
      <ToolOutputActions text={result.data?.output ?? ''} title="脱敏" offerRedaction={false} />
    </div>
  )
}
