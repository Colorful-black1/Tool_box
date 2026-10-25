/** 同一个 Esc 只处理最上层浮层；捕获阶段阻止背景快捷键。 */
const layers: symbol[] = []

export function pushOverlay(): { top(): boolean; dispose(): void } {
  const id = Symbol('overlay')
  layers.push(id)
  return {
    top: () => layers[layers.length - 1] === id,
    dispose: () => {
      const index = layers.indexOf(id)
      if (index >= 0) layers.splice(index, 1)
    }
  }
}
