/**
 * 编码 / 解码工具：Base64 与 URL 百分号编码。
 *
 * 两者都是「一段文本进、一段文本出」，共用一个面板。
 */
import { useMemo, useState } from 'react'
import type { JSX } from 'react'

import { decodeBase64, decodeUrl, encodeBase64, encodeUrl } from '@shared/dev-tools'

import { Workbench } from '../workbench'

export type EncodingKind = 'base64' | 'url'

export function EncodingPanel({ kind }: { kind: EncodingKind }): JSX.Element {
  const [input, setInput] = useState('')
  const [direction, setDirection] = useState<'encode' | 'decode'>('encode')

  const { output, error } = useMemo(() => {
    if (!input) return { output: '', error: undefined }
    try {
      if (kind === 'base64') {
        return { output: direction === 'encode' ? encodeBase64(input) : decodeBase64(input), error: undefined }
      }
      return { output: direction === 'encode' ? encodeUrl(input) : decodeUrl(input), error: undefined }
    } catch (convertError) {
      return {
        output: '',
        error: convertError instanceof Error ? convertError.message : '转换失败'
      }
    }
  }, [input, direction, kind])

  const label = kind === 'base64' ? 'Base64' : 'URL'

  return (
    <Workbench
      inputLabel={`${label} 输入`}
      outputLabel={`${label} 输出`}
      value={input}
      onChange={setInput}
      output={output}
      error={error}
      placeholder={direction === 'encode' ? '要编码的文本' : '要解码的文本'}
      actions={
        <span className="tool-segment">
          <button
            type="button"
            className={`tool-segment-item${direction === 'encode' ? ' active' : ''}`}
            onClick={() => setDirection('encode')}
          >
            编码
          </button>
          <button
            type="button"
            className={`tool-segment-item${direction === 'decode' ? ' active' : ''}`}
            onClick={() => setDirection('decode')}
          >
            解码
          </button>
        </span>
      }
    />
  )
}
