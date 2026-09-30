import type { ToolboxBridge } from '@shared/bridge'

declare global {
  interface Window {
    toolbox: ToolboxBridge
  }
}

export {}
