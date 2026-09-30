import { useState } from 'react'
import type { FormEvent, JSX } from 'react'

import type { AiConfigInput, AiConfigView } from '@shared/types'
import { useAppStore } from '../stores/app-store'

interface FormState {
  baseUrl: string
  model: string
  apiKey: string
}

type SaveStatus =
  | { type: 'idle' }
  | { type: 'saving' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }

export function SettingsPage(): JSX.Element {
  const settings = useAppStore((state) => state.settings)

  if (!settings) {
    return (
      <div className="settings-layout" aria-busy="true" aria-label="设置加载中">
        <div className="glass settings-card">
          <div className="loading-skeleton" />
          <div className="loading-skeleton" />
        </div>
      </div>
    )
  }

  return <SettingsForm settings={settings} />
}

interface SettingsFormProps {
  settings: AiConfigView
}

function SettingsForm({ settings }: SettingsFormProps): JSX.Element {
  const saveSettings = useAppStore((state) => state.saveSettings)
  const [form, setForm] = useState<FormState>(() => ({
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: ''
  }))
  const [status, setStatus] = useState<SaveStatus>({ type: 'idle' })

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (status.type === 'saving') return

    const input: AiConfigInput = {
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: form.apiKey.trim() ? form.apiKey.trim() : undefined
    }

    setStatus({ type: 'saving' })
    try {
      await saveSettings(input)
      setForm((current) => ({ ...current, apiKey: '' }))
      setStatus({ type: 'success', message: '配置已保存' })
    } catch (error) {
      setStatus({
        type: 'error',
        message: error instanceof Error && error.message ? error.message : '保存失败'
      })
    }
  }

  return (
    <div className="settings-layout view-enter">
      <section className="glass settings-card" aria-label="AI 设置">
        <div className="sec-head">
          <h2 className="sec-title">星轨链路</h2>
        </div>

        {status.type === 'success' ? (
          <div className="status-banner success-banner" role="status">
            {status.message}
          </div>
        ) : null}
        {status.type === 'error' ? (
          <div className="status-banner" role="alert">
            {status.message}
          </div>
        ) : null}

        <form className="settings-grid" onSubmit={(event) => void handleSubmit(event)}>
          <div>
            <label className="field-label" htmlFor="base-url">
              接口地址 · BASE URL
            </label>
            <input
              id="base-url"
              className="field-input"
              type="text"
              value={form.baseUrl}
              placeholder="https://api.deepseek.com/v1"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) =>
                setForm((current) => ({ ...current, baseUrl: event.target.value }))
              }
            />
            <p className="field-hint">
              填写 OpenAI 兼容服务地址，通常会自动补全 /v1。
            </p>
          </div>

          <div>
            <label className="field-label" htmlFor="model-name">
              模型名称 · MODEL
            </label>
            <input
              id="model-name"
              className="field-input"
              type="text"
              value={form.model}
              placeholder="deepseek-chat"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) =>
                setForm((current) => ({ ...current, model: event.target.value }))
              }
            />
            <p className="field-hint">使用服务方提供的对话模型名称。</p>
          </div>

          <div>
            <label className="field-label" htmlFor="api-key">
              API Key
            </label>
            <input
              id="api-key"
              className="field-input"
              type="password"
              value={form.apiKey}
              placeholder={
                settings.hasApiKey ? '已加密保存，留空则不修改' : '请输入 API Key'
              }
              autoComplete="new-password"
              spellCheck={false}
              onChange={(event) =>
                setForm((current) => ({ ...current, apiKey: event.target.value }))
              }
            />
            <p className="field-hint">
              API Key 通过系统安全区加密后保存在本机，不会写入日志。
            </p>
          </div>

          <div>
            <button type="submit" className="btn-gold" disabled={status.type === 'saving'}>
              {status.type === 'saving' ? '保存中' : '保存配置'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
