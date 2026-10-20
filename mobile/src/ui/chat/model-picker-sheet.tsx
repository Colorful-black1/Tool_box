/**
 * 模型选择弹层（手机端）：搜索 + 列表，选中后写回当前档案。
 *
 * 为什么在聊天页而不是只在设置页：改模型是「会话中」的高频动作，
 * 桌面端本来就把模型下拉放在输入框旁（见 `chat-panel.tsx`），
 * 手机端之前只能去设置页改，手感差很多。
 *
 * 列表来自供应商的实时接口（`fetchModels`）；拉不到时降级为内置推荐，
 * 并把原因显示出来 —— 与桌面端语义一致。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { GhostButton } from '../../components/ui'
import { fetchModels } from '../../ai/model-fetcher'
import { useServices } from '../../runtime/services'
import { findAiProvider } from '../../shared-bridge'
import { colors, fonts, radius, spacing } from '../../theme'

export function ModelPickerSheet({
  visible,
  current,
  onSelect,
  onClose
}: {
  visible: boolean
  /** 当前档案正在用的模型 */
  current: string
  onSelect: (model: string) => void
  onClose: () => void
}): ReactNode {
  const { aiSettings, fetchImpl } = useServices()
  const [models, setModels] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setNote('')
    try {
      const view = await aiSettings.getView()
      const active = view.profiles.find((item) => item.id === view.activeId)
      if (!active) {
        setNote('尚未启用任何 AI 配置')
        return
      }
      // 档案里关掉了「显示实时列表」就只列内置推荐
      if (active.showRemoteModels === false) {
        setModels(findAiProvider(active.provider).models)
        return
      }
      const result = await fetchModels(
        aiSettings,
        { profileId: active.id, provider: active.provider, baseUrl: active.baseUrl },
        fetchImpl
      )
      setModels(result.models)
      if (result.message) setNote(result.message)
    } catch (loadError) {
      setNote(loadError instanceof Error ? loadError.message : '获取模型列表失败')
    } finally {
      setLoading(false)
    }
  }, [aiSettings, fetchImpl])

  useEffect(() => {
    if (!visible) {
      setQuery('')
      return
    }
    void load()
  }, [load, visible])

  const keyword = query.trim().toLowerCase()
  const visibleModels = keyword
    ? models.filter((item) => item.toLowerCase().includes(keyword))
    : models

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
          <Text style={styles.title}>选择模型</Text>
          <GhostButton label="关闭" onPress={onClose} />
        </View>

        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="搜索模型"
          placeholderTextColor={colors.textDim}
          accessibilityLabel="搜索模型"
        />

        {note ? <Text style={styles.note}>{note}</Text> : null}
        {loading ? <Text style={styles.note}>正在获取模型列表…</Text> : null}

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {visibleModels.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              onPress={() => {
                onSelect(item)
                onClose()
              }}
              style={[styles.row, item === current && styles.rowActive]}
            >
              <Text style={[styles.rowText, item === current && styles.rowTextActive]}>{item}</Text>
              {item === current ? <Text style={styles.tick}>✓</Text> : null}
            </Pressable>
          ))}
          {!loading && visibleModels.length === 0 ? (
            <Text style={styles.note}>没有匹配的模型</Text>
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
  note: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  list: { gap: 4, paddingBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineSoft
  },
  rowActive: { borderColor: colors.goldLine, backgroundColor: 'rgba(232, 201, 138, 0.08)' },
  rowText: { flex: 1, color: colors.textHi, fontSize: 13, fontFamily: fonts.mono },
  rowTextActive: { color: colors.gold },
  tick: { color: colors.gold, fontSize: 13 }
})
