/**
 * 会话列表：新建、进入、删除。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import { GlassCard } from '../../components/placeholder-screen'
import { GhostButton, PrimaryButton } from '../../components/ui'
import { useServices } from '../../runtime/services'
import type { ConversationSummary } from '../../shared-bridge'
import { colors, fonts, spacing } from '../../theme'

export function ChatListScreen({
  onOpen
}: {
  onOpen: (conversationId: string) => void
}): ReactNode {
  const { store } = useServices()
  const [items, setItems] = useState<ConversationSummary[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    try {
      setItems(await store.listConversations())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取会话失败')
    }
  }, [store])

  useEffect(() => {
    void reload()
  }, [reload])

  const create = async (): Promise<void> => {
    setCreating(true)
    try {
      const conversation = await store.createConversation()
      await reload()
      onOpen(conversation.id)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '新建会话失败')
    } finally {
      setCreating(false)
    }
  }

  const remove = (item: ConversationSummary): void => {
    Alert.alert('删除会话', `确定删除「${item.title}」？该会话的全部消息会一并删除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await store.deleteConversation(item.id)
              await reload()
            } catch (deleteError) {
              setError(deleteError instanceof Error ? deleteError.message : '删除失败')
            }
          })()
        }
      }
    ])
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>星轨对话</Text>
          <Text style={styles.subtitle}>AI CHAT</Text>
        </View>
        <PrimaryButton label="新建" onPress={() => void create()} busy={creating} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <GlassCard>
            <Text style={styles.emptyTitle}>还没有会话</Text>
            <Text style={styles.emptyText}>
              点「新建」开始一段对话。首次使用请先到设置页配置一套 AI 档案并启用。
            </Text>
          </GlassCard>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(item.id)}
            onLongPress={() => remove(item)}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <GlassCard style={styles.item}>
              <View style={styles.itemRow}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.count}>{item.messageCount} 条</Text>
              </View>
              <Text style={styles.time}>{formatTime(item.updatedAtMs)}</Text>
            </GlassCard>
          </Pressable>
        )}
      />

      <View style={styles.footer}>
        <GhostButton label="刷新" onPress={() => void reload()} />
        <Text style={styles.footerHint}>长按会话可删除</Text>
      </View>
    </View>
  )
}

function formatTime(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md
  },
  title: { fontSize: 22, color: colors.textHi, fontFamily: fonts.serif },
  subtitle: { fontSize: 11, color: colors.textDim, letterSpacing: 2 },
  error: {
    color: colors.danger,
    fontSize: 12,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm
  },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.sm },
  item: { gap: 4 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  itemTitle: { flex: 1, fontSize: 15, color: colors.textHi },
  count: { fontSize: 10, color: colors.textDim },
  time: { fontSize: 10, color: colors.textDim, fontFamily: fonts.mono },
  emptyTitle: { fontSize: 14, color: colors.textHi, marginBottom: spacing.xs },
  emptyText: { fontSize: 12, color: colors.textMid, lineHeight: 18 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm
  },
  footerHint: { fontSize: 10, color: colors.textDim },
  pressed: { opacity: 0.7 }
})
