/**
 * 阅读设置弹窗：字号、行距、字体、主题、夜间模式、翻页方式。
 *
 * 纯展示组件 —— 不碰数据层，改动通过 `onChange` 抛给阅读页统一落盘，
 * 避免弹窗自己写一半就关闭、把用户的选择吞掉。
 *
 * 字体选项不复用桌面端 `FONT_OPTIONS`（SimSun / SimHei / 楷体…）：
 * 那些是 Windows 字体名，在 Android / iOS 上不存在，写进 StyleSheet 只会静默
 * 回退到系统默认，等于给用户一批「点了没反应」的选项。这里改用
 * Android / iOS 都存在的三个通用字体族。
 */
import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { Chip, GhostButton } from '../../components/ui'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  MOBILE_PAGE_MODES,
  PAGE_MODE_LABELS,
  themeOf
} from '../../data/reader-config'
import type { ReaderPrefs } from '../../data/reader-config'
import { READER_THEMES } from '../../shared-bridge'
import type { PageMode } from '../../shared-bridge'
import { colors, fonts, radius, spacing } from '../../theme'

/** Android / iOS 通用的字体族；空串 = 跟随系统 */
const MOBILE_FONTS: Array<{ value: string; label: string }> = [
  { value: '', label: '默认' },
  { value: 'serif', label: '衬线' },
  { value: 'sans-serif', label: '无衬线' },
  { value: 'monospace', label: '等宽' }
]

export function ReaderSettingsSheet({
  visible,
  prefs,
  onChange,
  onClose
}: {
  visible: boolean
  prefs: ReaderPrefs
  onChange: (next: ReaderPrefs) => void
  onClose: () => void
}): ReactNode {
  const theme = themeOf(prefs)

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
          <Text style={styles.title}>阅读设置</Text>
          <GhostButton label="完成" onPress={onClose} />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.preview} accessibilityLabel="预览效果">
            <Text
              style={{
                color: theme.foreground,
                backgroundColor: theme.background,
                fontSize: prefs.fontSize,
                lineHeight: prefs.fontSize * prefs.lineSpacing,
                fontFamily: prefs.fontFamily || undefined,
                padding: spacing.md,
                borderRadius: radius.md,
                width: '100%'
              }}
            >
              天地玄黄，宇宙洪荒。
            </Text>
          </View>

          <Text style={styles.label}>字号 {prefs.fontSize}</Text>
          <View style={styles.stepRow}>
            <Stepper
              label="A−"
              disabled={prefs.fontSize <= FONT_SIZE_MIN}
              onPress={() => onChange({ ...prefs, fontSize: prefs.fontSize - 1 })}
            />
            <Stepper
              label="A+"
              disabled={prefs.fontSize >= FONT_SIZE_MAX}
              onPress={() => onChange({ ...prefs, fontSize: prefs.fontSize + 1 })}
            />
          </View>

          <Text style={styles.label}>行距 {prefs.lineSpacing.toFixed(1)}</Text>
          <View style={styles.stepRow}>
            <Stepper
              label="紧凑"
              disabled={prefs.lineSpacing <= LINE_SPACING_MIN}
              onPress={() =>
                onChange({ ...prefs, lineSpacing: round1(prefs.lineSpacing - 0.1) })
              }
            />
            <Stepper
              label="宽松"
              disabled={prefs.lineSpacing >= LINE_SPACING_MAX}
              onPress={() =>
                onChange({ ...prefs, lineSpacing: round1(prefs.lineSpacing + 0.1) })
              }
            />
          </View>

          <Text style={styles.label}>字体</Text>
          <View style={styles.chipRow}>
            {MOBILE_FONTS.map((option) => (
              <Chip
                key={option.value || 'default'}
                label={option.label}
                active={prefs.fontFamily === option.value}
                onPress={() => onChange({ ...prefs, fontFamily: option.value })}
              />
            ))}
          </View>

          <Text style={styles.label}>翻页方式</Text>
          <View style={styles.chipRow}>
            {MOBILE_PAGE_MODES.map((mode: PageMode) => (
              <Chip
                key={mode}
                label={PAGE_MODE_LABELS[mode]}
                active={prefs.pageMode === mode}
                onPress={() => onChange({ ...prefs, pageMode: mode })}
              />
            ))}
          </View>

          <Text style={styles.label}>背景主题</Text>
          <View style={styles.chipRow}>
            {READER_THEMES.map((item, index) => (
              <Chip
                key={item.name}
                label={item.name}
                active={!prefs.nightMode && prefs.themeIndex === index}
                onPress={() => onChange({ ...prefs, nightMode: false, themeIndex: index })}
              />
            ))}
          </View>

          <Text style={styles.label}>夜间模式</Text>
          <View style={styles.chipRow}>
            <Chip
              label={prefs.nightMode ? '已开启' : '已关闭'}
              active={prefs.nightMode}
              onPress={() => onChange({ ...prefs, nightMode: !prefs.nightMode })}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

function Stepper({
  label,
  disabled,
  onPress
}: {
  label: string
  disabled: boolean
  onPress: () => void
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stepper,
        disabled && styles.stepperDisabled,
        pressed && !disabled && styles.stepperPressed
      ]}
    >
      <Text style={styles.stepperLabel}>{label}</Text>
    </Pressable>
  )
}

/** 行距按 0.1 步进，浮点累加会出现 1.7000000000000002 这类值 */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8, 11, 22, 0.72)' },
  card: {
    maxHeight: '80%',
    backgroundColor: colors.bgPanelSolid,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm
  },
  title: { color: colors.textHi, fontSize: 16 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  preview: { paddingVertical: spacing.sm },
  label: { color: colors.textDim, fontSize: 11, letterSpacing: 1, marginTop: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stepRow: { flexDirection: 'row', gap: spacing.sm },
  stepper: {
    paddingVertical: 9,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md
  },
  stepperDisabled: { opacity: 0.35 },
  stepperPressed: { opacity: 0.7 },
  stepperLabel: { color: colors.gold, fontSize: 13, fontFamily: fonts.sans }
})
