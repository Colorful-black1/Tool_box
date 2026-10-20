/**
 * 共用 UI 原子组件。
 *
 * 复用 `theme.ts` 的设计令牌与 `GlassCard`，不另立一套样式体系
 * （与桌面端「复用 global.css 设计系统」保持同一原则）。
 */
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import type { ReactNode } from 'react'

import { colors, fonts, radius, spacing } from '../theme'

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  tone = 'gold'
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  busy?: boolean
  tone?: 'gold' | 'danger'
}): ReactNode {
  const inactive = disabled || busy
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === 'danger' ? styles.buttonDanger : styles.buttonGold,
        inactive && styles.buttonDisabled,
        pressed && !inactive && styles.buttonPressed
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.bgDeep} /> : null}
      <Text style={[styles.buttonLabel, tone === 'danger' && styles.buttonLabelDanger]}>
        {label}
      </Text>
    </Pressable>
  )
}

export function GhostButton({
  label,
  onPress,
  disabled = false
}: {
  label: string
  onPress: () => void
  disabled?: boolean
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.ghost,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed
      ]}
    >
      <Text style={styles.ghostLabel}>{label}</Text>
    </Pressable>
  )
}

export interface FieldProps {
  label: string
  value: string
  onChangeText: (next: string) => void
  placeholder?: string
  /** 密码类输入：真机上要关掉自动纠正与明文显示 */
  secure?: boolean
  multiline?: boolean
  autoCapitalize?: 'none' | 'sentences'
  keyboardType?: 'default' | 'url'
  hint?: string
}

/**
 * 带标签的输入框。
 * apiKey / baseUrl 默认关掉自动大写与自动纠正：API Key 里的大小写与符号会被
 * iOS/Android 的键盘改写，导致「明明输入对了却 401」。
 */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure = false,
  multiline = false,
  autoCapitalize = 'sentences',
  keyboardType = 'default',
  hint
}: FieldProps): ReactNode {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline, secure && styles.inputSecure]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        secureTextEntry={secure}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        accessibilityLabel={label}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}

export function Banner({
  message,
  tone = 'error'
}: {
  message: string
  tone?: 'error' | 'info'
}): ReactNode {
  return (
    <View style={[styles.banner, tone === 'info' && styles.bannerInfo]}>
      <Text style={styles.bannerText}>{message}</Text>
    </View>
  )
}

export function SectionTitle({ children }: { children: ReactNode }): ReactNode {
  return <Text style={styles.sectionTitle}>{children}</Text>
}

/**
 * 带图标的分组块：标题 + 一句说明 + 内容。
 *
 * 设置页原来只有裸标题，读者不知道每块是干什么的；
 * 这个块把「图标 + 标题 + 说明」三件套统一起来，
 * 图标用两个字母的角标（不引图标库，各端渲染一致）。
 */
export function SectionBlock({
  badge,
  title,
  description,
  children
}: {
  /** 角标文字，两三个字母为宜 */
  badge: string
  title: string
  description?: string
  children?: ReactNode
}): ReactNode {
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionBadge}>
          <Text style={styles.sectionBadgeText}>{badge}</Text>
        </View>
        <View style={styles.sectionHeadText}>
          <Text style={styles.sectionHeading}>{title}</Text>
          {description ? <Text style={styles.sectionDesc}>{description}</Text> : null}
        </View>
      </View>
      {children}
    </View>
  )
}

export function Row({
  children,
  style
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}): ReactNode {
  return <View style={[styles.row, style]}>{children}</View>
}

/** 横向筛选片：分组切换、排序方式、主题选择都用它 */
export function Chip({
  label,
  active = false,
  onPress,
  disabled = false
}: {
  label: string
  active?: boolean
  onPress: () => void
  disabled?: boolean
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed
      ]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  )
}

/**
 * 横向滚动的筛选片容器。**必须用它，不要直接写 `<ScrollView horizontal>`。**
 *
 * 原因：React Native 的 `ScrollView` 基础样式里 **横竖两个方向都带 `flexGrow: 1`**
 * （`Libraries/Components/ScrollView/ScrollView.js` 的 `baseHorizontal` / `baseVertical`）。
 * 一个横向 ScrollView 放进 `flex: 1` 的纵向容器里，会被拉高到占满剩余空间 ——
 * 实测书架页的两个筛选行就是这样被撑成两个巨大的椭圆，占掉半屏。
 * 这里显式 `flexGrow: 0` 关掉，`flexShrink: 1` 保留（内容过多时仍可压缩）。
 *
 * `alignItems: 'center'` 是配套的：contentContainer 默认 `stretch`，
 * 不居中的话筛选片会被拉成等高，视觉上更怪。
 */
