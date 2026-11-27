import { readFileSync, statSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { basename, isAbsolute } from 'node:path'

import {
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENT_NAME_CHARS,
  MAX_CHAT_ATTACHMENT_TOTAL_BYTES,
  MAX_CHAT_IMAGE_ATTACHMENT_BYTES,
  MAX_CHAT_IMAGE_STORED_BYTES,
  MAX_CHAT_TEXT_ATTACHMENT_BYTES,
  MAX_CHAT_TEXT_ATTACHMENT_CHARS,
  MAX_CHAT_TEXT_ATTACHMENT_TOTAL_CHARS,
  guessChatImageMime,
  isChatTextAttachment
} from '../../../shared/chat-attachments'
import { estimateTextTokens } from '../../../shared/context-tokens'
import type { ChatAttachmentInput } from '../../../shared/types'
import type { ChatAttachmentWriteInput } from '../chat-store/chat-store'
import { decodeText } from '../library/encoding'
import { AiGatewayError } from './errors'

export interface ChatImageResult {
  data: Buffer
  mime: 'image/jpeg' | 'image/png'
  width: number
  height: number
}

export interface ChatImageProcessor {
  prepare(bytes: Buffer): ChatImageResult
}

/** 附件只写路径与元数据；正文 / 图片字节只在本次模型请求内存在内存。 */
export interface PreparedChatAttachment extends ChatAttachmentWriteInput {
  textContent?: string
  imageData?: Buffer
}

/**
 * 校验并准备附件：渲染层只提交路径，主进程重新确认存在性、类型、大小，
 * 再读取源文件。文件内容不会写入数据库。
 */
export function prepareChatAttachments(
  inputs: readonly ChatAttachmentInput[],
  imageProcessor: ChatImageProcessor
): PreparedChatAttachment[] {
  if (inputs.length > MAX_CHAT_ATTACHMENTS) {
    throw new AiGatewayError(`每条消息最多 ${MAX_CHAT_ATTACHMENTS} 个附件`)
  }

  const prepared: PreparedChatAttachment[] = []
  let totalBytes = 0
  let textBudget = MAX_CHAT_TEXT_ATTACHMENT_TOTAL_CHARS

  for (const input of inputs) {
    const filePath = input.path.trim()
    if (!filePath || !isAbsolute(filePath)) {
      throw new AiGatewayError('附件路径无效，请重新选择本机文件')
    }
    const name = sanitizeAttachmentName(basename(filePath))
    if (!name) throw new AiGatewayError('附件名称无效')

    const stat = statFile(filePath, name)
    if (!stat.isFile()) throw new AiGatewayError(`附件“${name}”不是文件`)
    totalBytes += stat.size
    if (totalBytes > MAX_CHAT_ATTACHMENT_TOTAL_BYTES) {
      throw new AiGatewayError('附件总大小不能超过 30 MB')
    }

    if (isChatTextAttachment(name) && stat.size > MAX_CHAT_TEXT_ATTACHMENT_BYTES) {
      throw new AiGatewayError(`文本附件“${name}”超过 2 MB`)
    }
    if (stat.size > MAX_CHAT_IMAGE_ATTACHMENT_BYTES) {
      throw new AiGatewayError(`附件“${name}”超过 10 MB`)
    }

    const bytes = readFile(filePath, name)
    const detectedImage = detectImageMime(bytes)
    if (detectedImage) {
      if (bytes.length > MAX_CHAT_IMAGE_ATTACHMENT_BYTES) {
        throw new AiGatewayError(`图片“${name}”超过 10 MB`)
      }
      let image: ChatImageResult
      try {
        image = imageProcessor.prepare(bytes)
      } catch (error) {
        if (error instanceof Error && error.message.includes('过大')) {
          throw new AiGatewayError(`图片“${name}”压缩后仍然过大`)
        }
        throw new AiGatewayError(`图片“${name}”无法解析`)
      }
      if (image.data.length > MAX_CHAT_IMAGE_STORED_BYTES) {
        throw new AiGatewayError(`图片“${name}”压缩后仍然过大`)
      }
      prepared.push({
        kind: 'image',
        name,
        mime: image.mime,
        sizeBytes: bytes.length,
        filePath,
        imageData: image.data,
        width: image.width,
        height: image.height,
        truncated: false
      })
      continue
    }

    if (!isChatTextAttachment(name)) {
      if (guessChatImageMime(name)) throw new AiGatewayError(`图片“${name}”无法解析`)
      throw new AiGatewayError(`不支持的文件类型：${name}`)
    }
    if (bytes.length > MAX_CHAT_TEXT_ATTACHMENT_BYTES) {
      throw new AiGatewayError(`文本附件“${name}”超过 2 MB`)
    }
    if (looksBinary(bytes)) {
      throw new AiGatewayError(`附件“${name}”看起来是二进制文件，暂不支持`)
    }
    const decoded = decodeText(bytes).text
    if (!decoded.trim()) throw new AiGatewayError(`附件“${name}”没有可读取的文本内容`)
    if (textBudget <= 0) {
      throw new AiGatewayError('文本附件合计超过 40,000 字，请减少文件')
    }
    const limit = Math.min(MAX_CHAT_TEXT_ATTACHMENT_CHARS, textBudget)
    const truncated = truncateText(decoded, limit)
    textBudget -= truncated.text.length

    prepared.push({
      kind: 'text',
      name,
      mime: 'text/plain',
      sizeBytes: bytes.length,
      filePath,
      textContent: truncated.text,
      textChars: truncated.text.length,
      textTokens: estimateTextTokens(truncated.text),
      truncated: truncated.truncated
    })
  }

  return prepared
}

/** 只保留单文件名；源文件路径单独保存，不把分隔符混进展示名。 */
export function sanitizeAttachmentName(value: string): string {
  return value
    .replace(/[\\/]/g, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHAT_ATTACHMENT_NAME_CHARS)
}

export interface HydratedAttachmentContent {
  text?: string
  imageDataUrl?: string
  missing?: boolean
}

/**
 * 模型请求前按源路径读取附件内容。文件被移动/删除或已不适合发送时返回
 * missing，由调用方用占位文字降级，而不是让整轮对话失败。
 */
export function loadAttachmentContent(
  filePath: string,
  kind: 'text' | 'image',
  imageProcessor: ChatImageProcessor
): HydratedAttachmentContent {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return { missing: true }
    if (kind === 'text') {
      if (stat.size > MAX_CHAT_TEXT_ATTACHMENT_BYTES) return { missing: true }
      const bytes = readFileSync(filePath)
      if (looksBinary(bytes)) return { missing: true }
      const decoded = decodeText(bytes).text
      if (!decoded.trim()) return { missing: true }
      return { text: truncateText(decoded, MAX_CHAT_TEXT_ATTACHMENT_CHARS).text }
    }
    if (stat.size > MAX_CHAT_IMAGE_ATTACHMENT_BYTES) return { missing: true }
    const bytes = readFileSync(filePath)
    if (!detectImageMime(bytes)) return { missing: true }
    const image = imageProcessor.prepare(bytes)
    return { imageDataUrl: `data:${image.mime};base64,${image.data.toString('base64')}` }
  } catch {
    return { missing: true }
  }
}

function statFile(filePath: string, name: string): Stats {
  try {
    return statSync(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AiGatewayError(`找不到附件“${name}”，可能已被移动或删除`)
    }
    throw new AiGatewayError(`无法读取附件“${name}”，请检查文件权限`)
  }
}

function readFile(filePath: string, name: string): Buffer {
  try {
    return readFileSync(filePath)
  } catch {
    throw new AiGatewayError(`无法读取附件“${name}”，请检查文件权限`)
  }
}

function looksBinary(bytes: Buffer): boolean {
  for (const byte of bytes) {
    if (byte === 0) return true
  }
  return false
}

function truncateText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  let end = limit
  // 不把代理对切成两半，避免末尾出现替换字符。
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return { text: text.slice(0, end), truncated: true }
}

function detectImageMime(bytes: Buffer): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp'
  }
  return null
}
