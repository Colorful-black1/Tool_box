import type { AiWorldSnapshot } from '../../../../shared/ai-model-world'
import type { FetchLike } from '../../github-trending/fetch'
import { buildNativeSnapshot } from './build'
import { fetchEpoch } from './epoch'
import { fetchModelsDev } from './models-dev'
import { NativeSourceError } from './http'

/**
 * ToolBox 原生采集：
 * - models.dev：模型身份、价格、上下文、模态；
 * - Epoch AI：ECI 与评测成绩；
 * - Epoch 收录的 LiveBench 分项作为编程赛制之一。
 *
 * 两个源并行抓取；models.dev 失败则本次不可用，Epoch 失败则保留模型列表并标记来源异常。
 */
export async function collectNativeSnapshot(
  fetchImpl: FetchLike,
  now: Date
): Promise<AiWorldSnapshot> {
  const [modelsDevResult, epochResult] = await Promise.allSettled([
    fetchModelsDev(fetchImpl),
    fetchEpoch(fetchImpl)
  ])
  if (modelsDevResult.status === 'rejected') {
    throw new NativeSourceError('models.dev 数据读取失败，请稍后重试', {
      cause: modelsDevResult.reason
    })
  }
  const epochOk = epochResult.status === 'fulfilled'
  const epochError = epochOk
    ? null
    : epochResult.reason instanceof Error
      ? epochResult.reason.message
      : 'Epoch AI 数据读取失败'
  if (!epochOk) console.warn('[AiModelWorld] Epoch 数据不可用，仅保留 models.dev 模型列表')
  return buildNativeSnapshot({
    now,
    modelsDev: modelsDevResult.value,
    epoch: epochOk ? epochResult.value : undefined,
    epochOk,
    epochError
  })
}
