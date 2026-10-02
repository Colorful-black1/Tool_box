/**
 * 密码批量导入的「从文件取文本」（手机端）。
 *
 * 为什么单独一个文件：读文件那一步必须用 `expo-file-system` 的 `File`，
 * 在 vitest 里跑不了。把「体积预检 + 字节转文本」这两步抽成纯逻辑后，
 * 就能在测试里覆盖体积与编码这两类边界，不必拉起真机的系统文件选择器。
 *
 * 与书架导入共用 `text-decoder`（BOM 探测 + UTF-16 嗅探 + 严格 UTF-8 校验），
 * 因此 GBK / ANSI 文件会得到和书籍一样的明确报错，而不是满屏乱码。
 *
 * 选择器不传 `mimeTypes`：各家 Android 文件管理器 / 网盘把 .txt 报成
 * `text/plain` 还是 `application/octet-stream` 并不统一，限死反而选不到文件
 * （与 `bookshelf-screen.tsx` 同一个理由）。
 */
import { MAX_BOOK_BYTES, decodeBookText, formatSizeError } from '../../data/text-decoder'

/** 系统文件选择器返回的单个文件，本模块只用到这三个成员 */
export interface PickedTextFile {
  name: string
  /** provider 拿不到真实大小时会是 0，此时不能据此判定超限 */
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * 读一个已选中的文件并解成文本。
 *
 * 体积预检只在拿到有效值时生效，真正的兜底是 `decodeBookText` 内部的
 * 字节长度判定 —— 预检只是为了不把明显超限的文件整个读进内存。
 */
export async function readPickedTextFile(file: PickedTextFile): Promise<string> {
  if (file.size > MAX_BOOK_BYTES) throw new Error(formatSizeError(file.size))

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length === 0) throw new Error('文件为空，请换一个文件')

  return decodeBookText(bytes).text
}