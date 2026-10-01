/**
 * 共用 UI 原子组件。
 *
 * 复用 `theme.ts` 的设计令牌与 `GlassCard`，不另立一套样式体系
 * （与桌面端「复用 global.css 设计系统」保持同一原则）。
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
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

export function Row({
  children,
  style
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}): ReactNode {
  return <View style={[styles.row, style]}>{children}</View>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }
})
