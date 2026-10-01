import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'

import { Screen } from '../components/screen'
import { NoteEditorScreen } from '../ui/notes/note-editor-screen'
import { NotesListScreen } from '../ui/notes/notes-list-screen'
import type { NoteView } from '../shared-bridge'

/**
 * 记事本页（M3）。
 *
 * 列表与编辑之间用本地 state 切换，不引第二套导航栈 —— 与对话页同一取舍，
 * 理由见 `chat-screen.tsx`：当前只有两层，native-stack 的收益不抵依赖成本。
 *
 * `note === null` 表示「新建」。编辑页返回时把 `reloadSignal` 加一，
 * 让列表重新读库，保证退出后看到的标题 / 摘要是最新值。
 *
 * 顶部安全区在 `Screen` 上处理（整个 Tab 内容共用一层），子页面不再重复包。
 */
export function NotesScreen(): ReactNode {
  const [note, setNote] = useState<NoteView | null>(null)
  const [editing, setEditing] = useState(false)
  const [reloadSignal, setReloadSignal] = useState(0)

  const close = useCallback(() => {
    setEditing(false)
    setNote(null)
    setReloadSignal((value) => value + 1)
  }, [])

  return (
    <Screen>
      {editing ? (
        <NoteEditorScreen note={note} onBack={close} />
      ) : (
        <NotesListScreen
          reloadSignal={reloadSignal}
          onOpen={(target) => {
            setNote(target)
            setEditing(true)
          }}
        />
      )}
    </Screen>
  )
}
