/**
 * 书内搜索弹层：输入关键词 → 列出命中章节与片段 → 点击跳转。
 *
 * 桌面端有同名能力（`renderer/src/components/reader/search-sheet.tsx`），
 * 手机端此前没有，翻书时找不到某句话只能一章章翻。
 *
 * 检索放在数据层用 SQL 做（`store.searchChapters`）：
 * 整本书的正文一次性读进内存在手机上吃不消，这里只取命中的章节。
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { GhostButton } from '../../components/ui'
import { useServices } from '../../runtime/services'
import type { ChapterSearchHit } from '../../shared-bridge'
import { colors, fonts, radius, spacing } from '../../theme'

/** 输入防抖：和桌面端一致，避免每敲一个字就查一次库 */
const SEARCH_DEBOUNCE_MS = 300

export function ReaderSearchSheet({
  visible,
  bookId,
  onSelect,
  onClose
}: {
  visible: boolean
  bookId: string
  onSelect: (hit: ChapterSearchHit) => void
  onClose: () => void
}): ReactNode {
  const { store } = useServices()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ChapterSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) {
      setQuery('')
      setHits([])
      setSearched(false)
      setError('')
      return
    }

    const keyword = query.trim()
    if (!keyword) {
      setHits([])
      setSearched(false)
      setSearching(false)
      return
    }

    let disposed = false
    setSearching(true)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await store.searchChapters(bookId, keyword)
          if (disposed) return
          setHits(found)
          setSearched(true)
        } catch (searchError) {
          if (disposed) return
          setError(searchError instanceof Error ? searchError.message : '搜索失败')
        } finally {
          if (!disposed) setSearching(false)
        }
      })()
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [bookId, query, store, visible])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="关闭" />
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>书内搜索</Text>
          <GhostButton label="关闭" onPress={onClose} />
        </View>

        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="输入关键词"
          placeholderTextColor={colors.textDim}
          autoFocus
          returnKeyType="search"
          accessibilityLabel="搜索关键词"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {hits.map((hit, index) => (
            <Pressable
              key={`${hit.chapterIdx}-${index}`}
              style={styles.hit}
              onPress={() => onSelect(hit)}
              accessibilityRole="button"
              accessibilityLabel={`跳到第 ${hit.chapterIdx + 1} 章`}
            >
              <Text style={styles.chapter} numberOfLines={1}>
                第 {hit.chapterIdx + 1} 章 · {hit.chapterTitle}
              </Text>
              <Text style={styles.snippet} numberOfLines={3}>
                {hit.before}
                <Text style={styles.match}>{hit.match}</Text>
                {hit.after}
              </Text>
            </Pressable>
          ))}

          {searching ? <Text style={styles.hint}>搜索中…</Text> : null}
          {!searching && searched && hits.length === 0 ? (
            <Text style={styles.hint}>没有找到「{query.trim()}」</Text>
          ) : null}
          {!searching && !searched && query.trim().length === 0 ? (
            <Text style={styles.hint}>输入关键词，在整本书里查找</Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  card: {
    maxHeight: '78%',
    backgroundColor: colors.bgPanelSolid,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.goldLine,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.textHi, fontSize: 15, fontFamily: fonts.serif, letterSpacing: 2 },
  input: {
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    color: colors.textHi,
    fontSize: 14
  },
  error: { color: colors.danger, fontSize: 12 },
  list: { gap: spacing.sm, paddingBottom: spacing.md },
  hit: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    gap: 4
  },
  chapter: { color: colors.gold, fontSize: 12 },
  snippet: { color: colors.textMid, fontSize: 13, lineHeight: 19 },
  match: { color: colors.gold, fontWeight: 'bold' },
  hint: { color: colors.textDim, fontSize: 12, textAlign: 'center', paddingVertical: spacing.lg }
})
