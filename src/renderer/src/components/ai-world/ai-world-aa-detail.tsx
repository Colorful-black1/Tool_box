import { useRef } from 'react'
import type { JSX } from 'react'

import {
  AI_WORLD_AA_CAPABILITIES,
  AI_WORLD_AA_MODELS_URL,
  AI_WORLD_AA_SOURCE_LABEL
} from '@shared/ai-world-aa'
import type { AiWorldAaModel } from '@shared/ai-world-aa'
import { useModalFocus } from '../../lib/use-modal-focus'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'
import {
  formatAaCostPerTask,
  formatAaDate,
  formatAaIndex,
  formatAaLatency,
  formatAaPrice,
  formatAaSpeed,
  formatAaVersion
} from '../../lib/ai-world-aa-format'

interface AiWorldAaDetailProps {
  model: AiWorldAaModel
  intelligenceIndexVersion: number | null
  onClose: () => void
  onOpenSource: (url: string) => void
}

function Spec({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="ai-world-spec">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

/** AA 详情：只展示 Artificial Analysis 自己的指标与版本，不换算成 ECI。 */
export function AiWorldAaDetail({
  model,
  intelligenceIndexVersion,
  onClose,
  onOpenSource
}: AiWorldAaDetailProps): JSX.Element {
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
        className="ai-world-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-aa-detail-title"
      >
        <header className="ai-world-detail-head">
          <div>
            <p className="ai-world-eyebrow">
              {AI_WORLD_AA_SOURCE_LABEL} · INTELLIGENCE INDEX{' '}
              {formatAaVersion(intelligenceIndexVersion)}
            </p>
            <h2 id="ai-aa-detail-title">{model.name}</h2>
            <p className="field-hint">
              {model.creator || '厂商标识未公开'} · {formatAaDate(model.releaseDate)} 发布
            </p>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="ai-aa-highlight-grid">
          <div className="ai-aa-highlight">
            <span>智能指数</span>
            <strong>{formatAaIndex(model.intelligenceIndex)}</strong>
            <small>Intelligence Index {formatAaVersion(intelligenceIndexVersion)}</small>
          </div>
          <div className="ai-aa-highlight">
            <span>每任务成本</span>
            <strong>{formatAaCostPerTask(model.costPerTask)}</strong>
            <small>完成一个 Intelligence Index 任务的加权平均成本</small>
          </div>
          <div className="ai-aa-highlight">
            <span>输出速度</span>
            <strong>{formatAaSpeed(model.outputTokensPerSecond)}</strong>
            <small>Performance v3 平均输出速度</small>
          </div>
          <div className="ai-aa-highlight">
            <span>首字延迟</span>
            <strong>{formatAaLatency(model.timeToFirstTokenSeconds)}</strong>
            <small>平均首 token 返回时间</small>
          </div>
        </div>

        <h3 className="ai-world-detail-section">行业能力指数</h3>
        <div className="ai-aa-capability-grid">
          {AI_WORLD_AA_CAPABILITIES.map((capability) => (
            <div className="ai-aa-capability" key={capability.key}>
              <span>{capability.label}</span>
              <strong>{formatAaIndex(model.capabilityIndexes[capability.key])}</strong>
            </div>
          ))}
        </div>

        <h3 className="ai-world-detail-section">价格与延迟</h3>
        <div className="ai-world-spec-grid">
          <Spec label="输入价格" value={formatAaPrice(model.inputPricePerMTok)} />
          <Spec label="输出价格" value={formatAaPrice(model.outputPricePerMTok)} />
          <Spec
            label="首答延迟"
            value={formatAaLatency(model.timeToFirstAnswerTokenSeconds)}
          />
          <Spec label="发布日期" value={formatAaDate(model.releaseDate)} />
          <Spec label="厂商" value={model.creator || '未公开'} />
          <Spec label="AA Slug" value={model.slug} />
        </div>

        <h3 className="ai-world-detail-section">口径说明</h3>
        <ul className="ai-aa-notes">
          <li>Artificial Analysis Intelligence Index 与 Epoch ECI 是两套独立评测，不直接比较。</li>
          <li>分数只在同一大版本内可比；当前版本 {formatAaVersion(intelligenceIndexVersion)}。</li>
          <li>缺失指标显示「—」，表示未测量或未提供，不表示 0 分。</li>
        </ul>

        <div className="ai-world-source-row">
          <div>
            <strong>{AI_WORLD_AA_SOURCE_LABEL}</strong>
            <span className="field-hint">数据来自官方 Data API 免费档；使用时保留署名</span>
          </div>
          <button
            type="button"
            className="ai-world-source-link"
            onClick={() => onOpenSource(AI_WORLD_AA_MODELS_URL)}
          >
            打开原榜
          </button>
        </div>
      </section>
    </div>
  )
}
