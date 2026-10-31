import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, opendir, realpath, open } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import type { FileScanSnapshot } from '../../../shared/file-tools'
import { createWindowsDirectoryAttributes } from './windows-directory-attributes'

export const DUPLICATE_MAX_FILES = 20_000
export const DUPLICATE_MAX_DEPTH = 12
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'release'])

/** 异步枚举与流式哈希，权限失败和扫描中变化跳过；不跟随链接、不修改文件。 */
export async function findDuplicateFiles(
  directory: string,
  scanId: string,
  signal: AbortSignal,
  progress: (snapshot: FileScanSnapshot) => void,
  limits = { maxFiles: DUPLICATE_MAX_FILES, maxDepth: DUPLICATE_MAX_DEPTH }
): Promise<FileScanSnapshot> {
  const state: FileScanSnapshot = {
    scanId,
    phase: 'enumerating',
    files: 0,
    hashed: 0,
    candidates: 0,
    skipped: 0,
    truncated: false,
    warnings: [],
    groups: []
  }
  let lastProgress = 0
  // 惰性启动：没有子目录的扫描无需额外进程；非 Windows 仍用 Node 目录语义。
  let windowsAttributes: ReturnType<typeof createWindowsDirectoryAttributes> | undefined
  const emit = (force = false): void => {
    if (!force && Date.now() - lastProgress < 150) return
    lastProgress = Date.now()
    progress({ ...state, groups: [], warnings: [...state.warnings] })
  }
  const warn = (text: string): void => {
    if (!state.warnings.includes(text)) state.warnings.push(text)
  }
  try {
    const root = resolve(directory)
    const rootStat = await lstat(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (await realpath(root)) !== root)
      throw new Error('invalid-root')
    const files: Array<{ path: string; size: number; mtimeMs: number; ino: number }> = []
    const directories = [{ path: root, depth: 0 }]
    let visited = 0
    emit(true)
    while (directories.length && !state.truncated) {
      signal.throwIfAborted()
      const current = directories.pop()!
      try {
        const info = await lstat(current.path)
        if (
          info.isSymbolicLink() ||
          info.dev !== rootStat.dev ||
          (await realpath(current.path)) !== current.path
        ) {
          state.skipped += 1
          continue
        }
        const dir = await opendir(current.path)
        for await (const child of dir) {
          signal.throwIfAborted()
          visited += 1
          if (visited > 100_000) {
            state.truncated = true
            warn('目录项过多，扫描已达到安全上限')
            break
          }
          const path = join(current.path, child.name)
          if (child.isSymbolicLink()) {
            state.skipped += 1
            continue
          }
          if (child.isDirectory()) {
            if (child.name.startsWith('.') || SKIP_DIRS.has(child.name.toLowerCase())) continue
            if (process.platform === 'win32') {
              try {
                windowsAttributes ??= createWindowsDirectoryAttributes(signal)
                const attributes = await windowsAttributes.read(path)
                // FILE_ATTRIBUTE_HIDDEN=2，REPARSE_POINT=1024；不遍历任何重解析目录。
                if (attributes === null || (attributes & (2 | 1024)) !== 0) {
                  state.skipped += 1
                  if (attributes === null) warn('部分目录的系统属性无法读取，已跳过')
                  continue
                }
              } catch {
                signal.throwIfAborted()
                state.skipped += 1
                warn('Windows 隐藏属性接口不可用，部分目录已跳过')
                continue
              }
            }
            if (current.depth >= limits.maxDepth) {
              warn(`仅扫描深度 ${limits.maxDepth} 以内的目录`)
              continue
            }
            directories.push({ path, depth: current.depth + 1 })
          } else if (child.isFile()) {
            if (state.files >= limits.maxFiles) {
              state.truncated = true
              break
            }
            try {
              const stat = await lstat(path)
              if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== rootStat.dev) {
                state.skipped += 1
                continue
              }
              state.files += 1
              if (stat.size)
                files.push({ path, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino })
              else state.skipped += 1
            } catch {
              state.skipped += 1
              warn('部分文件无法读取或扫描期间已变化')
            }
          }
          if (visited % 100 === 0) {
            emit()
            await setImmediate()
          }
        }
      } catch (error) {
        signal.throwIfAborted()
        if (error instanceof Error) {
          state.skipped += 1
          warn('部分目录无法读取，结果可能不完整')
        }
      }
    }
    if (state.truncated) warn(`仅扫描前 ${state.files} 个文件`)
    warn('0 字节文件不参与重复分组；隐藏目录及常见构建目录已跳过')
    const sizes = new Map<number, typeof files>()
    for (const file of files) {
      const list = sizes.get(file.size) ?? []
      list.push(file)
      sizes.set(file.size, list)
    }
    const candidates = [...sizes.values()].filter((group) => group.length > 1).flat()
    state.candidates = candidates.length
    state.phase = 'hashing'
    emit(true)
    const hashes = new Map<string, { size: number; paths: string[] }>()
    for (const file of candidates) {
      signal.throwIfAborted()
      try {
        // 重查真实父路径与文件身份，拒绝枚举后被替换为链接的路径。
        const real = await realpath(file.path)
        const tail = relative(root, real)
        if (
          real !== file.path ||
          tail === '..' ||
          tail.startsWith(`..${sep}`) ||
          isAbsolute(tail) ||
          (await realpath(dirname(file.path))) !== dirname(file.path)
        )
          throw new Error('path-changed')
        const handle = await open(file.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        try {
          const before = await handle.stat()
          if (
            !before.isFile() ||
            before.dev !== rootStat.dev ||
            before.ino !== file.ino ||
            before.size !== file.size ||
            before.mtimeMs !== file.mtimeMs
          )
            throw new Error('file-changed')
          const digest = createHash('sha256')
          const stream = handle.createReadStream({ autoClose: false, signal })
          for await (const chunk of stream) {
            signal.throwIfAborted()
            digest.update(chunk)
          }
          const after = await handle.stat()
          if (
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs ||
            after.ctimeMs !== before.ctimeMs
          )
            throw new Error('file-changed')
          const key = `${file.size}:${digest.digest('hex')}`
          const group = hashes.get(key) ?? { size: file.size, paths: [] }
          group.paths.push(file.path)
          hashes.set(key, group)
        } finally {
          await handle.close()
        }
      } catch {
        signal.throwIfAborted()
        state.skipped += 1
        warn('部分文件无法读取或扫描期间已变化')
      }
      state.hashed += 1
      emit()
      await setImmediate()
    }
    state.groups = [...hashes.entries()]
      .filter(([, group]) => group.paths.length > 1)
      .map(([id, group]) => ({
        id,
        ...group,
        reclaimableBytes: group.size * (group.paths.length - 1)
      }))
      .sort((a, b) => b.reclaimableBytes - a.reclaimableBytes)
    state.phase = 'completed'
  } catch {
    state.groups = []
    state.phase = signal.aborted ? 'cancelled' : 'error'
    if (!signal.aborted) state.error = '无法扫描此目录，请重新选择可读取的普通目录'
  }
  windowsAttributes?.close()
  progress({ ...state })
  return state
}
