import { createRoot } from 'react-dom/client'

import App from './App'
import { applyAppAppearance } from './lib/app-appearance'
import { useAppearanceStore } from './stores/appearance-store'
import './styles/global.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('未找到应用挂载节点')
}

applyAppAppearance(
  useAppearanceStore.getState().appearance,
  window.matchMedia('(prefers-color-scheme: dark)').matches
)
createRoot(rootElement).render(<App />)
