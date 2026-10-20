import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, JSX } from 'react'

import { AI_PROVIDER_PRESETS, findAiProvider } from '@shared/types'
import type {
  AiConfigView,
  AiModelSource,
  AiProfileInput,
  AiProfileView,
  AiProviderId
} from '@shared/types'
import { applyModelToggle } from '@shared/model-list'
import { useAppStore } from '../stores/app-store'

/** 表单草稿：与落盘档案解耦，未保存的修改不会污染 store */
interface ProfileDraft {
  id: string | null
  name: string
  provider: AiProviderId
  baseUrl: string
  model: string
  apiKey: string
  /** 勾选的模型清单：只有这些会出现在对话下拉里 */
  selectedModels: string[]
}

type SaveStatus =
  | { type: 'idle' }
  | { type: 'saving' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }

/** 拉取模型列表的结果 */
interface ModelListState {
  count: number
  /** remote = 供应商实时列表；preset = 降级为内置推荐 */
  source: AiModelSource
  /** 降级原因（已脱敏） */
  message?: string
}

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
  const saveProfile = useAppStore((state) => state.saveProfile)
  const removeProfile = useAppStore((state) => state.removeProfile)
  const activateProfile = useAppStore((state) => state.activateProfile)
  const fetchModels = useAppStore((state) => state.fetchModels)

  // 草稿是表单的唯一真相源：档案列表高亮直接由 draft.id 推导，
  // 避免用 selectedId 另存一份状态后与草稿不同步。
  const [draft, setDraft] = useState<ProfileDraft | null>(() =>
    toDraft(settings.profiles.find((item) => item.id === settings.activeId) ?? null)
  )
  const [status, setStatus] = useState<SaveStatus>({ type: 'idle' })
  /** 拉取模型列表的结果：数量 + 来源（实时 / 降级）+ 原因 */
  const [modelList, setModelList] = useState<ModelListState | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  /** 最近一次拉到的模型（候选清单的一部分） */
  const [fetchedModels, setFetchedModels] = useState<string[]>([])

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

  const openProfile = (profile: AiProfileView): void => {
    setDraft(toDraft(profile))
    setStatus({ type: 'idle' })
    // 换档案时清掉上一套的拉取结果与提示
    setFetchedModels([])
    setModelList(null)
  }

  /** 新建草稿：以首个内置供应商为默认值，Key 留空（id 为 null 表示尚未落盘） */
  const startNew = (): void => {
    const preset = AI_PROVIDER_PRESETS[0]
    const defaultModel = preset.models[0] ?? ''
    setDraft({
      id: null,
      name: preset.name,
      provider: preset.id,
      baseUrl: preset.baseUrl,
      model: defaultModel,
      apiKey: '',
      // 默认勾上推荐模型：新配置保存后对话下拉直接可用
      selectedModels: defaultModel ? [defaultModel] : []
    })
    setStatus({ type: 'idle' })
    setFetchedModels([])
    setModelList(null)
  }

  /** 切换供应商：自动填入官方端点与首个推荐模型（模型仅供默认值，界面不在设置页选择） */
  const pickProvider = (provider: AiProviderId): void => {
    const preset = findAiProvider(provider)
    const defaultModel = preset.models[0] ?? ''
    setDraft((current) =>
      current
        ? {
            ...current,
            provider,
            baseUrl: preset.baseUrl || current.baseUrl,
            model: defaultModel,
            name: current.id ? current.name : preset.name,
            // 勾选清单跟着供应商走：上一个供应商的模型在这里多半不存在
            selectedModels: defaultModel ? [defaultModel] : []
          }
        : current
    )
    // 上一个供应商的实时列表对新供应商无意义
    setFetchedModels([])
    setModelList(null)
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
      apiKey: draft.apiKey.trim() ? draft.apiKey.trim() : undefined,
      selectedModels: draft.selectedModels
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

  /**
   * 拉取该供应商当前的模型列表。
   *
   * 这是「当场验证 Key 是否有效」的最快方式：远端能列出来就说明 Key 与地址都对，
   * 列不出来时主进程会降级为内置推荐并给出原因，这里原样显示。
   *
   * 拉到的模型只进「候选清单」，勾选哪些由用户决定 —— 供应商目录动辄三四十个，
   * 全塞进对话下拉既难看又难找。
   */
  const onFetchModels = async (): Promise<void> => {
    if (!draft || loadingModels) return
    setLoadingModels(true)
    setModelList(null)
    try {
      const result = await fetchModels({
        profileId: draft.id ?? undefined,
        provider: draft.provider,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey.trim() ? draft.apiKey.trim() : undefined
      })
      setFetchedModels(result.models)
      setModelList({
        count: result.models.length,
        source: result.source,
        message: result.message
      })
      // 实时列表拉到了就把模型名填进草稿，省得再去对话页选一次
      if (result.source === 'remote' && result.models.length > 0 && !draft.model) {
        patchDraft({ model: result.models[0] })
      }
    } catch (error) {
      setModelList({
        count: 0,
        source: 'preset',
        message: error instanceof Error ? error.message : '获取失败'
      })
    } finally {
      setLoadingModels(false)
    }
  }

  /**
   * 勾选 / 取消勾选一个模型。
   *
   * 勾选清单同时决定「对话下拉里有哪些」与「当前用哪个」：
   * 勾上一个 → 当前模型切过去（勾哪个用哪个）；
   * 取消勾选当前正在用的模型 → 顺延到清单里剩下的第一个。
   */
  const toggleModel = (name: string): void => {
    if (!draft) return
    const next = applyModelToggle(draft.model, draft.selectedModels, name)
    patchDraft({ selectedModels: next.selectedModels, model: next.model })
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

  /**
   * 候选清单：拉到的实时列表 + 供应商内置推荐 + 已勾选的 + 当前正在用的。
   *
   * 去重后作为多选列表的条目 —— 任何时候都能看到并调整已有的勾选，
   * 不必为了改一个勾选重新拉一次接口。
   */
  const candidates: string[] = []
  const seenCandidates = new Set<string>()
  const pushCandidate = (name: string): void => {
    const value = name.trim()
    if (!value || seenCandidates.has(value)) return
    seenCandidates.add(value)
    candidates.push(value)
  }
  for (const name of fetchedModels) pushCandidate(name)
  for (const name of findAiProvider(draft?.provider ?? 'custom').models) pushCandidate(name)
  for (const name of draft?.selectedModels ?? []) pushCandidate(name)
  if (draft?.model) pushCandidate(draft.model)

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
                  <span className="profile-item-name" title={profile.name}>
                    {profile.name}
                  </span>
                  <span className="profile-item-meta">
                    {findAiProvider(profile.provider).name} · {profile.model || '未选模型'}
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
                  选好供应商、填入 API Key 即可保存。下面勾选常用的几个模型，它们才会出现在「对话」页的下拉里。
                </p>
              </div>

              <div>
                <label className="field-label" htmlFor="profile-model">
                  当前模型 · MODEL
                </label>
                <input
                  id="profile-model"
                  className="field-input"
                  type="text"
                  value={draft.model}
                  placeholder="gpt-6-luna"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => patchDraft({ model: event.target.value })}
                />
                <p className="field-hint">
                  实际发请求用的模型；下面勾选任一模型会自动切到它。自定义供应商可直接手填模型名。
                </p>
              </div>

              <div>
                <label className="field-label" htmlFor="model-fetch">
                  模型列表 · MODELS
                </label>
                <div className="model-fetch-row">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={loadingModels}
                    onClick={() => void onFetchModels()}
                  >
                    {loadingModels ? '获取中…' : '获取模型列表'}
                  </button>
                  {modelList ? (
                    <span
                      className={`field-hint${modelList.source === 'remote' ? '' : ' warn'}`}
                      role="status"
                    >
                      {modelList.source === 'remote'
                        ? `供应商实时列表 ${modelList.count} 个`
                        : `未能获取实时列表（${modelList.message ?? '未知原因'}），已列出内置推荐`}
                    </span>
                  ) : (
                    <span className="field-hint">
                      拉取该供应商当前可用的模型；拉不到时回落到内置推荐并说明原因。
                    </span>
                  )}
                </div>

                <div className="model-pick">
                  <div className="model-pick-head">
                    <span className="field-hint">
                      已选 {draft.selectedModels.length} 个 · 勾选的模型会出现在对话下拉里，勾上即切为当前模型
                    </span>
                    <span className="model-pick-ops">
                      <button
                        type="button"
                        className="btn-ghost btn-mini"
                        onClick={() => patchDraft({ selectedModels: candidates })}
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-mini"
                        onClick={() => patchDraft({ selectedModels: [] })}
                      >
                        清空
                      </button>
                    </span>
                  </div>
                  <div className="model-pick-list">
                    {candidates.map((name) => {
                      const checked = draft.selectedModels.includes(name)
                      return (
                        <button
                          key={name}
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          className={`model-pick-item${checked ? ' on' : ''}`}
                          onClick={() => toggleModel(name)}
                        >
                          <span className="model-check" aria-hidden="true">
                            {checked ? '✓' : ''}
                          </span>
                          <span className="model-pick-name">{name}</span>
                          {name === draft.model ? (
                            <span className="model-pick-current">当前</span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
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
    apiKey: '',
    selectedModels: profile.selectedModels ?? []
  }
}
