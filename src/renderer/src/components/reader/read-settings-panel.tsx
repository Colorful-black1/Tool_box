import { useModalFocus } from '../../lib/use-modal-focus'
import { useRef } from 'react'
import type { JSX } from 'react'

import { FONT_OPTIONS, READER_THEMES } from '../../../../shared/types'
import type { ReadConfig, ReaderTheme } from '../../../../shared/types'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'
import { useConfigStore } from '../../stores/config-store'

interface ReadSettingsPanelProps {
  theme: ReaderTheme
  onClose(): void
}

const PAGE_MODES: Array<[ReadConfig['pageMode'], string]> = [
  ['scroll', '上下滚动'],
  ['horizontal', '左右翻页'],
  ['cover', '覆盖']
]

/** 阅读设置面板：主题 + 夜间 + 翻页模式 + 字号 + 行距 + 亮度 + 字体，对应 reader_menu.dart */
export function ReadSettingsPanel({
  theme,
  onClose
}: ReadSettingsPanelProps): JSX.Element {
  const config = useConfigStore((state) => state.config)
  const patch = useConfigStore((state) => state.patch)

  const modalRef = useRef<HTMLDivElement>(null)
  useModalFocus(modalRef)
  useOverlayEscape(onClose)

  const set = (partial: Partial<ReadConfig>): void => {
    void patch(partial)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet-panel settings-sheet"
        style={{ background: theme.background, color: theme.foreground }}
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="阅读设置"
      >
        <div className="sheet-tabs">
          <span className="sheet-tab active static">阅读设置</span>
          <button
            type="button"
            className="sheet-close"
            aria-label="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="sheet-scroll settings-sheet-body">
          <section className="setting-block">
            <h4 className="setting-title">背景主题</h4>
            <div className="theme-dots">
              {READER_THEMES.map((item, index) => (
                <button
                  key={item.name}
                  type="button"
                  className={`theme-dot${
                    config.themeIndex === index && !config.nightMode ? ' active' : ''
                  }`}
                  style={{ background: item.background }}
                  title={item.name}
                  aria-label={item.name}
                  onClick={() => set({ themeIndex: index, nightMode: false })}
                />
              ))}
            </div>
          </section>

          <section className="setting-block setting-row">
            <span className="setting-title">夜间模式</span>
            <button
              type="button"
              className={`toggle-switch${config.nightMode ? ' on' : ''}`}
              role="switch"
              aria-checked={config.nightMode}
              aria-label="夜间模式"
              onClick={() => set({ nightMode: !config.nightMode })}
            >
              <span />
            </button>
          </section>

          <section className="setting-block">
            <h4 className="setting-title">翻页模式</h4>
            <div className="segmented">
              {PAGE_MODES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`segment${config.pageMode === value ? ' active' : ''}`}
                  onClick={() => set({ pageMode: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="setting-block">
            <h4 className="setting-title">字号 {config.fontSize}</h4>
            <div className="slider-row">
              <button
                type="button"
                className="slider-step"
                aria-label="减小字号"
                onClick={() => set({ fontSize: Math.max(12, config.fontSize - 1) })}
              >
                −
              </button>
              <input
                type="range"
                min={12}
                max={32}
                step={1}
                value={config.fontSize}
                aria-label="字号"
                onChange={(event) => set({ fontSize: Number(event.target.value) })}
              />
              <button
                type="button"
                className="slider-step"
                aria-label="增大字号"
                onClick={() => set({ fontSize: Math.min(32, config.fontSize + 1) })}
              >
                ＋
              </button>
            </div>
          </section>

          <section className="setting-block">
            <h4 className="setting-title">行距 {config.lineSpacing.toFixed(2)}</h4>
            <div className="slider-row">
              <button
                type="button"
                className="slider-step"
                aria-label="减小行距"
                onClick={() =>
                  set({
                    lineSpacing: Math.max(
                      1.1,
                      Number((config.lineSpacing - 0.1).toFixed(1))
                    )
                  })
                }
              >
                −
              </button>
              <input
                type="range"
                min={1.1}
                max={2.4}
                step={0.1}
                value={config.lineSpacing}
                aria-label="行距"
                onChange={(event) => set({ lineSpacing: Number(event.target.value) })}
              />
              <button
                type="button"
                className="slider-step"
                aria-label="增大行距"
                onClick={() =>
                  set({
                    lineSpacing: Math.min(
                      2.4,
                      Number((config.lineSpacing + 0.1).toFixed(1))
                    )
                  })
                }
              >
                ＋
              </button>
            </div>
          </section>

          <section className="setting-block">
            <h4 className="setting-title">
              亮度 {100 - Math.round((config.brightnessMask / 0.6) * 100)}
            </h4>
            <div className="slider-row">
              <span>🌙</span>
              <input
                type="range"
                min={0}
                max={0.6}
                step={0.05}
                value={0.6 - config.brightnessMask}
                aria-label="亮度"
                onChange={(event) =>
                  set({ brightnessMask: 0.6 - Number(event.target.value) })
                }
              />
              <span>☀️</span>
            </div>
          </section>

          <section className="setting-block">
            <h4 className="setting-title">字体</h4>
            <div className="font-chips">
              {FONT_OPTIONS.map((font) => (
                <button
                  key={font.value || 'default'}
                  type="button"
                  className={`font-chip${config.fontFamily === font.value ? ' active' : ''}`}
                  style={{ fontFamily: font.value || undefined }}
                  onClick={() => set({ fontFamily: font.value })}
                >
                  {font.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}