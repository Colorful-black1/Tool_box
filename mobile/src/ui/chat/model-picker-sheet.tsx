/**
 * 模型选择弹层（手机端）：搜索 + 列表，选中后写回当前档案。
 *
 * 为什么在聊天页而不是只在设置页：改模型是「会话中」的高频动作，
 * 桌面端本来就把模型下拉放在输入框旁（见 `chat-panel.tsx`），
 * 手机端之前只能去设置页改，手感差很多。
 *
 * 列表来自档案里**勾选过的模型**（设置页多选），一个都没勾时回落到供应商内置推荐。
 * 这里不请求供应商接口：目录动辄三四十个，全塞进来既难看又难找，
 * 想加模型去设置页勾选即可。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { GhostButton } from '../../components/ui'
import { useServices } from '../../runtime/services'
import { findAiProvider, resolveChatModels } from '../../shared-bridge'
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
  const { aiSettings } = useServices()
  const [models, setModels] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setNote('')
    try {
      const view = await aiSettings.getView()
      const active = view.profiles.find((item) => item.id === view.activeId)
      if (!active) {
        setModels([])
        setNote('尚未启用任何 AI 配置')
        return
      }
      setModels(
        resolveChatModels(
          active.model,
          active.selectedModels,
          findAiProvider(active.provider).models
        )
      )
    } catch (loadError) {
      setModels([])
      setNote(loadError instanceof Error ? loadError.message : '读取模型清单失败')
    }
  }, [aiSettings])

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
          {visibleModels.length === 0 ? (
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
