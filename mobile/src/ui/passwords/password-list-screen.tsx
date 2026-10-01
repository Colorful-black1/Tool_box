/**
 * 密码箱列表（M5）：按拼音首字母分组、搜索、收藏筛选、复制、编辑、删除。
 *
 * 分组字母由数据层算好（`MobileStore.savePassword` 落库时写入 `first_letter`，
 * 复用桌面端共享的 `pinyinFirstLetter`），列表只负责按它分段，不在前端重算 ——
 * 两端分组口径必须一致，否则「导出的条目在两端落在不同字母下」会很费解。
 *
 * 剪贴板用 react-native core 的 `Clipboard`：它已被标记 `@deprecated`
 * （官方建议迁到 `@react-native-clipboard/clipboard`），但在本项目当前的
 * RN 0.86 上仍可用，且能避免为这一个功能新增原生依赖。
 * 真机验收时若发现复制无效，第一顺位排查点就是这里。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'
import { Clipboard } from 'react-native'

import { GlassCard } from '../../components/placeholder-screen'
import { ScreenHeader } from '../../components/screen'
import { Chip, ChipRow, GhostButton, PrimaryButton } from '../../components/ui'
import { useServices } from '../../runtime/services'
import type { PasswordEntryView } from '../../shared-bridge'
import { filterEntries, groupByLetter } from './password-groups'
import { colors, fonts, radius, spacing } from '../../theme'

export function PasswordListScreen({
  reloadSignal,
  onOpen,
  onImport
}: {
  reloadSignal: number
  onOpen: (entry: PasswordEntryView | null) => void
  onImport: () => void
}): ReactNode {
  const { store } = useServices()
  const [items, setItems] = useState<PasswordEntryView[]>([])
  const [query, setQuery] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const reload = useCallback(async (): Promise<void> => {
    try {
      setItems(await store.listPasswords())
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取密码箱失败')
    }
  }, [store])

  useEffect(() => {
    void reload()
  }, [reload, reloadSignal])

  const sections = useMemo(() => groupByLetter(filterEntries(items, query, favoritesOnly)), [
    favoritesOnly,
    items,
    query
  ])

  /** 短暂提示，替代 Toast（本项目没有引入任何 Toast 依赖） */
  const flash = useCallback((message: string): void => {
    setToast(message)
    setTimeout(() => setToast(''), 1600)
  }, [])

  const copyField = (entry: PasswordEntryView, field: 'password' | 'account'): void => {
    if (!entry.isDecryptable) {
      flash('该条目无法解密，未复制')
      return
    }
    const value = field === 'password' ? entry.password : entry.account
    if (!value) {
      flash(field === 'password' ? '该条目没有密码' : '该条目没有账号')
      return
    }
    Clipboard.setString(value)
    flash(field === 'password' ? '密码已复制到剪贴板' : '账号已复制到剪贴板')
  }

  const toggleFavorite = (entry: PasswordEntryView): void => {
    void (async () => {
      try {
        await store.setPasswordFavorite(entry.id, !entry.isFavorite)
        await reload()
      } catch (toggleError) {
        setError(toggleError instanceof Error ? toggleError.message : '操作失败')
      }
    })()
  }

  const remove = (entry: PasswordEntryView): void => {
    Alert.alert('删除条目', `确定删除「${entry.title}」？此操作不可撤销。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await store.deletePassword(entry.id)
              await reload()
            } catch (deleteError) {
              setError(deleteError instanceof Error ? deleteError.message : '删除失败')
            }
          })()
        }
      }
    ])
  }

  const openMenu = (entry: PasswordEntryView): void => {
    Alert.alert(entry.title, '选择操作', [
      { text: '编辑', onPress: () => onOpen(entry) },
      { text: entry.isFavorite ? '取消收藏' : '加入收藏', onPress: () => toggleFavorite(entry) },
      { text: '复制账号', onPress: () => copyField(entry, 'account') },
      { text: '复制密码', onPress: () => copyField(entry, 'password') },
      { text: '删除', style: 'destructive', onPress: () => remove(entry) },
      { text: '取消', style: 'cancel' }
    ])
  }

  const favorites = items.filter((item) => item.isFavorite).length

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="密码宝匣"
        subtitle="PASSWORD VAULT · 秘语封存于此"
        actions={
          <>
            <GhostButton label="导入" onPress={onImport} />
            <PrimaryButton label="新建" onPress={() => onOpen(null)} />
          </>
        }
      />

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="搜索名称 / 账号 / 网址"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="搜索密码条目"
      />

      <ChipRow contentContainerStyle={styles.chipRow}>
        <Chip label="全部" active={!favoritesOnly} onPress={() => setFavoritesOnly(false)} />
        <Chip
          label={`收藏 ${favorites}`}
          active={favoritesOnly}
          onPress={() => setFavoritesOnly(true)}
        />
      </ChipRow>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <GlassCard>
            <Text style={styles.emptyTitle}>
              {query || favoritesOnly ? '没有匹配的条目' : '密码箱还是空的'}
            </Text>
            <Text style={styles.emptyText}>
              {query || favoritesOnly
                ? '换个关键词，或关掉「收藏」筛选。'
                : '点「新建」手动添加，或用「导入」从一段文本批量导入。'}
            </Text>
          </GlassCard>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(item)}
            onLongPress={() => openMenu(item)}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <GlassCard style={styles.item}>
              <View style={styles.itemRow}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {item.isFavorite ? '★ ' : ''}
                  {item.title}
                </Text>
                <Text style={styles.itemLetter}>{item.firstLetter}</Text>
              </View>
              {item.account ? (
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {item.account}
                </Text>
              ) : null}
              {item.url ? (
                <Text style={styles.itemUrl} numberOfLines={1}>
                  {item.url}
                </Text>
              ) : null}
              {/* 解密失败只给占位提示，不暴露异常细节，也不提供复制 */}
              {!item.isDecryptable ? (
                <Text style={styles.itemBroken}>无法解密，请检查设备密钥后重试</Text>
              ) : (
                <View style={styles.itemActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="复制账号"
                    onPress={() => copyField(item, 'account')}
                    style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.copyLabel}>复制账号</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="复制密码"
                    onPress={() => copyField(item, 'password')}
                    style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.copyLabel}>复制密码</Text>
                  </Pressable>
                </View>
              )}
            </GlassCard>
          </Pressable>
        )}
      />

      {toast ? <Text style={styles.toast}>{toast}</Text> : null}
      <Text style={styles.footerHint}>长按条目可编辑、收藏或删除</Text>
    </View>
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
  error: { color: colors.danger, fontSize: 12, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.sm },
  sectionHeader: {
    color: colors.gold,
    fontSize: 12,
    letterSpacing: 1,
    marginTop: spacing.sm
  },
  item: { gap: 3 },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemTitle: { flex: 1, fontSize: 15, color: colors.textHi },
  itemLetter: { fontSize: 10, color: colors.textDim, fontFamily: fonts.mono },
  itemMeta: { fontSize: 12, color: colors.textMid },
  itemUrl: { fontSize: 11, color: colors.textDim, fontFamily: fonts.mono },
  itemBroken: { fontSize: 11, color: colors.danger },
  itemActions: { flexDirection: 'row', gap: spacing.sm, marginTop: 3 },
  copyButton: {
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.goldLine,
    borderRadius: radius.sm
  },
  copyLabel: { color: colors.gold, fontSize: 11 },
  emptyTitle: { fontSize: 14, color: colors.textHi, marginBottom: spacing.xs },
  emptyText: { fontSize: 12, color: colors.textMid, lineHeight: 18 },
  toast: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: 60,
    textAlign: 'center',
    color: colors.bgDeep,
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    fontSize: 12,
    overflow: 'hidden'
  },
  footerHint: {
    fontSize: 10,
    color: colors.textDim,
    textAlign: 'center',
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl
  },
  pressed: { opacity: 0.7 }
})
