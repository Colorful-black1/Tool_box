import type { JSX } from 'react'

import { DEFAULT_APP_APPEARANCE } from '../../../../shared/appearance'
import type { AppTheme } from '../../../../shared/appearance'
import { useAppearanceStore } from '../../stores/appearance-store'

const THEME_OPTIONS: Array<{ id: AppTheme; name: string; description: string }> = [
  { id: 'starry', name: '星轨深空', description: '金色星芒，延续熟悉的星轨' },
  { id: 'graphite', name: '静夜石墨', description: '低饱和深灰，专注眼前内容' },
  { id: 'paper', name: '晨光纸白', description: '温暖纸面，适合明亮的环境' },
  { id: 'system', name: '跟随系统', description: '随系统切换纸白与石墨' }
]

export function AppearanceSettings(): JSX.Element {
  const appearance = useAppearanceStore((state) => state.appearance)
  const loaded = useAppearanceStore((state) => state.loaded)
  const loading = useAppearanceStore((state) => state.loading)
  const saving = useAppearanceStore((state) => state.saving)
  const error = useAppearanceStore((state) => state.error)
  const patch = useAppearanceStore((state) => state.patch)
  const load = useAppearanceStore((state) => state.load)
  const isDefault = appearance.theme === 'starry' && appearance.backgroundMotion

  return (
    <section className="glass settings-card appearance-settings" aria-label="外观设置">
      <div className="sec-head">
        <h2 className="sec-title">外观与主题</h2>
        <span className="field-hint" role="status">
          {saving ? '正在保存…' : '选择后自动保存'}
        </span>
      </div>
      <p className="field-hint">调整整个工具箱的外观。阅读器的纸张与文字配色仍可单独设置。</p>
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
      <div
        className="appearance-options"
        role="group"
        aria-label="应用主题"
        aria-busy={loading || saving}
      >
        {THEME_OPTIONS.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className="btn-ghost appearance-choice"
            aria-pressed={appearance.theme === theme.id}
            aria-label={theme.name}
            disabled={!loaded}
            aria-disabled={saving}
            onClick={() => void patch({ theme: theme.id })}
          >
            <span
              className="theme-preview"
              data-preview={theme.id === 'system' ? 'graphite' : theme.id}
              aria-hidden="true"
            >
              <span className="theme-preview-rail" />
              <span className="theme-preview-content">
                <i />
                <i />
                <i />
              </span>
              {theme.id === 'system' ? <span className="theme-preview-system" /> : null}
            </span>
            <span className="appearance-choice-title">
              {theme.name}
              <span aria-hidden="true">{appearance.theme === theme.id ? '✓' : ''}</span>
            </span>
            <span className="appearance-choice-description">{theme.description}</span>
          </button>
        ))}
      </div>
      <div className="appearance-footer">
        <div className="appearance-motion">
          <button
            type="button"
            className={`toggle-switch${appearance.backgroundMotion ? ' on' : ''}`}
            role="switch"
            aria-checked={appearance.backgroundMotion}
            aria-labelledby="appearance-motion-label"
            disabled={!loaded}
            aria-disabled={saving}
            onClick={() => void patch({ backgroundMotion: !appearance.backgroundMotion })}
          >
            <span aria-hidden="true" />
          </button>
          <div>
            <span id="appearance-motion-label" className="field-label">
              星空背景动效
            </span>
            <p className="field-hint">仅深空主题显示星空；系统开启减少动态效果时自动静止。</p>
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost"
          disabled={!loaded}
          aria-disabled={saving || isDefault}
          onClick={() => void patch(DEFAULT_APP_APPEARANCE)}
        >
          恢复默认外观
        </button>
      </div>
    </section>
  )
}
