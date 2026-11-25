import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import { AI_WORLD_AA_KEY_URL, AI_WORLD_AA_MODELS_URL } from '@shared/ai-world-aa'
import { AI_AGENT_ARENA_SOURCES } from '@shared/ai-agent-arena'
import { useModalFocus } from '../../lib/use-modal-focus'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'
import { formatAaQuota } from '../../lib/ai-world-aa-format'
import { useAiWorldAaStore } from '../../stores/ai-world-aa-store'
import { confirmDialog } from '../../stores/dialog-store'

interface AiWorldSourcesProps {
  onClose: () => void
  onOpenSource: (url: string) => void
  /** 从 AA 榜打开时直接展开 Key 配置。 */
  initialSection?: 'aa'
}

const SOURCES = [
  {
    label: 'models.dev',
    url: 'https://models.dev',
    note: '模型身份、价格、上下文与模态，MIT'
  },
  {
    label: 'Epoch AI Benchmarking Hub',
    url: 'https://epoch.ai/benchmarks',
    note: 'ECI 与评测成绩，CC-BY 4.0'
  },
  {
    label: 'LiveBench',
    url: 'https://livebench.ai',
    note: '编程分项，Apache-2.0；当前通过 Epoch 收录的同源 CSV 接入'
  },
  ...AI_AGENT_ARENA_SOURCES.map((source) => ({
    label: source.label,
    url: source.url,
    note: source.note
  }))
]

/** 数据来源与许可说明；只打开主进程白名单中的固定来源。 */
export function AiWorldSources({
  onClose,
  onOpenSource,
  initialSection
}: AiWorldSourcesProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref)
  useOverlayEscape(onClose)

  const keyStatus = useAiWorldAaStore((state) => state.keyStatus)
  const savingKey = useAiWorldAaStore((state) => state.savingKey)
  const quotaRemaining = useAiWorldAaStore((state) => state.result?.state.quotaRemaining ?? null)
  const loadKeyStatus = useAiWorldAaStore((state) => state.loadKeyStatus)
  const saveKey = useAiWorldAaStore((state) => state.saveKey)
  const clearKey = useAiWorldAaStore((state) => state.clearKey)

  const [aaOpen, setAaOpen] = useState(initialSection === 'aa')
  const [apiKey, setApiKey] = useState('')
  const [keyError, setKeyError] = useState('')

  useEffect(() => {
    void loadKeyStatus()
  }, [loadKeyStatus])

  const saveAaKey = async (): Promise<void> => {
    setKeyError('')
    const ok = await saveKey(apiKey)
    if (ok) {
      setApiKey('')
      setAaOpen(false)
      return
    }
    setKeyError(useAiWorldAaStore.getState().error || 'API Key 保存失败，请稍后重试')
  }

  const clearAaKey = async (): Promise<void> => {
    const confirmed = await confirmDialog(
      '清除 Artificial Analysis API Key？清除后 AA 榜将停止更新。'
    )
    if (!confirmed) return
    setKeyError('')
    const ok = await clearKey()
    if (!ok) setKeyError(useAiWorldAaStore.getState().error || '清除 API Key 失败')
  }

  const quota = formatAaQuota(quotaRemaining)

  return (
    <div
      className="ai-world-detail-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={ref}
        className="ai-world-sources"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-world-sources-title"
      >
        <header className="ai-world-detail-head">
          <div>
            <p className="ai-world-eyebrow">DATA & LICENSES</p>
            <h2 id="ai-world-sources-title">数据来源与许可</h2>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        </header>

        <p className="field-hint">
          ToolBox 主进程直接抓取 models.dev、Epoch AI、Artificial Analysis 与 Agent
          榜来源，在本机归一化、校验并缓存，不读取其它项目的运行时快照。模型快照与 AA 榜按
          12 小时 TTL 更新，Agent 榜按来源分别设置 15 分钟 / 1 小时 / 12 小时，页面显示各自的数据时间。
        </p>

        <div className="ai-world-source-list">
          {SOURCES.map((source) => (
            <div className="ai-world-source-row" key={source.url}>
              <div>
                <strong>{source.label}</strong>
                <span className="field-hint">{source.note}</span>
              </div>
              <button
                type="button"
                className="ai-world-source-link"
                onClick={() => onOpenSource(source.url)}
              >
                打开
              </button>
            </div>
          ))}

          <div className="ai-world-source-row">
            <div>
              <strong>Artificial Analysis</strong>
              <span className="ai-world-aa-key-state">
                {keyStatus.configured ? '已配置 Key' : '未配置 Key'}
              </span>
              <span className="field-hint">
                智能指数、行业能力、价格与速度；官方 Data API 免费档，需自行配置 Key
              </span>
              {quota ? <span className="field-hint">{quota}</span> : null}
            </div>
            <div className="ai-world-source-actions">
              <button
                type="button"
                className="btn-ghost btn-mini"
                aria-expanded={aaOpen}
                onClick={() => {
                  setKeyError('')
                  setAaOpen((open) => !open)
                }}
              >
                {keyStatus.configured ? '管理 Key' : '配置 Key'}
              </button>
              <button
                type="button"
                className="ai-world-source-link"
                onClick={() => onOpenSource(AI_WORLD_AA_MODELS_URL)}
              >
                打开
              </button>
            </div>
          </div>

          {aaOpen ? (
            <div className="ai-world-aa-key-panel">
              <label className="field-label" htmlFor="ai-world-aa-key">
                Artificial Analysis API Key
              </label>
              <input
                id="ai-world-aa-key"
                className="field-input"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  keyStatus.configured ? '已保存，输入新 Key 可替换' : '粘贴免费 API Key'
                }
              />
              <p className="field-hint">
                免费档每 24 小时 100 次请求；Key 经系统安全存储加密，只保存在本机。使用 AA 数据时需要保留署名。
              </p>
              {keyError ? (
                <p className="field-hint ai-world-aa-key-error" role="alert">
                  {keyError}
                </p>
              ) : null}
              <div className="tool-controls">
                <button
                  type="button"
                  className="btn-gold"
                  disabled={savingKey || apiKey.trim().length < 8}
                  onClick={() => void saveAaKey()}
                >
                  {savingKey ? '保存中…' : '保存 Key'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => onOpenSource(AI_WORLD_AA_KEY_URL)}
                >
                  获取免费 Key
                </button>
                {keyStatus.configured ? (
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={savingKey}
                    onClick={() => void clearAaKey()}
                  >
                    清除 Key
                  </button>
                ) : null}
                <button type="button" className="btn-ghost" onClick={() => setAaOpen(false)}>
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="status-banner" role="note">
          <span>
            Epoch 数据为 CC-BY 4.0，需保留署名；Artificial Analysis 数据来自官方 Data API
            免费档，使用需署名，公开发布前需确认其授权范围。AA 智能指数与 ECI
            是两套独立评测，不直接比较。不同赛制不混合计算，缺少成绩时显示「未参赛」而不是
            0。Agent 榜的 CodeAgentBench、Terminal-Bench、FrontierHarness 均为第三方公开榜单，只做分榜展示。
          </span>
        </div>
      </section>
    </div>
  )
}
