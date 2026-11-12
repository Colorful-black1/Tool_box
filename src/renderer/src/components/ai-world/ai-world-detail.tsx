import { useRef } from 'react'
import type { JSX } from 'react'

import type {
  AiWorldBenchmarkScore,
  AiWorldMetrics,
  AiWorldModel,
  AiWorldVendor
} from '@shared/ai-model-world'
import { AI_WORLD_KIND_LABELS, aiWorldKindOf } from '@shared/ai-model-world'
import { useModalFocus } from '../../lib/use-modal-focus'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'
import {
  attributionLabel,
  formatCount,
  formatDate,
  formatPrice,
  formatRankPercentile,
  formatScore,
  sourceLabel
} from '../../lib/ai-world-format'

interface AiWorldDetailProps {
  model: AiWorldModel
  vendor: AiWorldVendor | undefined
  metrics: AiWorldMetrics
  scores: AiWorldBenchmarkScore[]
  onClose: () => void
  onOpenSource: (url: string) => void
}

function AbilityRow({
  label,
  value,
  fill,
  detail
}: {
  label: string
  value: string
  fill: number | null
  detail: string
}): JSX.Element {
  return (
    <div className="ai-world-ability" title={detail}>
      <span className="ai-world-ability-label">{label}</span>
      <span className="ai-world-ability-track" aria-hidden="true">
        {fill == null ? null : (
          <span
            className="ai-world-ability-fill"
            style={{ width: `${Math.max(4, fill * 100)}%` }}
          />
        )}
      </span>
      <span className="ai-world-ability-value">{value}</span>
    </div>
  )
}

function Spec({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="ai-world-spec">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

/** 详情抽屉：不离开列表即可核对规格、能力条和逐项成绩来源。 */
export function AiWorldDetail({
  model,
  vendor,
  metrics,
  scores,
  onClose,
  onOpenSource
}: AiWorldDetailProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref)
  useOverlayEscape(onClose)

  const kind = aiWorldKindOf(model)
  const provider = vendor?.nameZh || vendor?.name || model.vendorId
  const price = model.pricing.outputPerMTok
  const coding = metrics.code

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
        aria-labelledby="ai-world-detail-title"
      >
        <header className="ai-world-detail-head">
          <div>
            <p className="ai-world-eyebrow">
              {provider} · {AI_WORLD_KIND_LABELS[kind]}
              {model.retiredAt ? ' · 已退役' : ''}
            </p>
            <h2 id="ai-world-detail-title">{model.name}</h2>
            <p className="field-hint">
              {model.id} · {formatDate(model.releaseDate, model.releaseDatePrecision)} 发布
            </p>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="ai-world-abilities">
          <AbilityRow
            label="聪明"
            value={metrics.eci == null ? '未参赛' : `ECI ${metrics.eci.toFixed(1)}`}
            fill={metrics.eciPercentile}
            detail="Epoch Capabilities Index，综合智力指数；没有成绩时不填 0。"
          />
          <AbilityRow
            label="编程"
            value={coding ? formatRankPercentile(coding.score) : '未参赛'}
            fill={coding?.score ?? null}
            detail={
              coding
                ? `${coding.leagues} 个第三方编程榜的平均分位；跨赛制不直接比较原始分。`
                : '没有足够的第三方编程成绩，仅表示未参赛，不表示不会写代码。'
            }
          />
          <AbilityRow
            label="记性"
            value={model.contextWindow == null ? '暂无数据' : formatCount(model.contextWindow)}
            fill={metrics.contextPercentile}
            detail="上下文窗口；条长表示在当前模型中的相对分位。"
          />
          <AbilityRow
            label="便宜"
            value={price == null ? '暂无数据' : formatPrice(price)}
            fill={metrics.cheapPercentile}
            detail="输出每百万 token 价格；条越长表示相对越便宜。"
          />
        </div>

        <h3 className="ai-world-detail-section">规格</h3>
        <div className="ai-world-spec-grid">
          <Spec label="综合名次" value={metrics.rank == null ? '未参赛' : `#${metrics.rank}`} />
          <Spec
            label="上下文"
            value={model.contextWindow == null ? '未知' : formatCount(model.contextWindow)}
          />
          <Spec
            label="最大输出"
            value={model.maxOutput == null ? '未知' : formatCount(model.maxOutput)}
          />
          <Spec label="输出价格" value={formatPrice(price)} />
          <Spec
            label="输入模态"
            value={model.modalities.input.map((item) => item.toUpperCase()).join(' / ') || '未知'}
          />
          <Spec
            label="输出模态"
            value={model.modalities.output.map((item) => item.toUpperCase()).join(' / ') || '未知'}
          />
          <Spec
            label="开源权重"
            value={model.openWeights == null ? '未知' : model.openWeights ? '是' : '否'}
          />
          <Spec label="许可证" value={model.license || '未公开'} />
          <Spec
            label="参数量"
            value={
              model.params.totalB == null
                ? '未公开'
                : `${model.params.totalB}B${model.params.activeB == null ? '' : ` / 激活 ${model.params.activeB}B`}`
            }
          />
          <Spec label="知识截止" value={model.knowledgeCutoff || '未知'} />
          <Spec
            label="工具调用"
            value={
              model.capabilities.toolCall == null
                ? '未知'
                : model.capabilities.toolCall
                  ? '支持'
                  : '不支持'
            }
          />
          <Spec
            label="推理"
            value={
              model.capabilities.reasoning == null
                ? '未知'
                : model.capabilities.reasoning
                  ? '支持'
                  : '不支持'
            }
          />
        </div>

        <h3 className="ai-world-detail-section">逐项成绩</h3>
        {scores.length ? (
          <div className="ai-world-score-list">
            {scores.map((score) => (
              <div className="ai-world-score-row" key={`${score.league}-${score.attribution}`}>
                <span className="ai-world-score-league">{score.league}</span>
                <span className="ai-world-score-value">{formatScore(score)}</span>
                <span className="ai-world-score-meta">
                  {attributionLabel(score.attribution)} · {sourceLabel(score.source)}
                </span>
                {score.sourceUrl ? (
                  <button
                    type="button"
                    className="ai-world-source-link"
                    onClick={() => onOpenSource(score.sourceUrl!)}
                  >
                    来源
                  </button>
                ) : (
                  <span className="ai-world-score-meta">无链接</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="field-hint">暂无公开成绩；这表示未参赛，不表示能力为零。</p>
        )}
      </section>
    </div>
  )
}
