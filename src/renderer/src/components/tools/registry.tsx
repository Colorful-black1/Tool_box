/**
 * 开发者工具的注册表。
 *
 * **加一个工具 = 在这里加一条**；加一类主树 = 加一个分组。
 * 页面与树都只读这份注册表，不在别处硬编码工具清单。
 */
import type { JSX } from 'react'

import { EncodingPanel } from './panels/encoding-panel'
import { DiffPanel } from './panels/diff-panel'
import { JavaLogPanel } from './panels/java-log-panel'
import { RedactionPanel } from './panels/redaction-panel'
import { PromptPanel } from './panels/prompt-panel'
import { HashPanel } from './panels/hash-panel'
import { JsonPanel } from './panels/json-panel'
import { RegexPanel } from './panels/regex-panel'
import { TextPanel } from './panels/text-panel'
import { TimestampPanel } from './panels/timestamp-panel'
import { UuidPanel } from './panels/uuid-panel'

/** 一个工具 */
export interface ToolDefinition {
  id: string
  name: string
  description: string
  /** 渲染工具面板 */
  render: () => JSX.Element
}

/** 一棵主树（分组） */
export interface ToolGroup {
  id: string
  name: string
  description: string
  tools: ToolDefinition[]
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'dev',
    name: '开发者工具',
    description: '本机处理开发数据，结果可复制、脱敏或填入 AI 对话草稿',
    tools: [
      {
        id: 'regex',
        name: '正则测试',
        description: '实时列出所有命中与位置',
        render: () => <RegexPanel />
      },
      {
        id: 'json',
        name: 'JSON 工具箱',
        description: '无损格式化 / 压缩、字段排序、解除转义与常用 JSONPath',
        render: () => <JsonPanel />
      },
      {
        id: 'diff',
        name: '差异比较',
        description: '文本逐行或 JSON 字段比较，保留长整数精度',
        render: () => <DiffPanel />
      },
      {
        id: 'redact',
        name: '数据脱敏',
        description: '本机识别常见凭据和个人信息，预览替换结果',
        render: () => <RedactionPanel />
      },
      {
        id: 'java-log',
        name: 'Java 日志整理',
        description: '清理颜色、展开转义、查看异常链与筛选 traceId',
        render: () => <JavaLogPanel />
      },
      {
        id: 'prompt',
        name: 'Prompt 模板库',
        description: '模板变量填充、保存历史版本与差异比较，结果可填入对话草稿',
        render: () => <PromptPanel />
      },
      {
        id: 'base64',
        name: 'Base64 编解码',
        description: 'UTF-8 语义，中文不会乱码',
        render: () => <EncodingPanel kind="base64" />
      },
      {
        id: 'url',
        name: 'URL 编解码',
        description: '百分号编码与解码',
        render: () => <EncodingPanel kind="url" />
      },
      {
        id: 'timestamp',
        name: '时间戳换算',
        description: '时间戳 ↔ 本地日期时间（10 位秒 / 13 位毫秒都认）',
        render: () => <TimestampPanel />
      },
      {
        id: 'hash',
        name: '哈希计算',
        description: 'SHA-256 / SHA-384 / SHA-512，本机计算不联网',
        render: () => <HashPanel />
      },
      {
        id: 'text',
        name: '文本统计',
        description: '字数 / 行数 / 词数 / 段落数，顺带做行清洗',
        render: () => <TextPanel />
      },
      {
        id: 'uuid',
        name: 'UUID 生成器',
        description: '批量生成 UUID v4，数量可调',
        render: () => <UuidPanel />
      }
    ]
  }
]

/** 默认选中的工具（首次进入工具页时） */
export const DEFAULT_TOOL_ID = 'regex'

/** 按 id 找工具 */
export function findTool(toolId: string): ToolDefinition | null {
  for (const group of TOOL_GROUPS) {
    const found = group.tools.find((tool) => tool.id === toolId)
    if (found) return found
  }
  return null
}

/** 找到工具所在的分组 */
export function findGroupOfTool(toolId: string): ToolGroup | null {
  return TOOL_GROUPS.find((group) => group.tools.some((tool) => tool.id === toolId)) ?? null
}
