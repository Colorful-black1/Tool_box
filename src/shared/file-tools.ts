/** 路径只用于展示；扫描授权来自主进程目录选择框签发的临时引用。 */
export interface FileDirectoryReference {
  token: string
  label: string
}

/** 内容相同的非空文件组；不含文件内容或写入操作。 */
export interface DuplicateFileGroup {
  id: string
  size: number
  paths: string[]
  reclaimableBytes: number
}

/** 每次扫描独立标识，旧扫描的末尾进度不会覆盖新结果。 */
export interface FileScanSnapshot {
  scanId: string
  phase: 'enumerating' | 'hashing' | 'completed' | 'cancelled' | 'error'
  files: number
  hashed: number
  candidates: number
  skipped: number
  truncated: boolean
  warnings: string[]
  groups: DuplicateFileGroup[]
  error?: string
}

export function normalizeDisplayPath(path: string): string {
  return path.replace(/\\/g, '/')
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let index = 0
  while (bytes >= 1024 && index < units.length - 1) {
    bytes /= 1024
    index += 1
  }
  return `${index ? bytes.toFixed(2) : bytes} ${units[index]}`
}
