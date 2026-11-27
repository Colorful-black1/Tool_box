import { nativeImage } from 'electron'
import type { NativeImage } from 'electron'

import { MAX_CHAT_IMAGE_EDGE, MAX_CHAT_IMAGE_STORED_BYTES } from '../../../shared/chat-attachments'
import type { ChatImageProcessor, ChatImageResult } from './chat-attachments'

/** Electron 主进程图片处理；只在本次模型请求内存中使用，不落库。 */
export const nativeChatImageProcessor: ChatImageProcessor = {
  prepare(bytes: Buffer): ChatImageResult {
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) throw new Error('图片无法解析')

    let chosen = resizeToEdge(image, MAX_CHAT_IMAGE_EDGE)
    let data = chosen.toJPEG(85)
    let mime: ChatImageResult['mime'] = 'image/jpeg'
    // PNG 源在体积允许时保留 PNG，避免透明截图被 JPEG 压成黑底。
    if (isPng(bytes)) {
      const png = chosen.toPNG()
      if (png.length <= MAX_CHAT_IMAGE_STORED_BYTES) {
        data = png
        mime = 'image/png'
      }
    }
    for (const edge of [MAX_CHAT_IMAGE_EDGE, 1280, 1024, 800]) {
      if (data.length <= MAX_CHAT_IMAGE_STORED_BYTES) break
      const candidate = resizeToEdge(image, edge)
      for (const quality of [85, 70, 55]) {
        const jpeg = candidate.toJPEG(quality)
        if (jpeg.length <= MAX_CHAT_IMAGE_STORED_BYTES) {
          chosen = candidate
          data = jpeg
          mime = 'image/jpeg'
          break
        }
      }
    }
    if (data.length > MAX_CHAT_IMAGE_STORED_BYTES) throw new Error('图片压缩后仍然过大')

    const size = chosen.getSize()
    return {
      data,
      mime,
      width: size.width,
      height: size.height
    }
  }
}

function resizeToEdge(image: NativeImage, edge: number): NativeImage {
  const size = image.getSize()
  const longest = Math.max(size.width, size.height)
  if (longest <= edge) return image
  const ratio = edge / longest
  return image.resize({
    width: Math.max(1, Math.round(size.width * ratio)),
    height: Math.max(1, Math.round(size.height * ratio)),
    quality: 'best'
  })
}

function isPng(bytes: Buffer): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
}
