/**
 * JSON 工具：格式化 / 压缩。
 *
 * 解析失败时给出 JSON.parse 的原始错误信息（带位置），
 * 不吞异常也不显示栈。
 */
import { useMemo, useState } from 'react'
import type { JSX } from 'react'

import { formatJson, minifyJson } from '@shared/dev-tools'

import { Workbench } from '../workbench'

export function JsonPanel(): JSX.Element {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'format' | 'minify'>('format')

  const { output, error } = useMemo(() => {
    if (!input.trim()) return { output: '', error: undefined }
    const result = mode === 'format' ? formatJson(input) : minifyJson(input)
    return result.ok
      ? { output: result.output, error: undefined }
      : { output: '', error: result.error ?? 'JSON 解析失败' }
  }, [input, mode])

  return (
    <Workbench
      inputLabel="JSON 输入"
      outputLabel="处理结果"
      value={input}
      onChange={setInput}
      output={output}
      error={error}
      placeholder='{"hello": "world"}'
      actions={
        <span className="tool-segment">
          <button
            type="button"
            className={`tool-segment-item${mode === 'format' ? ' active' : ''}`}
            onClick={() => setMode('format')}
          >
            格式化
          </button>
          <button
            type="button"
            className={`tool-segment-item${mode === 'minify' ? ' active' : ''}`}
            onClick={() => setMode('minify')}
          >
            压缩
          </button>
        </span>
      }
    />
  )
}
