/**
 * 会话列表：新建、进入、重命名、删除、搜索。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { GlassCard } from '../../components/placeholder-screen'
import { ScreenHeader } from '../../components/screen'
import { GhostButton, PrimaryButton, PromptModal } from '../../components/ui'
import { useServices } from '../../runtime/services'
import type { ConversationSummary } from '../../shared-bridge'
import { colors, fonts, spacing } from '../../theme'

export function ChatListScreen({
  onOpen,
  reloadSignal,
  createSignal = 0
}: {
  onOpen: (conversation: ConversationSummary) => void
  /** 详情页返回后自增，触发列表重载 */
  reloadSignal: number
  /** 长按 Tab 触发的新建信号：变化时新建并进入一个会话 */
  createSignal?: number
}): ReactNode {
  const { store } = useServices()
  const [items, setItems] = useState<ConversationSummary[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    try {
      setItems(await store.listConversations())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取会话失败')
    }
  }, [store])

  useEffect(() => {
    void reload()
  }, [reload, reloadSignal])

  /** 搜索：按标题过滤（会话量级不大，本地过滤即可） */
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((item) => item.title.toLowerCase().includes(keyword))
  }, [items, query])

  const create = useCallback(async (): Promise<void> => {
    setCreating(true)
    try {
      const conversation = await store.createConversation()
      await reload()
      onOpen(conversation)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '新建会话失败')
    } finally {
      setCreating(false)
    }
  }, [onOpen, reload, store])

  // 长按 Tab「对话」→ 直接新建并进入
  useEffect(() => {
    if (createSignal === 0) return
    void create()
  }, [create, createSignal])

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

  /** 长按会话：给「重命名 / 删除」两个动作 */
  const actions = (item: ConversationSummary): void => {
    Alert.alert(item.title, '选择一个操作', [
      { text: '重命名', onPress: () => setRenaming(item) },
      { text: '删除', style: 'destructive', onPress: () => remove(item) },
      { text: '取消', style: 'cancel' }
    ])
  }

  const rename = (target: ConversationSummary, title: string): void => {
    void (async () => {
      try {
        await store.renameConversation(target.id, title)
        await reload()
      } catch (renameError) {
        setError(renameError instanceof Error ? renameError.message : '重命名失败')
      }
    })()
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="星轨对话"
        subtitle="AI CHAT"
        actions={<PrimaryButton label="新建" onPress={() => void create()} busy={creating} />}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="搜索会话标题"
        placeholderTextColor={colors.textDim}
        accessibilityLabel="搜索会话"
      />

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <GlassCard>
            <Text style={styles.emptyTitle}>
              {items.length === 0 ? '还没有会话' : '没有匹配的会话'}
            </Text>
            <Text style={styles.emptyText}>
              {items.length === 0
                ? '点「新建」开始一段对话。首次使用请先到设置页配置一套 AI 档案并启用。'
                : '换个关键词再试试。'}
            </Text>
          </GlassCard>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(item)}
            onLongPress={() => actions(item)}
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
        <Text style={styles.footerHint}>长按会话可重命名或删除</Text>
      </View>

      <PromptModal
        visible={renaming !== null}
        title="重命名会话"
        initialValue={renaming?.title ?? ''}
        onCancel={() => setRenaming(null)}
        onConfirm={(title) => {
          const target = renaming
          setRenaming(null)
          if (target) rename(target, title)
        }}
      />
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
  error: {
    color: colors.danger,
    fontSize: 12,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm
  },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.sm },
  search: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
    backgroundColor: colors.bgPanelSolid,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    color: colors.textHi,
    fontSize: 14
  },
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
