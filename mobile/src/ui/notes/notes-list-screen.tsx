/**
 * 记事本列表：按最近更新倒序展示标题与摘要，支持新建、进入编辑、长按删除。
 *
 * 排序说明：数据层 `listNotes` 的 SQL 固定为 `updated_at_ms DESC`（最近更新优先）。
 * 这里不改数据层顺序 —— 它被 `verify:data` 与 `store.test.ts` 的断言覆盖，
 * 且「最近编辑的笔记排在最前」对随手记的场景比「按创建时间」更有用。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { File } from 'expo-file-system'

import { GlassCard } from '../../components/placeholder-screen'
import { ScreenHeader } from '../../components/screen'
import { GhostButton, PrimaryButton } from '../../components/ui'
import { readPickedTextFile } from '../../data/text-file'
import { useServices } from '../../runtime/services'
import type { NoteView } from '../../shared-bridge'
import { colors, fonts, spacing } from '../../theme'
import { noteTitleFromFileName } from './note-file'

export function NotesListScreen({
  onOpen,
  reloadSignal
}: {
  onOpen: (note: NoteView | null) => void
  /** 编辑页返回后自增，触发列表重载，避免显示编辑前的旧标题 */
  reloadSignal: number
}): ReactNode {
  const { store } = useServices()
  const [items, setItems] = useState<NoteView[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    try {
      setItems(await store.listNotes())
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取笔记失败')
    } finally {
      setLoading(false)
    }
  }, [store])

  useEffect(() => {
    void reload()
  }, [reload, reloadSignal])

  /** 搜索：标题或正文包含关键词即命中（本地过滤，笔记量级不需要走数据库） */
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter(
      (note) =>
        note.title.toLowerCase().includes(keyword) ||
        note.content.toLowerCase().includes(keyword)
    )
  }, [items, query])

  /** 导入 .md：选文件 → 读成文本 → 直接存成一篇笔记 */
  const importFromFile = async (): Promise<void> => {
    setImporting(true)
    setError('')
    setMessage('')
    try {
      const picked = await File.pickFileAsync()
      if (picked.canceled) return
      const content = await readPickedTextFile(picked.result)
      const title = noteTitleFromFileName(picked.result.name) || '导入的笔记'
      await store.saveNote({ title, content })
      await reload()
      setMessage(`已导入 ${picked.result.name}`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const remove = (note: NoteView): void => {
    Alert.alert('删除笔记', `确定删除「${note.title || '无标题'}」？此操作不可撤销。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await store.deleteNote(note.id)
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
      <ScreenHeader
        title="星笺手记"
        subtitle="NOTES · 星语落笔成笺"
        actions={
          <View style={styles.headerActions}>
            <GhostButton
              label={importing ? '导入中…' : '导入'}
              onPress={() => void importFromFile()}
              disabled={importing}
            />
            <PrimaryButton label="新建" onPress={() => onOpen(null)} />
          </View>
        }
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="搜索标题或正文"
        placeholderTextColor={colors.textDim}
        accessibilityLabel="搜索笔记"
      />

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <GlassCard>
            <Text style={styles.emptyTitle}>
              {loading ? '正在读取…' : items.length === 0 ? '还没有笔记' : '没有匹配的笔记'}
            </Text>
            {!loading ? (
              <Text style={styles.emptyText}>
                {items.length === 0
                  ? '点右上角「新建」写第一条，或用「导入」把 .md 文件收进来。所有内容只存在这台设备上。'
                  : '换个关键词再试试。'}
              </Text>
            ) : null}
          </GlassCard>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(item)}
            onLongPress={() => remove(item)}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <GlassCard style={styles.item}>
              <View style={styles.itemRow}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {item.title || '无标题'}
                </Text>
                <Text style={styles.time}>{formatTime(item.updatedAtMs)}</Text>
              </View>
              <Text style={styles.preview} numberOfLines={2}>
                {summarize(item.content)}
              </Text>
            </GlassCard>
          </Pressable>
        )}
      />

      <View style={styles.footer}>
        <GhostButton label="刷新" onPress={() => void reload()} />
        <Text style={styles.footerHint}>长按笔记可删除</Text>
      </View>
    </View>
  )
}

/** 摘要：压掉换行与多余空白，取首行前 80 字 */
function summarize(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  if (!flat) return '（空白）'
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
  message: {
    color: colors.textDim,
    fontSize: 11,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm
  },
  item: { gap: 4 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  itemTitle: { flex: 1, fontSize: 15, color: colors.textHi },
  time: { fontSize: 10, color: colors.textDim, fontFamily: fonts.mono },
  preview: { fontSize: 12, color: colors.textMid, lineHeight: 18 },
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
