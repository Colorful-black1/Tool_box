import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { cleanJavaLog } from '@shared/java-log-tools'
import { useToolTransferStore } from '../../../stores/tool-transfer-store'
import { Workbench } from '../workbench'
import { ToolOutputActions } from '../output-actions'

export function JavaLogPanel(): JSX.Element {
  const [input, setInput] = useState('')
  const [expandEscapes, setExpandEscapes] = useState(false)
  const [collapseRepeated, setCollapseRepeated] = useState(true)
  const [traceId, setTraceId] = useState('')
  const pending = useToolTransferStore((state) => state.pending)
  useEffect(() => {
    if (pending?.target !== 'java-log') return
    setInput(pending.text)
    useToolTransferStore.getState().consume(pending.sequence)
  }, [pending])
  const result = useMemo(() => {
    try {
      return { data: cleanJavaLog(input, { expandEscapes, collapseRepeated, traceId }) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '日志整理失败' }
    }
  }, [input, expandEscapes, collapseRepeated, traceId])
  return (
    <div className="tool-stack">
      <div className="tool-controls">
        <label className="tool-check">
          <input
            type="checkbox"
            checked={expandEscapes}
            onChange={(event) => setExpandEscapes(event.target.checked)}
          />
          展开转义换行
        </label>
        <label className="tool-check">
          <input
            type="checkbox"
            checked={collapseRepeated}
            onChange={(event) => setCollapseRepeated(event.target.checked)}
          />
          折叠连续重复行
        </label>
        <label className="tool-inline-field">
          traceId
          <input
            className="field-input"
            aria-label="筛选 traceId"
            maxLength={200}
            value={traceId}
            onChange={(event) => setTraceId(event.target.value)}
            placeholder="留空显示全部"
          />
        </label>
      </div>
      <span className="field-hint">
        清理 ANSI 颜色 · 折叠 {result.data?.collapsed ?? 0} 行
        {traceId.trim() ? ` · 命中 ${result.data?.matchedRecords ?? 0} 条记录` : ''}
      </span>
      <Workbench
        inputLabel="原始日志"
        outputLabel="整理结果"
        value={input}
        onChange={setInput}
        output={result.data?.output ?? ''}
        error={result.error}
        placeholder="粘贴 Java 异常或服务日志"
      />
      {result.data?.causes.length ? (
        <section className="tool-log-causes" aria-label="异常链">
          <h3 className="tool-io-label">异常链</h3>
          {result.data.causes.map((cause, index) => (
            <pre key={index}>{cause}</pre>
          ))}
        </section>
      ) : null}
      <ToolOutputActions text={result.data?.output ?? ''} title="Java 日志整理" />
    </div>
  )
}
