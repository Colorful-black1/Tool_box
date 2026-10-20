/**
 * Markdown 渲染（手机端）：把 `shared/markdown` 的 AST 渲染成 RN 组件。
 *
 * 为什么不让模型输出直接当纯文本：AI 的回答里经常带 **粗体**、`代码`、
 * 列表和链接，纯文本显示会很难读。
 *
 * 为什么两端共用一份 AST：桌面端把 AST 渲染成 HTML，手机端渲染成 RN 组件，
 * 解析只写一遍，语法子集天然一致（不引任何 Markdown 库）。
 *
 * 链接只允许 http / https（解析阶段就拦掉其它协议），点击用系统浏览器打开。
 */
import type { ReactNode } from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'

import type { MdBlock, MdInline } from '../shared-bridge'
import { parseMarkdown } from '../shared-bridge'
import { colors, fonts, radius, spacing } from '../theme'

export function MarkdownView({ source }: { source: string }): ReactNode {
  const blocks = parseMarkdown(source)
  if (blocks.length === 0) return null

  return (
    <View style={styles.root}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </View>
  )
}

function BlockView({ block }: { block: MdBlock }): ReactNode {
  switch (block.kind) {
    case 'heading':
      return (
        <Text style={[styles.heading, block.level <= 2 ? styles.headingBig : styles.headingSmall]}>
          {renderInlines(block.children, 'h')}
        </Text>
      )
    case 'paragraph':
      return <Text style={styles.paragraph}>{renderInlines(block.children, 'p')}</Text>
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.listItem}>
              <Text style={styles.bullet}>{block.ordered ? `${index + 1}.` : '·'}</Text>
              <Text style={styles.listText}>{renderInlines(item, `l${index}`)}</Text>
            </View>
          ))}
        </View>
      )
    case 'code':
      return (
        <View style={styles.code}>
          <Text style={styles.codeText}>{block.text}</Text>
        </View>
      )
    case 'quote':
      return (
        <View style={styles.quote}>
          <Text style={styles.quoteText}>{renderInlines(block.children, 'q')}</Text>
        </View>
      )
    case 'rule':
      return <View style={styles.rule} />
  }
}

/** 行内节点渲染成 Text 片段数组（RN 允许 Text 嵌套 Text） */
function renderInlines(nodes: MdInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`
    switch (node.kind) {
      case 'text':
        return <Text key={key}>{node.text}</Text>
      case 'strong':
        return (
          <Text key={key} style={styles.strong}>
            {renderInlines(node.children, key)}
          </Text>
        )
      case 'em':
        return (
          <Text key={key} style={styles.em}>
            {renderInlines(node.children, key)}
          </Text>
        )
      case 'code':
        return (
          <Text key={key} style={styles.codeInline}>
            {node.text}
          </Text>
        )
      case 'link':
        return (
          <Text key={key} style={styles.link} onPress={() => openLink(node.href)}>
            {renderInlines(node.children, key)}
          </Text>
        )
    }
  })
}

/** 打开外链；设备上没有可用浏览器时静默失败，不该把对话页搞崩 */
function openLink(href: string): void {
  void Linking.openURL(href).catch(() => undefined)
}

const styles = StyleSheet.create({
  root: { gap: 6 },
  paragraph: { color: colors.textHi, fontSize: 14, lineHeight: 21, fontFamily: fonts.sans },
  heading: { color: colors.gold, fontFamily: fonts.serif, marginTop: 4 },
  headingBig: { fontSize: 16, letterSpacing: 1 },
  headingSmall: { fontSize: 14, letterSpacing: 1 },
  list: { gap: 3 },
  listItem: { flexDirection: 'row', gap: 6 },
  bullet: { color: colors.goldDim, fontSize: 13, lineHeight: 20, minWidth: 16, fontFamily: fonts.sans },
  listText: { flex: 1, color: colors.textHi, fontSize: 14, lineHeight: 20, fontFamily: fonts.sans },
  code: {
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderWidth: 1,
    borderColor: colors.lineSoft
  },
  codeText: { color: colors.textMid, fontSize: 12, lineHeight: 18, fontFamily: fonts.mono },
  quote: {
    paddingLeft: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: colors.goldLine
  },
  quoteText: { color: colors.textMid, fontSize: 14, lineHeight: 20, fontFamily: fonts.sans },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
  strong: { fontWeight: 'bold', color: colors.textHi },
  em: { fontStyle: 'italic' },
  codeInline: {
    fontFamily: fonts.mono,
    fontSize: 12.5,
    color: colors.cyan,
    backgroundColor: 'rgba(255, 255, 255, 0.08)'
  },
  link: { color: colors.cyan, textDecorationLine: 'underline' }
})
