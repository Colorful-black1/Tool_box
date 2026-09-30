export interface EncodingResult {
  text: string
  encoding: string
}

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const
const UTF16LE_BOM = [0xff, 0xfe] as const
const UTF16BE_BOM = [0xfe, 0xff] as const

export function decodeText(bytes: Buffer): EncodingResult {
  if (hasBom(bytes, UTF8_BOM)) {
    return {
      text: new TextDecoder('utf-8').decode(stripBom(bytes, 3)),
      encoding: 'UTF-8 BOM'
    }
  }

  if (hasBom(bytes, UTF16LE_BOM)) {
    return {
      text: new TextDecoder('utf-16le').decode(stripBom(bytes, 2)),
      encoding: 'UTF-16 LE'
    }
  }

  if (hasBom(bytes, UTF16BE_BOM)) {
    return {
      text: new TextDecoder('utf-16be').decode(stripBom(bytes, 2)),
      encoding: 'UTF-16 BE'
    }
  }

  if (isValidUtf8(bytes)) {
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8' }
  }

  return { text: decodeGbk(bytes), encoding: 'GBK' }
}

function hasBom(bytes: Buffer, bom: readonly number[]): boolean {
  if (bytes.length < bom.length) return false
  return bom.every((byte, index) => bytes[index] === byte)
}

function stripBom(bytes: Buffer, length: number): Buffer {
  return bytes.subarray(length)
}

function isValidUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

// Node 22+ exposes TextDecoder('gbk'); otherwise fall back to a naive lossy decode.
function decodeGbk(bytes: Buffer): string {
  try {
    return new TextDecoder('gbk', { fatal: false }).decode(bytes)
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}
