import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { Screen } from '../components/screen'
import { useQuickActionSignal } from '../navigation/use-quick-action'
import { PasswordEditorScreen } from '../ui/passwords/password-editor-screen'
import { PasswordImportScreen } from '../ui/passwords/password-import-screen'
import { PasswordListScreen } from '../ui/passwords/password-list-screen'
import type { PasswordEntryView } from '../shared-bridge'

/**
 * 密码箱页（M5）：列表 / 编辑 / 导入三层，本地 state 切换（与对话页、记事本页同取舍）。
 *
 * 解密与列表状态说明：`listPasswords()` 每次都会解密全部条目，因此列表本身
 * 就持有了明文。编辑器直接接收列表里的 `PasswordEntryView`，
 * 不再单独解密一遍；`isDecryptable === false` 的条目在编辑页被锁住（见该文件说明）。
 */
export function PasswordScreen(): ReactNode {
  const [entry, setEntry] = useState<PasswordEntryView | null>(null)
  const [editing, setEditing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [reloadSignal, setReloadSignal] = useState(0)
  /** 长按 Tab「密码箱」→ 直接开一条新记录 */
  const quickSignal = useQuickActionSignal()

  useEffect(() => {
    if (quickSignal === 0) return
    setEntry(null)
    setEditing(true)
  }, [quickSignal])

  const leave = useCallback(() => {
    setEditing(false)
    setEntry(null)
    setReloadSignal((value) => value + 1)
  }, [])

  const leaveImport = useCallback(() => {
    setImporting(false)
    setReloadSignal((value) => value + 1)
  }, [])

  if (editing) {
    return (
      <Screen>
        <PasswordEditorScreen entry={entry} onBack={leave} />
      </Screen>
    )
  }

  if (importing) {
    return (
      <Screen>
        <PasswordImportScreen onBack={leaveImport} />
      </Screen>
    )
  }

  return (
    <Screen>
      <PasswordListScreen
        reloadSignal={reloadSignal}
        onOpen={(target) => {
          setEntry(target)
          setEditing(true)
        }}
        onImport={() => setImporting(true)}
      />
    </Screen>
  )
}
