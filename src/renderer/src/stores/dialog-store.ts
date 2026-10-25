import { create } from 'zustand'

/** 业务确认只存内存；不排队累积重复操作，取消统一返回 null。 */
export interface DialogRequest {
  message: string
  title: string
  danger: boolean
  maxLength?: number
}
/** 单个进行中的确认请求与完成入口。 */
interface DialogState {
  request: DialogRequest | null
  answer(value: string | null): void
}
let resolveDialog: ((value: string | null) => void) | null = null
export const useDialogStore = create<DialogState>((set) => ({
  request: null,
  answer: (value) => {
    const resolve = resolveDialog
    resolveDialog = null
    set({ request: null })
    resolve?.(value)
  }
}))

function requestDialog(request: DialogRequest): Promise<string | null> {
  if (resolveDialog) return Promise.resolve(null)
  return new Promise((resolve) => {
    resolveDialog = resolve
    useDialogStore.setState({ request })
  })
}
export function confirmDialog(message: string): Promise<boolean> {
  const danger = /删除|清除|移除/.test(message)
  return requestDialog({ message, title: danger ? '确认操作' : '请确认', danger }).then(
    (result) => result !== null
  )
}
export function promptDialog(message: string, maxLength = 120): Promise<string | null> {
  return requestDialog({ message, title: '输入内容', danger: false, maxLength })
}
