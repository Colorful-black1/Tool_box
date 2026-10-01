import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, JSX } from 'react'

import { AI_PROVIDER_PRESETS, findAiProvider } from '@shared/types'
import type {
  AiConfigView,
  AiProfileInput,
  AiProfileView,
  AiProviderId
} from '@shared/types'
import { useAppStore } from '../stores/app-store'

/** 表单草稿：与落盘档案解耦，未保存的修改不会污染 store */
interface ProfileDraft {
  id: string | null
  name: string
  provider: AiProviderId
  baseUrl: string
  model: string
  apiKey: string
}

type SaveStatus =
  | { type: 'idle' }
  | { type: 'saving' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }

type ModelStatus =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'ready'; message: string }
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

function SettingsForm({ settings }: SettingsFormProps): JSX.Element {  const saveProfile = useAppStore((state) => state.saveProfile)
  const removeProfile = useAppStore((state) => state.removeProfile)
  const activateProfile = useAppStore((state) => state.activateProfile)
  const fetchModels = useAppStore((state) => state.fetchModels)

  // 草稿是表单的唯一真相源：档案列表高亮直接由 draft.id 推导，
  // 避免用 selectedId 另存一份状态后与草稿不同步。
  const [draft, setDraft] = useState<ProfileDraft | null>(() =>
    toDraft(settings.profiles.find((item) => item.id === settings.activeId) ?? null)
  )
  const [status, setStatus] = useState<SaveStatus>({ type: 'idle' })
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ type: 'idle' })
  const [models, setModels] = useState<string[]>([])
  const [manualModel, setManualModel] = useState(false)

  // 当前编辑的档案被外部删除时关闭草稿；新建草稿（id 为 null）不受影响
  useEffect(() => {
    if (!draft?.id) return
    if (settings.profiles.some((item) => item.id === draft.id)) return
    setDraft(null)
  }, [settings, draft])

  const activeProfile = useMemo(
    () => settings.profiles.find((item) => item.id === draft?.id) ?? null,
    [settings.profiles, draft?.id]
  )

  const patchDraft = (partial: Partial<ProfileDraft>): void => {
    setDraft((current) => (current ? { ...current, ...partial } : current))
  }

  const resetForm = (): void => {
    setStatus({ type: 'idle' })
    setModelStatus({ type: 'idle' })
    setModels([])
    setManualModel(false)
  }

  const openProfile = (profile: AiProfileView): void => {
    setDraft(toDraft(profile))
    resetForm()
  }

  /** 新建草稿：以首个内置供应商为默认值，Key 留空（id 为 null 表示尚未落盘） */
  const startNew = (): void => {
    const preset = AI_PROVIDER_PRESETS[0]
    setDraft({
      id: null,
      name: preset.name,
      provider: preset.id,
      baseUrl: preset.baseUrl,
      model: preset.models[0] ?? '',
      apiKey: ''
    })
    resetForm()
  }

  /** 切换供应商：自动填入官方端点与首个推荐模型，并清掉旧的模型下拉数据 */
  const pickProvider = (provider: AiProviderId): void => {
    const preset = findAiProvider(provider)
    setDraft((current) =>
      current
        ? {
            ...current,
            provider,
            baseUrl: preset.baseUrl || current.baseUrl,
            model: preset.models[0] ?? '',
            name: current.id ? current.name : preset.name
          }
        : current
    )
    setModels([])
    setManualModel(false)
    setModelStatus({ type: 'idle' })
  }

  const onFetchModels = async (): Promise<void> => {
    if (!draft || modelStatus.type === 'loading') return
    setModelStatus({ type: 'loading' })
    try {
      const result = await fetchModels({
        profileId: draft.id ?? undefined,
        provider: draft.provider,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey.trim() ? draft.apiKey.trim() : undefined
      })
      setModels(result.models)
      setManualModel(false)
      // 当前模型不在返回列表里（含未填的情况）时回落到第一个，避免下拉显示与实际值不符
      if (!result.models.includes(draft.model)) {
        patchDraft({ model: result.models[0] ?? draft.model })
      }
      setModelStatus({
        type: 'ready',
        message: result.message ?? `已获取 ${result.models.length} 个模型`
      })
    } catch (error) {
      setModelStatus({
        type: 'error',
        message: error instanceof Error && error.message ? error.message : '获取模型失败'
      })
    }
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!draft || status.type === 'saving') return

    const input: AiProfileInput = {
      id: draft.id ?? undefined,
      name: draft.name,
      provider: draft.provider,
      baseUrl: draft.baseUrl,
      model: draft.model,
      apiKey: draft.apiKey.trim() ? draft.apiKey.trim() : undefined
    }

    setStatus({ type: 'saving' })
    try {
      const knownIds = new Set(settings.profiles.map((item) => item.id))
      const next = await saveProfile(input)
      // 新建时主进程会把档案追加到末尾，用「新增项」反查真实 id，避免依赖数组位置
      const savedId =
        draft.id ?? next.profiles.find((item) => !knownIds.has(item.id))?.id ?? null
      setDraft((current) => (current ? { ...current, id: savedId, apiKey: '' } : current))
      setStatus({ type: 'success', message: '配置已保存' })
    } catch (error) {
      setStatus({
        type: 'error',
        message: error instanceof Error && error.message ? error.message : '保存失败'
      })
    }
  }

  const onDelete = async (): Promise<void> => {
    if (!draft?.id || status.type === 'saving') return
    setStatus({ type: 'saving' })
    try {
      await removeProfile(draft.id)
      setDraft(null)
      setStatus({ type: 'success', message: '配置已删除' })
    } catch (error) {
      setStatus({
        type: 'error',
        message: error instanceof Error && error.message ? error.message : '删除失败'
      })
    }
  }

  const onActivate = async (): Promise<void> => {
    if (!draft?.id || status.type === 'saving') return
    setStatus({ type: 'saving' })
    try {
      await activateProfile(draft.id)
      setStatus({ type: 'success', message: '已切换为当前使用中的配置' })
    } catch (error) {
      setStatus({
        type: 'error',
        message: error instanceof Error && error.message ? error.message : '切换失败'
      })
    }
  }

  return (
    <div className="settings-layout settings-layout-wide view-enter">
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

        <div className="settings-split">
          <aside className="profile-rail" aria-label="配置列表">
            <button type="button" className="btn-ghost" onClick={startNew}>
              + 新建配置
            </button>
            {settings.profiles.length === 0 ? (
              <p className="profile-rail-empty">还没有配置，点击上方新建。</p>
            ) : (
              settings.profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className={`profile-item${profile.id === draft?.id ? ' active' : ''}`}
                  onClick={() => openProfile(profile)}
                >
                  <span className="profile-item-name">{profile.name}</span>
                  <span className="profile-item-meta">
                    {findAiProvider(profile.provider).name} · {profile.model || '未填模型'}
                  </span>
                  {profile.id === settings.activeId ? (
                    <span className="profile-item-badge">使用中</span>
                  ) : null}
                </button>
              ))
            )}
          </aside>

          {draft ? (
            <form className="settings-grid" onSubmit={(event) => void onSubmit(event)}>
              <div>
                <label className="field-label" htmlFor="profile-provider">
                  供应商 · PROVIDER
                </label>
                <select
                  id="profile-provider"
                  className="field-select"
                  value={draft.provider}
                  onChange={(event) => pickProvider(event.target.value as AiProviderId)}
                >
                  {AI_PROVIDER_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  选择后自动填入官方接口地址；列表外的服务商请选「自定义」手填。
                </p>
              </div>

              <div>
                <label className="field-label" htmlFor="profile-name">
                  配置名称
                </label>
                <input
                  id="profile-name"
                  className="field-input"
                  type="text"
                  value={draft.name}
                  placeholder="例如：主力对话"
                  maxLength={24}
                  autoComplete="off"
                  onChange={(event) => patchDraft({ name: event.target.value })}
                />
                <p className="field-hint">仅用于本地区分多套配置，不影响请求。</p>
              </div>

              <div>
                <label className="field-label" htmlFor="base-url">
                  接口地址 · BASE URL
                </label>
                <input
                  id="base-url"
                  className="field-input"
                  type="text"
                  value={draft.baseUrl}
                  placeholder="https://api.deepseek.com/v1"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => patchDraft({ baseUrl: event.target.value })}
                />
                <p className="field-hint">OpenAI 兼容地址，通常会自动补全 /v1。</p>
              </div>

              <div>
                <div className="field-row-head">
                  <label className="field-label" htmlFor="model-select">
                    模型名称 · MODEL
                  </label>
                  <div className="toolbar-row">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={modelStatus.type === 'loading'}
                      onClick={() => void onFetchModels()}
                    >
                      {modelStatus.type === 'loading' ? '获取中' : '获取模型'}
                    </button>
                    {models.length > 0 ? (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setManualModel((value) => !value)}
                      >
                        {manualModel ? '用下拉选择' : '手动输入'}
                      </button>
                    ) : null}
                  </div>
                </div>

                {models.length > 0 && !manualModel ? (
                  <select
                    id="model-select"
                    className="field-select"
                    value={draft.model}
                    onChange={(event) => patchDraft({ model: event.target.value })}
                  >
                    {draft.model && !models.includes(draft.model) ? (
                      <option value={draft.model}>{draft.model}（当前值）</option>
                    ) : null}
                    {models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="model-select"
                    className="field-input"
                    type="text"
                    value={draft.model}
                    placeholder="deepseek-v4-pro"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => patchDraft({ model: event.target.value })}
                  />
                )}

                {modelStatus.type === 'ready' ? (
                  <p className="field-hint">{modelStatus.message}</p>
                ) : null}
                {modelStatus.type === 'error' ? (
                  <p className="field-hint" role="alert">
                    {modelStatus.message}
                  </p>
                ) : null}
                {modelStatus.type === 'idle' ? (
                  <p className="field-hint">
                    点「获取模型」从供应商接口拉取可用列表；拉取失败会自动回落到内置推荐模型。
                  </p>
                ) : null}
              </div>

              <div>
                <label className="field-label" htmlFor="api-key">
                  API Key
                </label>
                <input
                  id="api-key"
                  className="field-input"
                  type="password"
                  value={draft.apiKey}
                  placeholder={
                    activeProfile?.hasApiKey ? '已加密保存，留空则不修改' : '请输入 API Key'
                  }
                  autoComplete="new-password"
                  spellCheck={false}
                  onChange={(event) => patchDraft({ apiKey: event.target.value })}
                />
                <p className="field-hint">
                  API Key 通过系统安全区加密后保存在本机，不会写入日志。
                </p>
              </div>

              <div className="settings-actions">
                <button type="submit" className="btn-gold" disabled={status.type === 'saving'}>
                  {status.type === 'saving' ? '保存中' : '保存配置'}
                </button>
                {draft.id && draft.id !== settings.activeId ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={status.type === 'saving'}
                    onClick={() => void onActivate()}
                  >
                    设为使用中
                  </button>
                ) : null}
                {draft.id ? (
                  <button
                    type="button"
                    className="btn-ghost btn-danger"
                    disabled={status.type === 'saving'}
                    onClick={() => void onDelete()}
                  >
                    删除
                  </button>
                ) : null}
              </div>
            </form>
          ) : (
            <div className="settings-empty">
              <p>左侧选择一套配置进行编辑，或新建一套。</p>
              <p className="field-hint">
                启用中的配置才会被 AI 对话与密码箱识别功能使用。
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

/** 档案视图 → 表单草稿：Key 一律清空，已存 Key 只以占位提示呈现 */
function toDraft(profile: AiProfileView | null): ProfileDraft | null {
  if (!profile) return null
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey: ''
  }
}
