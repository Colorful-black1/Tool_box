/**
 * 书架（M4）：导入 TXT、分组、排序、搜索、进入阅读、阅读统计入口。
 *
 * 排序放在**界面层**做，不动数据层的 SQL：
 * 数据层 `listBooks` 的 ORDER BY 固定为「最近在读的排前面 → sort_index 升序」，
 * 那是桌面的单一排序策略。手机端要提供多种排序，若改 SQL 就得连带改
 * `store.test.ts` 与 `verify:data` 的断言；这里拿到全量结果后在 JS 里重排，
 * 数据层零改动，两端行为也不会互相影响。
 *
 * 排序语义与桌面端 `BookshelfSort` 对齐：
 * - manual：按 sortIndex（手动排序，↑↓ 只在此模式下可用）
 * - recentRead：最近在读的排前面，没读过的排后面
 * - addedTime：按加入时间倒序
 * - title：按标题
 *
 * ↑↓ 之所以只在「手动排序」下生效：`reorderBooks` 是按传入顺序重写
 * sort_index = 0,1,2…，只有当显示顺序本来就等于 sortIndex 顺序时才无歧义。
 * 其他模式下按显示顺序回写会让「最近在读」和「手动序」互相打架。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { File } from 'expo-file-system'

import { GlassCard } from '../../components/placeholder-screen'
import { ScreenHeader } from '../../components/screen'
import { Chip, ChipRow, GhostButton, PrimaryButton, PromptModal } from '../../components/ui'
import { buildImportedBook } from '../../data/book-import'
import { useServices } from '../../runtime/services'
import type { BookGroup, BookSummary } from '../../shared-bridge'
import { SORT_OPTIONS, sortBooks } from './bookshelf-sort'
import type { BookshelfSort } from './bookshelf-sort'
import { colors, fonts, radius, spacing } from '../../theme'

type GroupDialog =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'rename'; group: BookGroup }
  | { kind: 'pick'; book: BookSummary }

export function BookshelfScreen({
  onOpenBook,
  onOpenStats,
  reloadSignal
}: {
  onOpenBook: (book: BookSummary) => void
  onOpenStats: () => void
  reloadSignal: number
}): ReactNode {
  const { store } = useServices()
  const [books, setBooks] = useState<BookSummary[]>([])
  const [groups, setGroups] = useState<BookGroup[]>([])
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<BookshelfSort>('recentRead')
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [dialog, setDialog] = useState<GroupDialog>({ kind: 'none' })

  const reload = useCallback(async (): Promise<void> => {
    try {
      // 搜索交给 SQL（listBooks 自带 LIKE 过滤），分组筛选在界面层做
      const [list, groupList] = await Promise.all([store.listBooks(query), store.listGroups()])
      setBooks(list)
      setGroups(groupList)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取书架失败')
    }
  }, [query, store])

  useEffect(() => {
    void reload()
  }, [reload, reloadSignal])

  // 分组被删掉后，当前筛选指向的分组已不存在，必须退回「全部」，
  // 否则列表会一直空着且用户看不到原因。
  useEffect(() => {
    if (groupFilter && !groups.some((group) => group.id === groupFilter)) setGroupFilter(null)
  }, [groupFilter, groups])

  const visibleBooks = useMemo(() => {
    const filtered =
      groupFilter === null ? books : books.filter((book) => book.groupId === groupFilter)
    return sortBooks(filtered, sortMode)
  }, [books, groupFilter, sortMode])

  const move = async (book: BookSummary, delta: number): Promise<void> => {
    const index = visibleBooks.findIndex((item) => item.id === book.id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= visibleBooks.length) return

    const next = [...visibleBooks]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    try {
      await store.reorderBooks(next.map((item) => item.id))
      setError('')
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : '调整顺序失败')
    }
  }

  const remove = (book: BookSummary): void => {
    Alert.alert(
      '删除书籍',
      `确定删除《${book.title}》？${book.chapterCount} 个章节、进度与书签会一并删除，不可撤销。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await store.deleteBook(book.id)
                await reload()
              } catch (deleteError) {
                setError(deleteError instanceof Error ? deleteError.message : '删除失败')
              }
            })()
          }
        }
      ]
    )
  }

  const openMenu = (book: BookSummary): void => {
    Alert.alert(book.title, '选择操作', [
      ...(sortMode === 'manual'
        ? [
            { text: '上移一位', onPress: () => void move(book, -1) },
            { text: '下移一位', onPress: () => void move(book, 1) }
          ]
        : []),
      { text: '归入分组…', onPress: () => setDialog({ kind: 'pick', book }) },
      { text: '移出分组', onPress: () => void assignGroup(book, null) },
      { text: '删除', style: 'destructive' as const, onPress: () => remove(book) },
      { text: '取消', style: 'cancel' as const }
    ])
  }

  const assignGroup = async (book: BookSummary, groupId: string | null): Promise<void> => {
    try {
      await store.setBooksGroup([book.id], groupId)
      await reload()
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : '设置分组失败')
    }
  }

  const importBook = async (): Promise<void> => {
    setImporting(true)
    try {
      // 不限定 mimeTypes：各家文件管理器把 .txt 报成 text/plain 还是
      // application/octet-stream 并不统一，限死反而可能选不到文件。
      const picked = await File.pickFileAsync()
      if (picked.canceled) return

      const bytes = new Uint8Array(await picked.result.arrayBuffer())
      const book = buildImportedBook(picked.result.name, bytes)
      await store.importBook({ title: book.title, author: '', chapters: book.chapters })
      await reload()
      setError('')
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="星轨书架"
        subtitle="BOOKSHELF · 愿此行，终抵群星"
        actions={
          <>
            <GhostButton label="统计" onPress={onOpenStats} />
            <PrimaryButton label="导入" onPress={() => void importBook()} busy={importing} />
          </>
        }
      />

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="搜索书名或作者"
        placeholderTextColor={colors.textDim}
        returnKeyType="search"
        accessibilityLabel="搜索书名或作者"
      />

      {/* 两个筛选行必须用 ChipRow：裸的横向 ScrollView 会被 ScrollView 自带的
          flexGrow: 1 拉高成占满半屏的巨大椭圆 */}
      <ChipRow contentContainerStyle={styles.chipRow}>
        <Chip label="全部" active={groupFilter === null} onPress={() => setGroupFilter(null)} />
        {groups.map((group) => (
          <Chip
            key={group.id}
            label={group.name}
            active={groupFilter === group.id}
            onPress={() => setGroupFilter(group.id)}
          />
        ))}
        <Chip label="＋ 新建分组" onPress={() => setDialog({ kind: 'create' })} />
      </ChipRow>

      <ChipRow contentContainerStyle={styles.chipRow}>
        {SORT_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={sortMode === option.value}
            onPress={() => setSortMode(option.value)}
          />
        ))}
      </ChipRow>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={visibleBooks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <GlassCard>
            <Text style={styles.emptyTitle}>这里还没有书</Text>
            <Text style={styles.emptyText}>
              点右上角「导入」选择一个 TXT 文件。手机端支持 UTF-8 与 UTF-16；
              GBK / ANSI 文件请先用文本编辑器转存为 UTF-8。
            </Text>
          </GlassCard>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpenBook(item)}
            onLongPress={() => openMenu(item)}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <GlassCard style={styles.item}>
              <View style={styles.itemRow}>
                <View style={styles.itemMain}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.itemMeta} numberOfLines={1}>
                    {[item.author, `${item.chapterCount} 章`].filter(Boolean).join(' · ')}
                  </Text>
                  {item.progress ? (
                    <Text style={styles.itemProgress}>
                      读到第 {item.progress.chapterIdx + 1} 章（
                      {Math.round(item.progress.percent * 100)}%）
                    </Text>
                  ) : (
                    <Text style={styles.itemProgress}>未开始</Text>
                  )}
                </View>
                {sortMode === 'manual' ? (
                  <View style={styles.moveColumn}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="上移"
                      onPress={() => void move(item, -1)}
                      style={({ pressed }) => [styles.moveButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.moveLabel}>↑</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="下移"
                      onPress={() => void move(item, 1)}
                      style={({ pressed }) => [styles.moveButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.moveLabel}>↓</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </GlassCard>
          </Pressable>
        )}
      />

      <Text style={styles.footerHint}>长按书籍可改分组或删除；↑↓ 仅在「手动」排序下可用</Text>

      <GroupDialogs
        dialog={dialog}
        groups={groups}
        onClose={() => setDialog({ kind: 'none' })}
        onAssign={(book, groupId) => {
          setDialog({ kind: 'none' })
          void assignGroup(book, groupId)
        }}
        onCreateGroup={(name) => {
          setDialog({ kind: 'none' })
          void (async () => {
            try {
              await store.createGroup(name)
              await reload()
            } catch (createError) {
              setError(createError instanceof Error ? createError.message : '新建分组失败')
            }
          })()
        }}
        onRequestRename={(group) => setDialog({ kind: 'rename', group })}
        onCommitRename={(group, name) => {
          setDialog({ kind: 'none' })
          void (async () => {
            try {
              await store.renameGroup(group.id, name)
              await reload()
            } catch (renameError) {
              setError(renameError instanceof Error ? renameError.message : '重命名分组失败')
            }
          })()
        }}
        onDeleteGroup={(group) => {
          setDialog({ kind: 'none' })
          void (async () => {
            try {
              await store.deleteGroup(group.id)
              await reload()
            } catch (deleteError) {
              setError(deleteError instanceof Error ? deleteError.message : '删除分组失败')
            }
          })()
        }}
      />
    </View>
  )
}

