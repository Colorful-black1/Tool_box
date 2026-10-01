/**
 * 会话详情：消息流 + 输入框 + 停止。
 *
 * 流式期间的显示策略：
 * - 增量文本放在 `streaming` 本地状态里，不落库（与桌面端语义一致：只有成功才落库）；
 * - 收到 completed / stopped / error 后重新从 store 拉一次消息，以库为准；
 * - 因此即使中途杀进程，也不会留下半截的 assistant 消息。
 *
 * 输入框的键盘避让用 `useKeyboardInset()` 而不是 `KeyboardAvoidingView`：
 * 后者在 Android 上是否生效取决于宿主 App 的 `windowSoftInputMode`，
 * Expo Go 不是 `adjustResize`，于是 `behavior="padding"` 完全不起作用，
 * 输入框被键盘整块盖住。详见 `ui/keyboard.ts` 的说明。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'

import { useServices } from '../../runtime/services'
import { PrimaryButton } from '../../components/ui'
import { useKeyboardInset } from '../keyboard'
import type { ChatEventSink } from '../../ai/ai-gateway'
import type { ChatMessage } from '../../shared-bridge'
import { colors, fonts, radius, spacing } from '../../theme'

interface Props {
  conversationId: string
  onBack: () => void
}

export function ChatDetailScreen({ conversationId, onBack }: Props): ReactNode {
  const { store, gateway } = useServices()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const listRef = useRef<FlatList<ChatMessage> | null>(null)
  const keyboard = useKeyboardInset()

  const streamingNow = sending || streaming.length > 0

  const reload = useCallback(async (): Promise<void> => {
    try {
      setMessages(await store.listMessages(conversationId))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取消息失败')
    }
  }, [conversationId, store])

  useEffect(() => {
    void reload()
  }, [reload])

  // 增量到达时滚到底部，让用户始终看到最新内容
  useEffect(() => {
    if (!streaming) return
    listRef.current?.scrollToEnd({ animated: true })
  }, [streaming])

  const send = async (): Promise<void> => {
    const content = draft.trim()
    if (!content || streamingNow) return

    setError('')
    setSending(true)
    setDraft('')

    const sink: ChatEventSink = {
      onDelta: (event) => setStreaming((prev) => prev + event.delta),
      onCompleted: () => {
        setStreaming('')
        setSending(false)
        void reload()
      },
      onError: (event) => {
        setStreaming('')
        setSending(false)
        setError(event.message)
        void reload()
      },
      onStopped: () => {
        setStreaming('')
        setSending(false)
        void reload()
      }
    }

    try {
      await gateway.send(conversationId, content, sink)
      // send 只负责落库 user 消息并立即返回，assistant 内容走 sink
      await reload()
    } catch (sendError) {
      setSending(false)
      setError(sendError instanceof Error ? sendError.message : '发送失败')
      setDraft(content)
    }
  }

  const stop = (): void => gateway.stop(conversationId)

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回会话列表"
          onPress={() => {
            Keyboard.dismiss()
            onBack()
          }}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ 会话</Text>
        </Pressable>
        {streamingNow ? (
          <Pressable accessibilityRole="button" onPress={stop} style={styles.stop}>
            <Text style={styles.stopText}>■ 停止</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (messages.length > 0) listRef.current?.scrollToEnd({ animated: false })
        }}
        ListEmptyComponent={
          messages.length === 0 && !streaming ? (
            <Text style={styles.empty}>发送第一条消息开始对话</Text>
          ) : null
        }
        renderItem={({ item }) => <Bubble message={item} />}
        ListFooterComponent={
          streaming ? (
            <View style={[styles.bubble, styles.bubbleAssistant]}>
              <Text style={styles.bubbleText}>{streaming}</Text>
              <Text style={styles.cursor}>▍</Text>
            </View>
          ) : null
        }
      />

      {/*
        输入区整体上移键盘高度。
        `offset` 已经是「扣除宿主自动缩放后仍需避让的净高度」，
        所以 adjustResize 与 adjustPan 两种宿主下都不会重复避让或漏避让。
      */}
      <View style={[styles.composerWrap, { marginBottom: keyboard.offset }]}>
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={streamingNow ? '正在生成…' : '输入消息'}
            placeholderTextColor={colors.textDim}
            multiline
            editable={!streamingNow}
            accessibilityLabel="消息输入框"
          />
          <PrimaryButton
            label={streamingNow ? '生成中' : '发送'}
            onPress={() => void send()}
            disabled={streamingNow || draft.trim().length === 0}
          />
        </View>
      </View>
    </View>
  )
}

function Bubble({ message }: { message: ChatMessage }): ReactNode {
  const isUser = message.role === 'user'
  return (
    <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
      <Text style={styles.bubbleText}>{message.content}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm
  },
  back: { paddingVertical: 4, paddingRight: spacing.md },
  backText: { color: colors.gold, fontSize: 14, fontFamily: fonts.sans },
  stop: {
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 158, 199, 0.4)'
  },
  stopText: { color: colors.danger, fontSize: 12, fontFamily: fonts.sans },
  error: {
    color: colors.danger,
    fontSize: 12,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    lineHeight: 17
  },
  list: { padding: spacing.lg, gap: spacing.sm },
  empty: { color: colors.textDim, fontSize: 12, textAlign: 'center', paddingVertical: spacing.xxl },
  bubble: {
    maxWidth: '86%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: 'rgba(232, 201, 138, 0.14)' },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: colors.bgPanelSolid },
  bubbleText: { color: colors.textHi, fontSize: 14, lineHeight: 21, fontFamily: fonts.sans },
  cursor: { color: colors.gold, fontSize: 12 },
  // 外层只负责挂 marginBottom，内容样式留给 composer，两层职责分开
  composerWrap: { backgroundColor: colors.bgPanelSolid },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
    backgroundColor: colors.bgPanelSolid
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    color: colors.textHi,
    fontSize: 14,
    fontFamily: fonts.sans
  }
})
