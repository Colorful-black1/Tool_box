import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { compareJson, compareText } from '@shared/diff-tools'
import { Dropdown } from '../../dropdown'
import { useToolTransferStore } from '../../../stores/tool-transfer-store'
import { AutoTextarea } from '../auto-textarea'
import { CopyButton } from '../workbench'
import { ToolOutputActions } from '../output-actions'

export function DiffPanel(): JSX.Element {
  const [before, setBefore] = useState('')
  const [after, setAfter] = useState('')
  const [mode, setMode] = useState<'text' | 'json'>('text')
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
  const [ignoredKeys, setIgnoredKeys] = useState('')
  const pending = useToolTransferStore((state) => state.pending)
  useEffect(() => {
    if (pending?.target !== 'diff') return
    setBefore(pending.text)
    setAfter(pending.other ?? '')
    setMode(pending.mode ?? 'text')
    useToolTransferStore.getState().consume(pending.sequence)
  }, [pending])
  const result = useMemo(() => {
    try {
      if (mode === 'json')
        return {
          json: compareJson(
            before,
            after,
            ignoredKeys
              .split(/[,，]/)
              .map((key) => key.trim())
              .filter(Boolean)
          )
        }
      return { text: compareText(before, after, ignoreWhitespace) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '比较失败' }
    }
  }, [before, after, mode, ignoreWhitespace, ignoredKeys])
  const summary = result.json
    ? result.json.changes
        .map(
          (change) =>
            `${change.kind === 'added' ? '+' : change.kind === 'removed' ? '-' : '~'} ${change.path}\n- ${change.before}\n+ ${change.after}`
        )
        .join('\n')
    : (result.text?.lines
        .filter((line) => line.kind !== 'same')
        .map((line) => `${line.kind === 'added' ? '+' : '-'} ${line.text}`)
        .join('\n') ?? '')
  const changed =
    result.json?.changes.length ??
    result.text?.lines.filter((line) => line.kind !== 'same').length ??
    0

  return (
    <div className="tool-stack">
      <div className="tool-controls">
        <Dropdown
          ariaLabel="比较方式"
          value={mode}
          options={[
            { value: 'text', label: '文本逐行' },
            { value: 'json', label: 'JSON 字段' }
          ]}
          onChange={(value) => setMode(value as 'text' | 'json')}
        />
        {mode === 'text' ? (
          <label className="tool-check">
            <input
              type="checkbox"
              checked={ignoreWhitespace}
              onChange={(event) => setIgnoreWhitespace(event.target.checked)}
            />
            忽略空白字符
          </label>
        ) : (
          <label className="tool-inline-field">
            忽略字段名
            <input
              className="field-input"
              aria-label="忽略字段名"
              value={ignoredKeys}
              maxLength={1000}
              placeholder="updatedAt, traceId"
              onChange={(event) => setIgnoredKeys(event.target.value)}
            />
          </label>
        )}
      </div>
      <div className="tool-workbench">
        <label className="tool-io">
          <span className="tool-io-label">原始内容</span>
          <AutoTextarea
            className="field-input tool-input"
            ariaLabel="原始内容"
            value={before}
            onChange={setBefore}
          />
        </label>
        <label className="tool-io">
          <span className="tool-io-label">修改后内容</span>
          <AutoTextarea
            className="field-input tool-input"
            ariaLabel="修改后内容"
            value={after}
            onChange={setAfter}
          />
        </label>
      </div>
      <p className="field-hint">
        {mode === 'json'
          ? '忽略对象字段顺序，保留数组顺序；忽略字段名作用于所有层级，数字按原文比较。'
          : '按行比较，保留两侧行号；大文本会使用分段比较。'}
      </p>
      {result.error ? (
        <div className="tool-error" role="alert">
          {result.error}
        </div>
      ) : (
        <>
          <div className="tool-controls">
            <span className="tool-io-label" role="status">
              {changed ? `${changed} 项差异` : '内容一致'}
            </span>
            <CopyButton text={summary} label="复制差异" />
          </div>
          {result.text?.coarse || result.json?.truncated ? (
            <p className="field-hint">
              {result.text?.coarse
                ? '内容较多，采用公共前后缀与替换块比较。'
                : '达到 300 项差异上限，剩余内容未继续比较。'}
            </p>
          ) : null}
          <div className="tool-diff" aria-label="差异结果">
            {result.json?.changes.map((change, index) => (
              <div className={`tool-diff-entry ${change.kind}`} key={index}>
                <strong>
                  {change.kind === 'added' ? '新增' : change.kind === 'removed' ? '删除' : '修改'} ·{' '}
                  {change.path}
                </strong>
                {change.kind !== 'added' ? <pre>− {change.before}</pre> : null}
                {change.kind !== 'removed' ? <pre>＋ {change.after}</pre> : null}
              </div>
            ))}
            {result.text?.lines.slice(0, 500).map((line, index) => (
              <div className={`tool-diff-line ${line.kind}`} key={index}>
                <span>{line.beforeLine ?? ''}</span>
                <span>{line.afterLine ?? ''}</span>
                <code>
                  {line.kind === 'added' ? '＋' : line.kind === 'removed' ? '−' : ' '} {line.text}
                </code>
              </div>
            ))}
          </div>
          {(result.text?.lines.length ?? 0) > 500 ? (
            <p className="field-hint">仅显示前 500 行；复制差异包含全部变更行。</p>
          ) : null}
        </>
      )}
      <ToolOutputActions text={summary} title="差异比较" />
    </div>
  )
}