/** 分组相关的三个弹窗：新建 / 重命名 / 挑分组 */
function GroupDialogs({
  dialog,
  groups,
  onClose,
  onAssign,
  onCreateGroup,
  onRequestRename,
  onCommitRename,
  onDeleteGroup
}: {
  dialog: GroupDialog
  groups: BookGroup[]
  onClose: () => void
  onAssign: (book: BookSummary, groupId: string | null) => void
  onCreateGroup: (name: string) => void
  /** 只负责把弹窗切到重命名态，真正改名由 onCommitRename 执行 */
  onRequestRename: (group: BookGroup) => void
  onCommitRename: (group: BookGroup, name: string) => void
  onDeleteGroup: (group: BookGroup) => void
}): ReactNode {
  return (
    <>
      <PromptModal
        visible={dialog.kind === 'create'}
        title="新建分组"
        placeholder="分组名称"
        onCancel={onClose}
        onConfirm={onCreateGroup}
      />
      <PromptModal
        visible={dialog.kind === 'rename'}
        title="重命名分组"
        placeholder="分组名称"
        initialValue={dialog.kind === 'rename' ? dialog.group.name : ''}
        onCancel={onClose}
        onConfirm={(name) => {
          if (dialog.kind === 'rename') onCommitRename(dialog.group, name)
        }}
      />

      <Modal
        visible={dialog.kind === 'pick'}
        transparent
        animationType="fade"
        onRequestClose={onClose}
        accessibilityViewIsModal
      >
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="关闭" />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>归入分组</Text>
          <Text style={styles.modalSubtitle}>
            {dialog.kind === 'pick' ? dialog.book.title : ''}
          </Text>
          <ScrollView style={styles.modalList}>
            {groups.map((group) => (
              <Pressable
                key={group.id}
                accessibilityRole="button"
                onPress={() => {
                  if (dialog.kind === 'pick') onAssign(dialog.book, group.id)
                }}
                onLongPress={() =>
                  Alert.alert(group.name, '长按可改名或删除分组', [
                    { text: '重命名', onPress: () => onRequestRename(group) },
                    { text: '删除分组', style: 'destructive', onPress: () => onDeleteGroup(group) },
                    { text: '取消', style: 'cancel' }
                  ])
                }
                style={({ pressed }) => [styles.modalRow, pressed && styles.pressed]}
              >
                <Text style={styles.modalRowLabel}>{group.name}</Text>
              </Pressable>
            ))}
            {groups.length === 0 ? (
              <Text style={styles.modalEmpty}>还没有分组，先在书架上方新建一个。</Text>
            ) : null}
          </ScrollView>
          <View style={styles.modalActions}>
            <GhostButton label="取消" onPress={onClose} />
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  search: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.bgPanelSolid,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    color: colors.textHi,
    fontSize: 13
  },
  chipRow: { paddingHorizontal: spacing.xl },
  error: {
    color: colors.danger,
    fontSize: 12,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm
  },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.sm },
  item: { gap: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemMain: { flex: 1, gap: 2 },
  itemTitle: { fontSize: 15, color: colors.textHi },
  itemMeta: { fontSize: 11, color: colors.textMid },
  itemProgress: { fontSize: 10, color: colors.textDim, fontFamily: fonts.mono },
  moveColumn: { gap: spacing.xs },
  moveButton: {
    width: 30,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm
  },
  moveLabel: { color: colors.gold, fontSize: 14 },
  emptyTitle: { fontSize: 14, color: colors.textHi, marginBottom: spacing.xs },
  emptyText: { fontSize: 12, color: colors.textMid, lineHeight: 18 },
  footerHint: {
    fontSize: 10,
    color: colors.textDim,
    textAlign: 'center',
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl
  },
  pressed: { opacity: 0.7 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(8, 11, 22, 0.72)' },
  modalCard: {
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.bgPanelSolid,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg
  },
  modalTitle: { color: colors.textHi, fontSize: 16 },
  modalSubtitle: { fontSize: 11, color: colors.textDim },
  modalList: { maxHeight: 280 },
  modalRow: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  modalRowLabel: { color: colors.textHi, fontSize: 14 },
  modalEmpty: { color: colors.textDim, fontSize: 12, paddingVertical: spacing.md },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: spacing.sm }
})
