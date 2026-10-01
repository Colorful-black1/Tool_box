/**
 * 密码条目编辑页（M5）：新建与编辑共用，`entry` 为 null 即新建。
 *
 * 解密失败的条目**禁止保存**：此时 `entry.password` 是占位提示
 * 「【解密失败：密钥不可用或数据损坏】」而不是真实密码，`savePassword` 又会
 * 无条件用传入值重新加密后覆盖 —— 一次误存就会把原始密文永久替换成占位文本。
 * 与其埋这个坑，不如直接拦住并提示「删除后重建」。
 * 要保留元数据只改备注这类需求，得给数据层加一条「不改密文」的局部更新路径。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'

import { Banner, Field, GhostButton, PrimaryButton } from '../../components/ui'
import { useServices } from '../../runtime/services'
import { useKeyboardInset } from '../keyboard'
import type { PasswordEntryView } from '../../shared-bridge'
import { colors, spacing } from '../../theme'

export function PasswordEditorScreen({
  entry,
  onBack
}: {
  entry: PasswordEntryView | null
  onBack: () => void
}): ReactNode {
  const { store } = useServices()
  const [title, setTitle] = useState(entry?.title ?? '')
  const [url, setUrl] = useState(entry?.url ?? '')
  const [account, setAccount] = useState(entry?.account ?? '')
  const [password, setPassword] = useState(entry?.password ?? '')
  const [remark, setRemark] = useState(entry?.remark ?? '')
  const [isFavorite, setIsFavorite] = useState(entry?.isFavorite ?? false)
  const [revealed, setRevealed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const keyboard = useKeyboardInset()

  const locked = entry !== null && !entry.isDecryptable

  const save = (): void => {
    if (locked) {
      setError('该条目无法解密，为避免覆盖原始密文已禁止保存。请删除后重新添加。')
      return
    }
    setBusy(true)
    void (async () => {
      try {
        await store.savePassword({
          id: entry?.id,
          title,
          url,
          account,
          password,
          remark,
          isFavorite
        })
        setError('')
        onBack()
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : '保存失败')
      } finally {
        setBusy(false)
      }
    })()
  }

  const remove = (): void => {
    if (!entry) return
    Alert.alert('删除条目', `确定删除「${entry.title}」？此操作不可撤销。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await store.deletePassword(entry.id)
            } catch (deleteError) {
              setError(deleteError instanceof Error ? deleteError.message : '删除失败')
            }
            onBack()
          })()
        }
      }
    ])
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <GhostButton label="返回" onPress={onBack} />
        {/* 标题必须能收缩并截断，否则「返回 + 标题 + 删除 + 保存」在窄屏上会把按钮挤掉 */}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {entry ? '编辑条目' : '新建条目'}
        </Text>
        <View style={styles.headerActions}>
          {entry ? <GhostButton label="删除" onPress={remove} /> : null}
          <PrimaryButton label="保存" onPress={save} busy={busy} disabled={locked} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: spacing.xxl + keyboard.offset }]}
        keyboardShouldPersistTaps="handled"
      >
        {locked ? (
          <Banner message="该条目在本设备上无法解密（密钥不可用或数据损坏）。为避免覆盖原始密文，已禁止保存。" />
        ) : null}
        {error ? <Banner message={error} /> : null}

        <Field label="名称" value={title} onChangeText={setTitle} placeholder="网站或服务名" />
        <Field
          label="网址"
          value={url}
          onChangeText={setUrl}
          placeholder="https://"
          autoCapitalize="none"
          keyboardType="url"
        />
        <Field label="账号" value={account} onChangeText={setAccount} autoCapitalize="none" />
        <Field
          label="密码"
          value={password}
          onChangeText={setPassword}
          secure={!revealed}
          autoCapitalize="none"
          hint={revealed ? '当前明文显示中' : '默认隐藏，点右侧「显示」可查看'}
        />
        <View style={styles.row}>
          <GhostButton label={revealed ? '隐藏密码' : '显示密码'} onPress={() => setRevealed((v) => !v)} />
          <GhostButton
            label={isFavorite ? '★ 已收藏' : '☆ 收藏'}
            onPress={() => setIsFavorite((v) => !v)}
          />
        </View>
        <Field label="备注" value={remark} onChangeText={setRemark} multiline />
      </ScrollView>
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
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 15, color: colors.textHi },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 0 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm }
})
