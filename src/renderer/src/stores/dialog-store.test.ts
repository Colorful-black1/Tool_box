import { afterEach, describe, expect, it } from 'vitest'
import { confirmDialog, promptDialog, useDialogStore } from './dialog-store'

afterEach(() => useDialogStore.getState().answer(null))
describe('业务确认生命周期', () => {
  it('取消和确认分别返回 false/true，完成后移除请求', async () => {
    const cancelled = confirmDialog('删除记录？')
    expect(useDialogStore.getState().request?.danger).toBe(true)
    useDialogStore.getState().answer(null)
    expect(await cancelled).toBe(false)
    const accepted = confirmDialog('替换草稿？')
    useDialogStore.getState().answer('')
    expect(await accepted).toBe(true)
    expect(useDialogStore.getState().request).toBeNull()
  })
  it('重复操作不排队，保留最初确认内容', async () => {
    const first = promptDialog('分组名称', 20)
    expect(await confirmDialog('删除全部？')).toBe(false)
    expect(useDialogStore.getState().request?.maxLength).toBe(20)
    useDialogStore.getState().answer('开发')
    expect(await first).toBe('开发')
  })
})
