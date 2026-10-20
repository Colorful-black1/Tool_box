import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'

import { Screen } from '../components/screen'
import { useQuickActionSignal } from '../navigation/use-quick-action'
import { ChatDetailScreen } from '../ui/chat/chat-detail-screen'
import { ChatListScreen } from '../ui/chat/chat-list-screen'
import type { ConversationSummary } from '../shared-bridge'

/**
 * 对话页。
 *
 * 列表与详情之间用本地 state 切换，而不是再引入一套 stack 导航：
 * 当前只有两层，加一个 @react-navigation/native-stack 依赖换来的收益不抵成本。
 */
export function ChatScreen(): ReactNode {
  const [open, setOpen] = useState<ConversationSummary | null>(null)
  const [reloadSignal, setReloadSignal] = useState(0)
  /** 长按 Tab「对话」→ 新建并进入一个会话（创建逻辑在列表页里） */
  const createSignal = useQuickActionSignal()

  const leave = useCallback(() => {
    setOpen(null)
    // 详情页可能重命名/删除过会话，返回时让列表重读
    setReloadSignal((value) => value + 1)
  }, [])

  return (
    <Screen>
      {open ? (
        <ChatDetailScreen conversationId={open.id} onBack={leave} />
      ) : (
        <ChatListScreen
          reloadSignal={reloadSignal}
          createSignal={createSignal}
          onOpen={setOpen}
        />
      )}
    </Screen>
  )
}
