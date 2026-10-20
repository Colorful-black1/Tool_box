/**
 * 模型清单的纯逻辑：桌面端与手机端共用。
 *
 * 背景：供应商的模型目录动辄三四十个（opencode-go 实测 37 个），
 * 全塞进对话下拉既难看又难找。改成「在设置里勾选 → 对话下拉只显示勾选的」，
 * 这份文件承载两端的共同规则，归一化与候选计算都放在这里，避免两端各写一套。
 */

/** 单个模型名长度上限（与 IPC 侧校验保持一致） */
export const MAX_MODEL_NAME_CHARS = 80

/** 勾选模型数量上限：再多就没必要了，也防止配置文件被撑大 */
export const MAX_SELECTED_MODELS = 60

/**
 * 归一化模型清单：去空白、去重、限量。
 *
 * 入参声明为 unknown：这份数据来自磁盘与 IPC，类型不可信。
 */
export function normalizeModelList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (!name || name.length > MAX_MODEL_NAME_CHARS) continue
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
    if (out.length >= MAX_SELECTED_MODELS) break
  }
  return out
}

/**
 * 对话下拉的候选模型。
 *
 * 规则：
 * - 当前正在用的模型永远排在最前（哪怕它没被勾选，否则用户会被自己的选择卡住）；
 * - 其后是用户勾选的清单；
 * - 一个都没勾时回落到供应商内置推荐，保证下拉不为空。
 */
export function resolveChatModels(
  current: string,
  selected: string[] | undefined,
  fallback: string[]
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (model: string): void => {
    const name = model.trim()
    if (!name || seen.has(name)) return
    seen.add(name)
    out.push(name)
  }
  push(current)
  const picked = normalizeModelList(selected)
  if (picked.length > 0) {
    for (const model of picked) push(model)
  } else {
    for (const model of fallback) push(model)
  }
  return out
}

/**
 * 勾选 / 取消勾选一个模型后，清单与当前模型该怎么变。
 *
 * 关键点：**勾选清单不只决定「下拉里有哪些」，还决定「现在用哪个」**。
 * 之前只改清单不改当前模型，用户勾了半天发现请求还是老模型 —— 等于没勾。
 *
 * 规则：
 * - 勾上一个 → 当前模型切到这个新勾的模型（「勾哪个用哪个」）；
 * - 取消勾选当前正在用的模型 → 顺延到清单里剩下的第一个；
 *   一个都不剩时保持当前模型不变（清单为空时下拉回落到内置推荐，
 *   当前模型仍会出现在下拉里）。
 */
export function applyModelToggle(
  current: string,
  selected: string[],
  name: string
): { selectedModels: string[]; model: string } {
  const wasChecked = selected.includes(name)
  const next = wasChecked
    ? selected.filter((item) => item !== name)
    : [...selected, name]
  if (wasChecked) {
    return {
      selectedModels: next,
      model: current === name ? (next[0] ?? current) : current
    }
  }
  return { selectedModels: next, model: name }
}
