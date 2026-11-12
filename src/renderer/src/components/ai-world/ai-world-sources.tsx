import { useRef } from 'react'
import type { JSX } from 'react'

import { useModalFocus } from '../../lib/use-modal-focus'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'

interface AiWorldSourcesProps {
  onClose: () => void
  onOpenSource: (url: string) => void
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
  }
]

/** 数据来源与许可说明；只打开主进程白名单中的固定来源。 */
export function AiWorldSources({ onClose, onOpenSource }: AiWorldSourcesProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref)
  useOverlayEscape(onClose)

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
          ToolBox 主进程直接抓取 models.dev 与 Epoch AI，在本机归一化、校验并缓存，不读取
          ai-model-world 的运行时快照；该项目仅作为字段规则和交互参考。快照按 12 小时 TTL
          更新，页面显示本次生成时间。
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
        </div>

        <div className="status-banner" role="note">
          <span>
            Epoch 数据为 CC-BY 4.0，需保留署名；不使用 Artificial Analysis
            数据。不同赛制的分数不混合计算， 缺少成绩时显示「未参赛」而不是 0。
          </span>
        </div>
      </section>
    </div>
  )
}
