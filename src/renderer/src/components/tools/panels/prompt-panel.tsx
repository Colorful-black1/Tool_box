import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { generateUuid } from '@shared/dev-tools'
import { fillPrompt, MAX_PROMPT_TEMPLATES, promptVariables } from '@shared/prompt-tools'
import { useAppStore } from '../../../stores/app-store'
import { usePromptStore } from '../../../stores/prompt-store'
import { useToolTransferStore } from '../../../stores/tool-transfer-store'
import { Dropdown } from '../../dropdown'
import { AutoTextarea } from '../auto-textarea'
import { ToolOutputActions } from '../output-actions'
import { CopyButton } from '../workbench'

const NEW_TEMPLATE_BODY = '请根据以下内容完成任务：\n\n{{context}}'

export function PromptPanel(): JSX.Element {
  const templates = usePromptStore((state) => state.templates)
  const loaded = usePromptStore((state) => state.loaded)
  const loading = usePromptStore((state) => state.loading)
  const saving = usePromptStore((state) => state.saving)
  const error = usePromptStore((state) => state.error)
  const load = usePromptStore((state) => state.load)
  const save = usePromptStore((state) => state.save)
  const pending = useToolTransferStore((state) => state.pending)
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? '')
  const selected = templates.find((item) => item.id === selectedId)
  const [draft, setDraft] = useState(() => ({
    id: selected?.id ?? '',
    title: selected?.title ?? '',
    body: selected?.body ?? '{{context}}'
  }))
  const [values, setValues] = useState<Record<string, string>>({})
  const [version, setVersion] = useState('current')
  const [status, setStatus] = useState('')
  const historical = version === 'current' ? undefined : selected?.versions[Number(version)]
  const body = historical?.body ?? draft.body
  const dirty = selected
    ? draft.title !== selected.title || draft.body !== selected.body
    : Boolean(draft.title.trim()) || draft.body !== NEW_TEMPLATE_BODY

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (selected) {
      setDraft({ id: selected.id, title: selected.title, body: selected.body })
      setVersion('current')
    }
  }, [selected])
  useEffect(() => {
    if (!loaded || selected || !selectedId) return
    setSelectedId(templates[0]?.id ?? '')
    if (!templates.length) setDraft({ id: generateUuid(), title: '', body: NEW_TEMPLATE_BODY })
  }, [loaded, selected, selectedId, templates])
  useEffect(() => {
    if (pending?.target === 'prompt-template') {
      setSelectedId('')
      setVersion('current')
      setDraft({ id: generateUuid(), title: pending.other ?? '润色后的提示词', body: pending.text })
      setStatus('已转为新模板草稿，请检查后手动保存；原模板保持不变')
      useToolTransferStore.getState().consume(pending.sequence)
      return
    }
    if (pending?.target !== 'prompt') return
    setValues((current) => ({ ...current, context: pending.text }))
    useToolTransferStore.getState().consume(pending.sequence)
  }, [pending])
  useEffect(() => {
    useAppStore.getState().setUnsavedChanges(dirty)
    return () => useAppStore.getState().setUnsavedChanges(false)
  }, [dirty])

  const generated = useMemo(() => {
    try {
      return { variables: promptVariables(body), output: fillPrompt(body, values) }
    } catch (error) {
      let variables: string[] = []
      try {
        variables = promptVariables(body)
      } catch {
        /* 变量过多时由下面的校验提示收敛。 */
      }
      return {
        variables,
        output: '',
        error: error instanceof Error ? error.message : '模板生成失败'
      }
    }
  }, [body, values])
  const permitSwitch = (): boolean =>
    !dirty || window.confirm('模板有未保存的修改，是否放弃这些修改？')
  const selectTemplate = (id: string): void => {
    if (id === selectedId || !permitSwitch()) return
    setSelectedId(id)
    setVersion('current')
    setStatus('')
  }
  const newTemplate = (): void => {
    if (!permitSwitch()) return
    setSelectedId('')
    setVersion('current')
    setDraft({ id: generateUuid(), title: '', body: NEW_TEMPLATE_BODY })
    setStatus('新模板尚未保存')
  }
  const saveTemplate = async (): Promise<void> => {
    const saved = await save(draft)
    if (saved) {
      setSelectedId(saved.id)
      setStatus('模板已保存；变量值未保存')
    }
  }
  const compareVersion = (): void => {
    const previous = historical ?? selected?.versions[0]
    if (!previous || !selected || !permitSwitch()) return
    useToolTransferStore.getState().send('diff', previous.body, selected.body, 'text')
  }

  return (
    <div className="tool-stack">
      <div className="tool-controls">
        <Dropdown
          ariaLabel="选择 Prompt 模板"
          value={selectedId}
          options={templates.map((template) => ({ value: template.id, label: template.title }))}
          onChange={selectTemplate}
          disabled={saving}
          searchable
        />
        <button
          type="button"
          className="btn-ghost"
          disabled={saving || !loaded || templates.length >= MAX_PROMPT_TEMPLATES}
          onClick={newTemplate}
        >
          新建模板
        </button>
        <button
          type="button"
          className="btn-gold"
          disabled={!loaded || saving || Boolean(historical)}
          onClick={() => void saveTemplate()}
        >
          {saving ? '保存中…' : selected ? '保存新版本' : '保存模板'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={saving || !body.trim()}
          onClick={() => {
            if (permitSwitch())
              useToolTransferStore
                .getState()
                .send('prompt-polish', body, historical?.title ?? draft.title)
          }}
        >
          美化模板正文
        </button>
      </div>
      {error ? (
        <div className="status-banner" role="alert">
          <span>{error}</span>
          {!loaded ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={loading}
              onClick={() => void load()}
            >
              {loading ? '读取中…' : '重试读取'}
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="field-hint">
        只保存模板正文和最近 6 个历史版本；填写的日志与变量值不保存。支持 {'{{变量名}}'}
        ，所有变量均需填写。
      </p>
      <label className="tool-inline-field">
        模板名称
        <input
          className="field-input"
          aria-label="模板名称"
          maxLength={60}
          value={historical?.title ?? draft.title}
          disabled={saving || Boolean(historical)}
          onChange={(event) => {
            setDraft((current) => ({ ...current, title: event.target.value }))
            setStatus('')
          }}
        />
      </label>
      <div className="tool-controls">
        <Dropdown
          ariaLabel="模板版本"
          value={version}
          options={[
            { value: 'current', label: '当前版本' },
            ...(selected?.versions ?? []).map((entry, index) => ({
              value: String(index),
              label: `历史 ${index + 1} · ${entry.savedAtMs ? new Date(entry.savedAtMs).toLocaleString('zh-CN') : '内置初始版'}`
            }))
          ]}
          onChange={setVersion}
          disabled={saving || !selected}
        />
        <button
          type="button"
          className="btn-ghost"
          disabled={saving || !selected?.versions.length}
          onClick={compareVersion}
        >
          与历史版本比较
        </button>
        {historical ? (
          <button
            type="button"
            className="btn-ghost"
            disabled={saving}
            onClick={() => {
              if (!permitSwitch()) return
              setDraft((current) => ({
                ...current,
                title: historical.title,
                body: historical.body
              }))
              setVersion('current')
              setStatus('已采用历史内容，保存后生成新版本')
            }}
          >
            采用此版本
          </button>
        ) : null}
      </div>
      <div className="tool-workbench">
        <label className="tool-io">
          <span className="tool-io-label">模板正文{historical ? ' · 历史只读' : ''}</span>
          <AutoTextarea
            className="field-input tool-input"
            ariaLabel="模板正文"
            value={body}
            readOnly={saving || Boolean(historical)}
            onChange={(value) => {
              setDraft((current) => ({ ...current, body: value }))
              setStatus('')
            }}
          />
        </label>
        <div className="tool-io">
          <span className="tool-io-label">填写变量</span>
          {generated.variables.map((name) => (
            <label className="tool-io" key={name}>
              <span className="field-label">
                {name === 'context' ? '待分析内容 · context' : name}
              </span>
              <AutoTextarea
                className="field-input tool-input"
                minHeight={100}
                maxHeight={220}
                ariaLabel={`变量 ${name}`}
                value={Object.hasOwn(values, name) ? values[name] : ''}
                onChange={(value) => setValues((current) => ({ ...current, [name]: value }))}
              />
            </label>
          ))}
          {!generated.variables.length ? (
            <p className="field-hint">此模板没有变量，正文将直接作为 Prompt。</p>
          ) : null}
        </div>
      </div>
      <section className="tool-io">
        <header className="tool-io-head">
          <span className="tool-io-label">生成的 Prompt</span>
          <CopyButton text={generated.output} />
          <button
            type="button"
            className="btn-ghost"
            disabled={!generated.output || saving}
            onClick={() => {
              if (permitSwitch())
                useToolTransferStore.getState().send('prompt-polish', generated.output, draft.title)
            }}
          >
            美化生成的 Prompt
          </button>
        </header>
        {generated.error ? (
          <p className="field-hint" role="status">
            {generated.error}
          </p>
        ) : null}
        <AutoTextarea
          className="field-input tool-input tool-output"
          ariaLabel="生成的 Prompt"
          value={generated.output}
          readOnly
        />
      </section>
      <ToolOutputActions
        text={generated.output}
        title={draft.title || 'Prompt'}
        offerPrompt={false}
      />
      {status ? (
        <p className="field-hint" role="status">
          {status}
        </p>
      ) : null}
    </div>
  )
}