export function ChipRow({
  children,
  contentContainerStyle,
  style
}: {
  children: ReactNode
  contentContainerStyle?: StyleProp<ViewStyle>
  style?: StyleProp<ViewStyle>
}): ReactNode {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={[styles.chipScroll, style]}
      contentContainerStyle={[styles.chipRow, contentContainerStyle]}
    >
      {children}
    </ScrollView>
  )
}

/**
 * 单行文本输入弹窗。
 *
 * 为什么不用 `Alert.prompt`：它在 iOS 上可用，但 **Android 上不存在**，
 * 会直接抛错。分组新建 / 重命名、条目改名都需要这个能力，所以自带一个。
 */
export function PromptModal({
  visible,
  title,
  placeholder = '',
  initialValue = '',
  confirmLabel = '确定',
  onCancel,
  onConfirm
}: {
  visible: boolean
  title: string
  placeholder?: string
  initialValue?: string
  confirmLabel?: string
  onCancel: () => void
  /** 返回空串视为取消，避免误把空名字提交上去 */
  onConfirm: (value: string) => void
}): ReactNode {
  const [value, setValue] = useState(initialValue)

  // 每次打开都重置为传入的初值：复用同一个 Modal 实例时，
  // 上一次残留的文本会跟着进入下一次编辑。
  useEffect(() => {
    if (visible) setValue(initialValue)
  }, [initialValue, visible])

  const submit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      <Pressable style={styles.promptBackdrop} onPress={onCancel} accessibilityLabel="关闭" />
      <View style={styles.promptCard}>
        <Text style={styles.promptTitle}>{title}</Text>
        <TextInput
          style={styles.promptInput}
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={colors.textDim}
          autoFocus
          selectTextOnFocus
          onSubmitEditing={submit}
          returnKeyType="done"
          accessibilityLabel={title}
        />
        <View style={styles.promptActions}>
          <GhostButton label="取消" onPress={onCancel} />
          <PrimaryButton label={confirmLabel} onPress={submit} />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md
  },
  buttonGold: { backgroundColor: colors.gold },
  buttonDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.75 },
  buttonLabel: { color: colors.bgDeep, fontSize: 14, fontFamily: fonts.sans },
  buttonLabelDanger: { color: colors.danger },
  ghost: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line
  },
  ghostLabel: { color: colors.textMid, fontSize: 13, fontFamily: fonts.sans },
  sectionBlock: { gap: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionBadge: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.goldLine,
    alignItems: 'center',
    justifyContent: 'center'
  },
  sectionBadgeText: { color: colors.gold, fontSize: 11, fontFamily: fonts.mono },
  sectionHeadText: { flex: 1, gap: 2 },
  sectionHeading: { color: colors.textHi, fontSize: 14, fontFamily: fonts.serif, letterSpacing: 1 },
  sectionDesc: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  field: { gap: 5 },
  fieldLabel: { color: colors.textMid, fontSize: 11, letterSpacing: 1 },
  input: {
    backgroundColor: colors.bgPanelSolid,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.textHi,
    fontSize: 14,
    fontFamily: fonts.sans
  },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  inputSecure: { fontFamily: fonts.mono, letterSpacing: 1 },
  hint: { color: colors.textDim, fontSize: 10, lineHeight: 14 },
  banner: {
    backgroundColor: 'rgba(255, 158, 199, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 158, 199, 0.35)',
    borderRadius: radius.md,
    padding: spacing.md
  },
  bannerInfo: {
    backgroundColor: 'rgba(127, 231, 255, 0.1)',
    borderColor: 'rgba(127, 231, 255, 0.3)'
  },
  bannerText: { color: colors.textMid, fontSize: 12, lineHeight: 18 },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: spacing.sm
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line
  },
  chipActive: { backgroundColor: 'rgba(232, 201, 138, 0.16)', borderColor: colors.goldLine },
  chipLabel: { color: colors.textDim, fontSize: 12, fontFamily: fonts.sans },
  chipLabelActive: { color: colors.gold },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  // 关掉 ScrollView 自带的 flexGrow: 1，否则横向滚动容器会被拉高占满剩余空间
  chipScroll: { flexGrow: 0, flexShrink: 1 },
  promptBackdrop: { flex: 1, backgroundColor: 'rgba(8, 11, 22, 0.72)' },
  promptCard: {
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.bgPanelSolid,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg
  },
  promptTitle: { color: colors.textHi, fontSize: 15, fontFamily: fonts.sans },
  promptInput: {
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.textHi,
    fontSize: 14,
    fontFamily: fonts.sans
  },
  promptActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }
})
