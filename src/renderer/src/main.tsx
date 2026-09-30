import { createRoot } from 'react-dom/client'

import App from './App'
import './styles/global.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('未找到应用挂载节点')
}

createRoot(rootElement).render(<App />)
