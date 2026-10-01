import { useState } from 'react'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { ChatDetailScreen } from '../ui/chat/chat-detail-screen'
import { ChatListScreen } from '../ui/chat/chat-list-screen'
import { colors } from '../theme'

/**
 * 对话页。
 *
 * 列表与详情之间用本地 state 切换，而不是再引入一套 stack 导航：
 * 当前只有两层，加一个 @react-navigation/native-stack 依赖换来的收益不抵成本。
 */
export function ChatScreen(): ReactNode {
  const [openId, setOpenId] = useState<string | null>(null)

  if (openId) {
    return (
      <View style={styles.root}>
        <ChatDetailScreen conversationId={openId} onBack={() => setOpenId(null)} />
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <ChatListScreen onOpen={setOpenId} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep }
})
