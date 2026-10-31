/**
 * JSON 工具箱：无损数字、排序、字符串展开和安全的常用路径提取。
 */
import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import { expandJsonStrings, extractJsonPath, formatLosslessJson } from '@shared/json-tools'
import { generateTypeScriptTypes } from '@shared/json-to-ts'

import { Dropdown } from '../../dropdown'
import { useToolTransferStore } from '../../../stores/tool-transfer-store'
import { Workbench } from '../workbench'
import { ToolOutputActions } from '../output-actions'

type JsonMode = 'format' | 'minify' | 'sort' | 'expand' | 'path' | 'types'
const MODES = [
  { value: 'format', label: '格式化' },
  { value: 'minify', label: '压缩' },
  { value: 'sort', label: '字段排序' },
  { value: 'expand', label: '解除转义 / 展开' },
  { value: 'path', label: 'JSONPath 提取' },
  { value: 'types', label: '生成 TS 类型' }
]

export function JsonPanel(): JSX.Element {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<JsonMode>('format')
  const [path, setPath] = useState('$.data[*].id')
  const pending = useToolTransferStore((state) => state.pending)
  useEffect(() => {
    if (pending?.target !== 'json') return
    setInput(pending.text)
    useToolTransferStore.getState().consume(pending.sequence)
  }, [pending])

  const { output, error } = useMemo(() => {
    if (!input.trim()) return { output: '', error: undefined }
    try {
      const output =
        mode === 'expand'
          ? expandJsonStrings(input)
          : mode === 'path'
            ? extractJsonPath(input, path)
            : mode === 'types'
              ? generateTypeScriptTypes(input)
              : formatLosslessJson(input, mode === 'minify' ? 0 : 2, mode === 'sort')
      return { output, error: undefined }
    } catch (error) {
      return { output: '', error: error instanceof Error ? error.message : 'JSON 处理失败' }
    }
  }, [input, mode, path])

  return (
    <div className="tool-stack">
      <div className="tool-controls">
        <Dropdown
          ariaLabel="JSON 操作"
          value={mode}
          options={MODES}
          onChange={(value) => setMode(value as JsonMode)}
        />
        <span className="field-hint">
          {mode === 'types'
            ? '对象生成 interface，同形状复用同一个类型 · 最多 20 万字符'
            : '保留长整数与小数原文 · 最多 20 万字符'}
        </span>
      </div>
      {mode === 'path' ? (
        <label className="tool-path-field">
          <span className="field-label">JSONPath</span>
          <input
            className="field-input"
            aria-label="JSONPath"
            value={path}
            maxLength={512}
            onChange={(event) => setPath(event.target.value)}
          />
          <span className="field-hint">支持 $.字段、$["带点的键"]、[0] 和 [*]；不执行表达式</span>
        </label>
      ) : null}
      <Workbench
        inputLabel="JSON 输入"
        outputLabel="处理结果"
        value={input}
        onChange={setInput}
        output={output}
        error={error}
        placeholder='{"hello": "world"}'
        actions={
          <button type="button" className="btn-ghost btn-mini" onClick={() => setInput('')}>
            清空
          </button>
        }
      />
      <ToolOutputActions text={output} title="JSON 处理" />
    </div>
  )
}
